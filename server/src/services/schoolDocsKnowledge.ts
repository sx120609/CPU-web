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
};

// 后面的文件可以用 replaces 替换前面文件里的同一份文档（红头原文替换资料包里的转录稿）。
const SCHOOL_DOCS_FILES = ["school-docs.json", "school-regulations.json"];
// 结果里两段文字的四字片段重合到这个比例，就当作同一条规定的不同版本或转录，只留排名靠前的。
const NEAR_DUPLICATE_OVERLAP = 0.6;
// 汇总整理稿以原文为准、往年版本只作参考，排序时略让位给现行原文。往年资料里也有
// 目前唯一的数据（例如上一年的复试线），所以不压得太低，由模型按年份说明适用性。
const STATUS_PRIOR: Record<SchoolDocStatus, number> = { current: 1, summary: 0.85, historical: 0.8 };

let corpus: { source: string; chunks: IndexedChunk[] } | null | undefined;

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
  return files.length ? { source: files.map((file) => file.source).join("；"), chunks: indexSchoolDocs(files) } : null;
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
    prior: (chunk) => STATUS_PRIOR[chunk.doc.status] ?? 1,
    minCoverage: options.minCoverage ?? 0.4,
    limit: limit * 4,
  });
  const perDoc = new Map<string, number>();
  const hits: SchoolDocHit[] = [];
  const keptShingles: Array<Set<string>> = [];
  for (const { entry, coverage } of ranked) {
    const used = perDoc.get(entry.doc.id) || 0;
    if (used >= perDocument) continue;
    // 学生手册转录的规定、新旧两版里没改的条款，与已选中的段落几乎相同时不重复占名额；
    // 转录稿先被选中时换成带文号的制度原文，两份都是制度时换成较新的一份。
    const current = shingles(entry.text);
    const duplicate = keptShingles.findIndex((kept) => overlapRatio(current, kept) >= NEAR_DUPLICATE_OVERLAP);
    if (duplicate >= 0) {
      const kept = hits[duplicate];
      const better = entry.doc.docNo && (!kept.docNo || (entry.doc.date || "") > (kept.date || ""));
      if (!better || (perDoc.get(entry.doc.id) || 0) >= perDocument) continue;
      perDoc.set(kept.documentId, (perDoc.get(kept.documentId) || 1) - 1);
      perDoc.set(entry.doc.id, used + 1);
      keptShingles[duplicate] = current;
      hits[duplicate] = toHit(entry, coverage);
      continue;
    }
    keptShingles.push(current);
    perDoc.set(entry.doc.id, used + 1);
    hits.push(toHit(entry, coverage));
    if (hits.length >= limit) break;
  }
  return hits;

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
