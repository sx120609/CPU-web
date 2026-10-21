/**
 * 学校事务资料（学生手册、推免办法与细则、招生简章、期刊目录、规章制度等）的检索。
 * 资料由 server/scripts/import-school-knowledge.mjs 从资料包整理成 assets/knowledge/school-docs.json，
 * 规章制度由 server/scripts/build-campus-regulations.py 从制度公开平台整理成 school-regulations.json；
 * 两份文件建成同一个索引一起排序。名单类资料和学号等个人信息在整理时已去掉。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
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
  /** 适用范围、新旧版本关系、施行时间和解释部门，由整理脚本从文件正文推断。 */
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
  coverage: number;
  docNo?: string;
  note?: string;
  /** 同一文件（手册里是同一份规定）中与问题相关的其他条款，例如作弊的处分档次分在两条里。 */
  related?: Array<{ heading: string; excerpt: string }>;
};

const RELATED_PER_HIT = 2;
// 关联文件（过渡期仍适用的旧版、替代它的新版）各取最相关的一条。
const LINKED_PER_HIT = 1;
// 关联文件已经由文号关系确认相关，门槛放低：它的每一条都有“学士学位”这类词，
// 按文件内词频算，真正有区分度的“四级”一个词撑不过 0.5。
const LINKED_MIN_COVERAGE = 0.3;
const RELATED_EXCERPT_CHARS = 320;
const RELATED_MIN_COVERAGE = 0.5;
// 整理脚本生成的状态段已经在 note 里，不必再作为相关条款重复。
const STATUS_HEADING = "文件状态与适用范围";

// 后面的文件可以用 replaces 替换前面文件里的同一份文档（红头原文替换资料包里的转录稿）。
const SCHOOL_DOCS_FILES = ["school-docs.json", "school-regulations.json"];
// 结果里两段文字的四字片段重合到这个比例，就当作同一条规定的不同版本或转录，只留排名靠前的。
const NEAR_DUPLICATE_OVERLAP = 0.6;
// 汇总整理稿以原文为准、往年版本只作参考，排序时略让位给现行原文。往年资料里也有
// 目前唯一的数据（例如上一年的复试线），所以不压得太低，由模型按年份说明适用性。
const STATUS_PRIOR: Record<SchoolDocStatus, number> = { current: 1, summary: 0.85, historical: 0.8 };
// 拾间的用户是学生。只适用于某类人群的制度（留学生、教职工、干部……）条文往往与面向
// 全体学生的版本几乎相同，问题没提到这类人群时略让位，提到了就不压。
const AUDIENCE_GROUPS: RegExp[] = [/留学生|外籍|国际学生/u, /港澳台|华侨/u, /教职工|职工|教师|干部|党员|领导|处级|人事代理|博士后/u];
const AUDIENCE_PRIOR = 0.8;

function audiencePrior(doc: SchoolDocument, query: string) {
  if (!doc.docNo) return 1;
  return AUDIENCE_GROUPS.some((group) => group.test(doc.title) && !group.test(query)) ? AUDIENCE_PRIOR : 1;
}

let corpus: { source: string; chunks: IndexedChunk[]; byDoc: Map<string, IndexedChunk[]> } | null | undefined;

function findSchoolDocsFile(name: string) {
  const candidates = [
    resolve(__dirname, "../assets/knowledge", name),
    resolve(__dirname, "../../assets/knowledge", name),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

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
      });
    }
  }
  return chunks;
}

function buildCorpus(files: SchoolDocsFile[]) {
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

/** 手册把几十份规定装在一个文档里，只在同一份规定（小标题前两级相同）里找相关条款。 */
function sameRegulation(a: IndexedChunk, b: IndexedChunk) {
  if (a.doc.docNo) return true;
  const scope = (chunk: IndexedChunk) => chunk.heading.split(" > ").slice(0, 2).join(" > ");
  return scope(a) === scope(b);
}

function loadCorpus() {
  if (corpus !== undefined) return corpus;
  const files: SchoolDocsFile[] = [];
  for (const name of SCHOOL_DOCS_FILES) {
    const file = findSchoolDocsFile(name);
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

export function schoolDocsSourceLabel() {
  return loadCorpus()?.source || "";
}

export function searchSchoolDocs(query: string, options: {
  limit?: number;
  minCoverage?: number;
  excerptChars?: number;
  /** 同一份文件最多取几段，避免一本手册占满全部名额。 */
  perDocument?: number;
} = {}): SchoolDocHit[] {
  const loaded = loadCorpus();
  if (!loaded) return [];
  const terms = extractKnowledgeQueryTerms(query);
  if (!terms.length) return [];
  const limit = Math.max(1, Math.min(6, options.limit ?? 3));
  const perDocument = Math.max(1, options.perDocument ?? 2);
  const ranked = rankKnowledgeEntries(loaded.chunks, terms, {
    prior: (chunk) => (STATUS_PRIOR[chunk.doc.status] ?? 1) * audiencePrior(chunk.doc, query),
    minCoverage: options.minCoverage ?? 0.4,
    // 同一文件限额和去重会跳过不少候选，池子小了名额会空着。
    limit: limit * 10,
  });
  const perDoc = new Map<string, number>();
  const selected: Array<{ entry: IndexedChunk; coverage: number }> = [];
  const keptShingles: Array<Set<string>> = [];
  for (const { entry, coverage } of ranked) {
    const used = perDoc.get(entry.doc.id) || 0;
    if (used >= perDocument) continue;
    // 学生手册转录的规定、新旧两版里没改的条款，与已选中的段落几乎相同时不重复占名额；
    // 转录稿先被选中时换成带文号的制度原文，两份都是制度时换成较新的一份。
    const current = shingles(entry.text);
    const duplicate = keptShingles.findIndex((kept) => overlapRatio(current, kept) >= NEAR_DUPLICATE_OVERLAP);
    if (duplicate >= 0) {
      const kept = selected[duplicate].entry;
      const better = entry.doc.docNo && (!kept.doc.docNo || (entry.doc.date || "") > (kept.doc.date || ""));
      if (!better) continue;
      perDoc.set(kept.doc.id, (perDoc.get(kept.doc.id) || 1) - 1);
      perDoc.set(entry.doc.id, used + 1);
      keptShingles[duplicate] = current;
      selected[duplicate] = { entry, coverage };
      continue;
    }
    keptShingles.push(current);
    perDoc.set(entry.doc.id, used + 1);
    selected.push({ entry, coverage });
    if (selected.length >= limit) break;
  }

  // 命中一条后，同一文件里其他也回答这个问题的条款一并带上（不占名额）：处分档次、
  // 条件和例外常分在几条里，只给排名最高的一条会漏掉“严重作弊开除学籍”这类情形。
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
  const pick = (candidates: IndexedChunk[], count: number, diffOnly: boolean, minCoverage = RELATED_MIN_COVERAGE) => {
    const usable = candidates.filter((chunk) => !taken.has(chunk.index) && chunk.heading !== STATUS_HEADING);
    if (!usable.length) return [];
    stats ??= knowledgeTermStats(loaded.chunks, terms);
    const picked: Array<{ chunk: IndexedChunk; excerpt: string }> = [];
    for (const { entry: chunk } of rankKnowledgeEntries(usable, terms, { corpusStats: stats, minCoverage, limit: count * 3 })) {
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
  return selected.map(({ entry, coverage }) => {
    const hit = toHit(entry, coverage);
    const own = pick((loaded.byDoc.get(entry.doc.id) || []).filter((chunk) => sameRegulation(entry, chunk)), RELATED_PER_HIT, false);
    // 已经单独列出的文件不再作为关联附上。
    const linked = (entry.doc.links || []).filter((id) => !shown.has(id))
      .flatMap((id) => pick(loaded.byDoc.get(id) || [], LINKED_PER_HIT, true, LINKED_MIN_COVERAGE)).slice(0, 2);
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
      excerpt: focusedExcerpt(entry.text, terms, options.excerptChars ?? 700),
      coverage,
      ...(entry.doc.docNo ? { docNo: entry.doc.docNo } : {}),
      ...(entry.doc.note ? { note: entry.doc.note } : {}),
    };
  }
}
