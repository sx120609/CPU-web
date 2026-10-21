/**
 * 学校事务资料（学生手册、推免办法与细则、招生简章、期刊目录、规章制度等）的检索。
 * 资料由 server/scripts/import-school-knowledge.mjs 从资料包整理成 assets/knowledge/school-docs.json，
 * 规章制度由 server/scripts/build-campus-regulations.py 从制度公开平台整理成 school-regulations.json；
 * 两份文件建成同一个索引一起排序。名单类资料和学号等个人信息在整理时已去掉。
 *
 * 检索分四步：
 * 1. 召回：关键词（字二元组 + idf）与语义向量（knowledgeEmbedding）各取前若干段。关键词擅长
 *    文号、专有名词；语义擅长说法对不上的问题（问“后果”，规定写“处分”）。
 * 2. 融合：两路按名次做 RRF，再乘先验（时效、适用人群、专题、本科/研究生层次）。
 * 3. 选段：每份文件限额、近似重复只留一份（制度原文优先、较新优先）、各层次都有代表。
 * 4. 扩展：命中段附上同一文件里也回答问题的条款、关联文件（新旧版、过渡期仍适用）里
 *    最相关的一条（与已选条款重复时只附不同的句子）；文件的适用与衔接条款在 note 里。
 */
import { readFileSync } from "node:fs";
import {
  findKnowledgeAsset,
  loadKnowledgeEmbedder,
  loadKnowledgeVectors,
  passageHash,
  passageText,
  vectorSimilarity,
  type KnowledgeVectorStore,
} from "./knowledgeEmbedding";
import {
  expandCampusQuery,
  extractKnowledgeQueryTerms,
  focusedExcerpt,
  knowledgeTermStats,
  type KnowledgeTermStats,
  normalizeKnowledgeText,
  rankKnowledgeEntries,
} from "./knowledgeText";

export type SchoolDocStatus = "current" | "historical" | "summary";

export type SchoolDocument = {
  id: string;
  title: string;
  category: string;
  status: SchoolDocStatus;
  date: string | null;
  sourceUrl: string | null;
  extracted: string | null;
  /** 规章制度的发文字号。 */
  docNo?: string;
  /** 适用范围、新旧版本关系、施行时间、适用与衔接条款和解释部门，由整理脚本从正文推断。 */
  note?: string;
  /** 替代、被替代或过渡期仍适用的相关文件 id。 */
  links?: string[];
};

type SchoolDocsFile = {
  version: number;
  source: string;
  documents: SchoolDocument[];
  chunks: Array<{ d: number; h: string; t: string }>;
  /** 其他资料文件里与本文件重复的文档 id → 本文件的文档 id；加载时以本文件为准。 */
  replaces?: Record<string, string>;
};

type IndexedChunk = {
  index: number;
  doc: SchoolDocument;
  heading: string;
  text: string;
  titleKey: string;
  bodyKey: string;
  /** 送去编码的段落文字的哈希，用来在向量文件里找到这一段。 */
  hash: string;
};

export type SchoolDocHit = {
  documentId: string;
  title: string;
  category: string;
  status: SchoolDocStatus;
  date: string | null;
  sourceUrl: string | null;
  heading: string;
  excerpt: string;
  /** 0-1，关键词覆盖率与语义相似度折算后取高者；用来判断资料是否已足够、是否还要联网。 */
  coverage: number;
  docNo?: string;
  note?: string;
  /** 同一文件或关联文件中与问题相关的其他条款，例如作弊的处分档次分在两条里。 */
  related?: Array<{ heading: string; excerpt: string }>;
};

// 后面的文件可以用 replaces 替换前面文件里的同一份文档（红头原文替换资料包里的转录稿）。
const SCHOOL_DOCS_FILES = ["school-docs.json", "school-regulations.json"];

// --- 召回与融合 ---
const RECALL_PER_CHANNEL = 60;
const RRF_K = 60;
// 两路分数的权重：在 tests/fixtures/knowledgeRetrievalEval.json 上取 0.3-0.5 都是满分附近，取中间。
const DENSE_WEIGHT = 0.4;
const LEXICAL_WEIGHT = 1 - DENSE_WEIGHT;
// 只靠语义召回的段落要过这个相似度：实测寒暄、闲聊最高约 0.46，“Python 怎么学”0.53，
// 学校事务问题 0.57-0.68。关键词也命中的段落门槛放低，语义只用来加分。
const DENSE_MIN_SIMILARITY = 0.55;
const DENSE_ASSIST_SIMILARITY = 0.45;
// 相似度折算成 0-1 的“覆盖率”，与关键词覆盖率同一尺度（≥0.7 视为资料已足够）。
const DENSE_COVERAGE_FLOOR = 0.45;
const DENSE_COVERAGE_SPAN = 0.3;

// --- 选段 ---
// 结果里两段文字的四字片段重合到这个比例，就当作同一条规定的不同版本或转录。
const NEAR_DUPLICATE_OVERLAP = 0.6;
// 汇总整理稿以原文为准、往年版本只作参考，排序时略让位给现行原文。往年资料里也有
// 目前唯一的数据（例如上一年的复试线），所以不压得太低，由模型按年份说明适用性。
const STATUS_PRIOR: Record<SchoolDocStatus, number> = { current: 1, summary: 0.85, historical: 0.8 };
// 拾间的用户是学生。只适用于某类人群的制度（留学生、教职工、干部……）条文往往与面向
// 全体学生的版本几乎相同，问题没提到这类人群时略让位，提到了就不压。
const AUDIENCE_GROUPS: RegExp[] = [/留学生|外籍|国际学生/u, /港澳台|华侨/u, /教职工|职工|教师|干部|党员|领导|处级|人事代理|博士后/u];
const SCOPE_PRIOR = 0.8;
// 问题里写出了某份文件的标题或文号（“《…指导原则》还有效吗”），这份文件本身要排在前面，
// 不能只靠替代它的新文件转述。
const NAMED_DOCUMENT_PRIOR = 1.6;
// 各层次轮流出代表时只在得分不低于第一名这个比例的候选里挑，不为凑层次塞进无关段落。
const DIVERSITY_MIN_SCORE = 0.6;
// 推免、招生这类专题资料占了资料包的大半，标题里又常带“本科毕业生”；问题没提到这类
// 专题时同样略让位。
const TOPIC_GROUPS: RegExp[] = [/推免|推荐免试|免试攻读|保研|直博|预推免|夏令营/u, /招生|考研|复试|调剂|报考|拟录取|录取/u];
// 本科生和研究生的规定常同名同题。问题没说是哪一层时，结果里各层都要有，不能让
// 几百段的研究生手册占满名额；说了就把另一层的压下去。
const LEVELS = [
  { name: "graduate", pattern: /研究生|硕士|博士/u },
  { name: "undergraduate", pattern: /本科|学士/u },
] as const;
type Level = typeof LEVELS[number]["name"] | "general";

// --- 扩展 ---
const RELATED_PER_HIT = 2;
// 只给前几条命中附相关条款。
const EXPANDED_HITS = 3;
// 关联文件（过渡期仍适用的旧版、替代它的新版）各取最相关的一条，合计最多两条。
const LINKED_PER_HIT = 1;
const LINKED_TOTAL = 2;
const RELATED_EXCERPT_CHARS = 320;
const RELATED_MIN_COVERAGE = 0.5;
// 关联文件已经由文号关系确认相关，门槛放低。
const LINKED_MIN_COVERAGE = 0.3;
const RELATED_MIN_SIMILARITY = 0.55;
// 整理脚本生成的状态段已经在 note 里，不必再作为相关条款重复。
const STATUS_HEADING = "文件状态与适用范围";

type Corpus = {
  source: string;
  chunks: IndexedChunk[];
  byDoc: Map<string, IndexedChunk[]>;
};

let corpus: Corpus | null | undefined;

function indexSchoolDocs(files: SchoolDocsFile[]) {
  const replaced = new Set(files.flatMap((file) => Object.keys(file.replaces || {})));
  const chunks: IndexedChunk[] = [];
  for (const data of files) {
    for (const chunk of data.chunks) {
      const doc = data.documents[chunk.d];
      if (!doc || replaced.has(doc.id)) continue;
      const titleKey = normalizeKnowledgeText(`${doc.title} ${doc.docNo || ""} ${chunk.h}`);
      chunks.push({
        index: chunks.length,
        doc,
        heading: chunk.h,
        text: chunk.t,
        titleKey,
        bodyKey: `${titleKey}\n${normalizeKnowledgeText(doc.category)}\n${normalizeKnowledgeText(chunk.t)}`,
        hash: passageHash(passageText(doc.title, doc.docNo, chunk.h, chunk.t)),
      });
    }
  }
  return chunks;
}

function buildCorpus(files: SchoolDocsFile[]): Corpus | null {
  if (!files.length) return null;
  const chunks = indexSchoolDocs(files);
  const byDoc = new Map<string, IndexedChunk[]>();
  for (const chunk of chunks) {
    const group = byDoc.get(chunk.doc.id);
    if (group) group.push(chunk);
    else byDoc.set(chunk.doc.id, [chunk]);
  }
  return { source: files.map((file) => file.source).join("；"), chunks, byDoc };
}

function loadCorpus() {
  if (corpus !== undefined) return corpus;
  const files: SchoolDocsFile[] = [];
  for (const name of SCHOOL_DOCS_FILES) {
    const file = findKnowledgeAsset("knowledge", name);
    if (!file) {
      console.warn(`[school-docs] knowledge file ${name} not found; its documents are disabled`);
      continue;
    }
    try {
      files.push(JSON.parse(readFileSync(file, "utf8")) as SchoolDocsFile);
    } catch (error) {
      console.warn(`[school-docs] failed to load ${name}`, error instanceof Error ? error.message : error);
    }
  }
  corpus = buildCorpus(files);
  return corpus;
}

export function setSchoolDocsForTests(data?: SchoolDocsFile | SchoolDocsFile[] | null) {
  if (data === undefined) {
    corpus = undefined;
    return;
  }
  corpus = data ? buildCorpus(Array.isArray(data) ? data : [data]) : null;
}

/** 建向量用：每段送去编码的文字及其哈希，与检索时的对齐方式一致。 */
export function listSchoolDocPassages() {
  return (loadCorpus()?.chunks || []).map((chunk) => ({
    hash: chunk.hash,
    text: passageText(chunk.doc.title, chunk.doc.docNo, chunk.heading, chunk.text),
  }));
}

export function schoolDocsSourceLabel() {
  return loadCorpus()?.source || "";
}

function chunkLevel(chunk: IndexedChunk): Level {
  const label = `${chunk.doc.title} ${chunk.heading}`;
  return LEVELS.find((level) => level.pattern.test(label))?.name || "general";
}

function queryLevel(query: string): Level | null {
  const named = LEVELS.filter((level) => level.pattern.test(query));
  return named.length === 1 ? named[0].name : null;
}

function namesDocument(doc: SchoolDocument, normalizedQuery: string) {
  const title = normalizeKnowledgeText(doc.title).replace(/^中国药科大学/u, "").replace(/[《》（）()\s]/gu, "");
  return (title.length >= 6 && normalizedQuery.includes(title))
    || Boolean(doc.docNo && normalizedQuery.includes(normalizeKnowledgeText(doc.docNo).replace(/\s/gu, "")));
}

function prior(chunk: IndexedChunk, query: string, level: Level | null, normalizedQuery = "") {
  let value = STATUS_PRIOR[chunk.doc.status] ?? 1;
  if (normalizedQuery && namesDocument(chunk.doc, normalizedQuery)) value *= NAMED_DOCUMENT_PRIOR;
  const label = `${chunk.doc.title} ${chunk.heading}`;
  if (chunk.doc.docNo && AUDIENCE_GROUPS.some((group) => group.test(label) && !group.test(query))) value *= SCOPE_PRIOR;
  const scope = `${chunk.doc.title} ${chunk.doc.category}`;
  if (TOPIC_GROUPS.some((group) => group.test(scope) && !group.test(query))) value *= SCOPE_PRIOR;
  const own = chunkLevel(chunk);
  if (level && own !== "general" && own !== level) value *= SCOPE_PRIOR;
  return value;
}

function shingles(text: string) {
  const compact = normalizeKnowledgeText(text).replace(/[^\p{L}\p{N}]/gu, "");
  const set = new Set<string>();
  for (let index = 0; index + 4 <= compact.length; index += 1) set.add(compact.slice(index, index + 4));
  return set;
}

function overlapRatio(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) shared += 1;
  return shared / small.size;
}

function denseCoverage(similarity: number) {
  return Math.max(0, Math.min(1, (similarity - DENSE_COVERAGE_FLOOR) / DENSE_COVERAGE_SPAN));
}

/** 语义通道：问题向量；模型或向量不可用时为 null，检索退回纯关键词。 */
async function queryVector(query: string) {
  const store = loadKnowledgeVectors();
  if (!store) return null;
  const embedder = await loadKnowledgeEmbedder();
  if (!embedder || embedder.dimensions !== store.dimensions) return null;
  try {
    return { store, vector: await embedder.embedQuery(query) };
  } catch (error) {
    console.warn("[school-docs] query embedding failed", error instanceof Error ? error.message : error);
    return null;
  }
}

function similarityOf(semantic: { store: KnowledgeVectorStore; vector: Float32Array } | null, chunk: IndexedChunk) {
  if (!semantic) return null;
  const row = semantic.store.rows.get(chunk.hash);
  return row === undefined ? null : vectorSimilarity(semantic.store, row, semantic.vector);
}

type Candidate = { entry: IndexedChunk; coverage: number; score: number; similarity: number | null };

export async function searchSchoolDocs(query: string, options: {
  limit?: number;
  minCoverage?: number;
  excerptChars?: number;
  /** 同一份文件最多取几段，避免一本手册占满全部名额。 */
  perDocument?: number;
} = {}): Promise<SchoolDocHit[]> {
  const loaded = loadCorpus();
  if (!loaded) return [];
  const expanded = expandCampusQuery(query);
  const terms = extractKnowledgeQueryTerms(expanded);
  const semantic = await queryVector(expanded);
  if (!terms.length && !semantic) return [];
  const limit = Math.max(1, Math.min(8, options.limit ?? 5));
  const perDocument = Math.max(1, options.perDocument ?? 2);
  const level = queryLevel(query);
  const normalizedQuery = normalizeKnowledgeText(query).replace(/[《》（）()\s]/gu, "");

  // 1. 两路召回
  const lexical = terms.length
    ? rankKnowledgeEntries(loaded.chunks, terms, { minCoverage: options.minCoverage ?? 0.4, limit: RECALL_PER_CHANNEL })
    : [];
  const dense: Array<{ entry: IndexedChunk; similarity: number }> = [];
  if (semantic) {
    for (const chunk of loaded.chunks) {
      const similarity = similarityOf(semantic, chunk);
      if (similarity !== null && similarity >= DENSE_ASSIST_SIMILARITY) dense.push({ entry: chunk, similarity });
    }
    dense.sort((a, b) => b.similarity - a.similarity);
    dense.length = Math.min(dense.length, RECALL_PER_CHANNEL);
  }

  // 2. 分数融合：两路各自归一化到 0-1 再加权（按名次融合会抹掉语义通道的强信号），乘先验
  const candidates = new Map<IndexedChunk, Candidate>();
  const upsert = (entry: IndexedChunk) => {
    let candidate = candidates.get(entry);
    if (!candidate) {
      candidate = { entry, coverage: 0, score: 0, similarity: null };
      candidates.set(entry, candidate);
    }
    return candidate;
  };
  const topLexical = lexical[0]?.rank || 1;
  lexical.forEach(({ entry, coverage, rank }) => {
    const candidate = upsert(entry);
    candidate.score += LEXICAL_WEIGHT * (rank / topLexical);
    candidate.coverage = Math.max(candidate.coverage, coverage);
  });
  const topSimilarity = dense[0]?.similarity || 1;
  dense.forEach(({ entry, similarity }) => {
    if (similarity < DENSE_MIN_SIMILARITY && !candidates.has(entry)) return;
    const candidate = upsert(entry);
    candidate.score += DENSE_WEIGHT * Math.max(0, (similarity - DENSE_ASSIST_SIMILARITY) / Math.max(0.01, topSimilarity - DENSE_ASSIST_SIMILARITY));
    candidate.similarity = similarity;
    candidate.coverage = Math.max(candidate.coverage, Math.round(denseCoverage(similarity) * 100) / 100);
  });
  const ranked = [...candidates.values()]
    .map((candidate) => ({ ...candidate, score: candidate.score * prior(candidate.entry, query, level, normalizedQuery) }))
    .sort((a, b) => b.score - a.score);
  const topScore = ranked[0]?.score || 0;

  // 3. 选段
  const perDoc = new Map<string, number>();
  const selected: Array<Candidate & { order: number }> = [];
  const keptShingles: Array<Set<string>> = [];
  const consider = (candidate: Candidate, order: number) => {
    const { entry } = candidate;
    if (selected.some((item) => item.entry === entry)) return;
    const used = perDoc.get(entry.doc.id) || 0;
    if (used >= perDocument) return;
    // 学生手册转录的规定、新旧两版里没改的条款，与已选中的段落几乎相同时不重复占名额；
    // 转录稿先被选中时换成带文号的制度原文，两份都是制度时换成较新的一份。
    const current = shingles(entry.text);
    const duplicate = keptShingles.findIndex((kept) => overlapRatio(current, kept) >= NEAR_DUPLICATE_OVERLAP);
    if (duplicate >= 0) {
      const kept = selected[duplicate].entry;
      const better = entry.doc.docNo && (!kept.doc.docNo || (entry.doc.date || "") > (kept.doc.date || ""));
      if (!better) return;
      perDoc.set(kept.doc.id, (perDoc.get(kept.doc.id) || 1) - 1);
      perDoc.set(entry.doc.id, used + 1);
      keptShingles[duplicate] = current;
      selected[duplicate] = { ...candidate, order: Math.min(order, selected[duplicate].order) };
      return;
    }
    keptShingles.push(current);
    perDoc.set(entry.doc.id, used + 1);
    selected.push({ ...candidate, order });
  };
  if (!level && limit > 1) {
    // 先让每一层（本科、研究生、通用）各出排名最高的一条，再按排名补满。
    const seenLevels = new Set<Level>();
    ranked.forEach((candidate, order) => {
      const own = chunkLevel(candidate.entry);
      if (seenLevels.has(own) || selected.length >= limit || candidate.score < DIVERSITY_MIN_SCORE * topScore) return;
      const before = selected.length;
      consider(candidate, order);
      if (selected.length > before) seenLevels.add(own);
    });
  }
  for (let order = 0; order < ranked.length && selected.length < limit; order += 1) consider(ranked[order], order);
  selected.sort((a, b) => a.order - b.order);

  // 4. 扩展：同一文件的其他相关条款、关联文件的相关条款（不占名额）
  const taken = new Set(selected.map(({ entry }) => entry.index));
  const shown = new Set(selected.map(({ entry }) => entry.doc.id));
  const keptText = selected.map(({ entry }) => shingles(entry.text));
  let stats: KnowledgeTermStats | undefined;
  // 关联文件（新旧两版）的条款常与已选条款几乎相同，差别只在一两句，例如旧版多了
  // “四级≥425 分”。整段算重复丢掉会正好丢掉这句，所以只附不同的那几句。
  const differingClauses = (text: string) => text
    .split(/(?<=[；。])|(?=[（(][一二三四五六七八九十]+[）)])/u)
    .filter((clause) => clause.trim().length >= 6
      && !keptText.some((kept) => overlapRatio(shingles(clause), kept) >= NEAR_DUPLICATE_OVERLAP))
    .join("");
  const pick = (pool: IndexedChunk[], count: number, diffOnly: boolean, minCoverage: number) => {
    const usable = pool.filter((chunk) => !taken.has(chunk.index) && chunk.heading !== STATUS_HEADING);
    if (!usable.length) return [];
    // 在一份文件里挑条款时按全库词频打分：文件内只出现一两次的词正是区分条款的词。
    stats ??= terms.length ? knowledgeTermStats(loaded.chunks, terms) : undefined;
    const scores = new Map<IndexedChunk, number>();
    if (stats) {
      rankKnowledgeEntries(usable, terms, { corpusStats: stats, minCoverage, limit: count * 4 })
        .forEach(({ entry }, rank) => scores.set(entry, (scores.get(entry) || 0) + 1 / (RRF_K + rank + 1)));
    }
    usable
      .map((chunk) => ({ chunk, similarity: similarityOf(semantic, chunk) }))
      .filter((item): item is { chunk: IndexedChunk; similarity: number } => item.similarity !== null && item.similarity >= RELATED_MIN_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, count * 4)
      .forEach(({ chunk }, rank) => scores.set(chunk, (scores.get(chunk) || 0) + 1 / (RRF_K + rank + 1)));
    const picked: Array<{ chunk: IndexedChunk; excerpt: string }> = [];
    for (const [chunk] of [...scores].sort((a, b) => b[1] - a[1])) {
      if (picked.length >= count) break;
      const duplicate = keptShingles.some((kept) => overlapRatio(shingles(chunk.text), kept) >= NEAR_DUPLICATE_OVERLAP);
      if (duplicate && !diffOnly) continue;
      const text = duplicate ? differingClauses(chunk.text) : chunk.text;
      if (!text) continue;
      taken.add(chunk.index);
      picked.push({ chunk, excerpt: `${duplicate ? "（与上文相同的部分略去，仅列不同之处）" : ""}${focusedExcerpt(text, terms, RELATED_EXCERPT_CHARS)}` });
    }
    return picked;
  };
  return selected.map(({ entry, coverage }, position) => {
    const hit = toHit(entry, coverage);
    // 排名靠后的补位段只给正文，控制送进提示词的总长度。
    if (position >= EXPANDED_HITS) return hit;
    const own = pick((loaded.byDoc.get(entry.doc.id) || []).filter((chunk) => sameRegulation(entry, chunk)), RELATED_PER_HIT, false, RELATED_MIN_COVERAGE);
    // 已经单独列出的文件不再作为关联附上。
    const linked = (entry.doc.links || []).filter((id) => !shown.has(id))
      .flatMap((id) => pick(loaded.byDoc.get(id) || [], LINKED_PER_HIT, true, LINKED_MIN_COVERAGE)).slice(0, LINKED_TOTAL);
    const related = [
      ...own.map(({ chunk, excerpt }) => ({ heading: chunk.heading, excerpt })),
      ...linked.map(({ chunk, excerpt }) => ({
        heading: `关联文件《${chunk.doc.title}》（${chunk.doc.docNo || chunk.doc.id}，${chunk.doc.date || "日期不详"}）› ${chunk.heading}`,
        excerpt,
      })),
    ];
    if (related.length) hit.related = related;
    return hit;
  });

  function toHit(entry: IndexedChunk, coverage: number): SchoolDocHit {
    return {
      documentId: entry.doc.id,
      title: entry.doc.title,
      category: entry.doc.category,
      status: entry.doc.status,
      date: entry.doc.date,
      sourceUrl: entry.doc.sourceUrl,
      heading: entry.heading,
      excerpt: focusedExcerpt(entry.text, terms, options.excerptChars ?? 450),
      coverage,
      ...(entry.doc.docNo ? { docNo: entry.doc.docNo } : {}),
      ...(entry.doc.note ? { note: entry.doc.note } : {}),
    };
  }
}

/** 手册把几十份规定装在一个文档里，只在同一份规定（小标题前两级相同）里找相关条款。 */
function sameRegulation(a: IndexedChunk, b: IndexedChunk) {
  if (a.doc.docNo) return true;
  const scope = (chunk: IndexedChunk) => chunk.heading.split(" > ").slice(0, 2).join(" > ");
  return scope(a) === scope(b);
}
