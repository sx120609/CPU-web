/**
 * 学校事务资料（学生手册、推免办法与细则、招生简章、期刊目录等）的检索。
 * 资料由 server/scripts/import-school-knowledge.mjs 从资料包整理成 assets/knowledge/school-docs.json，
 * 名单类资料和学号等个人信息在整理时已去掉。
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
};

type SchoolDocsFile = {
  version: number;
  source: string;
  documents: SchoolDocument[];
  chunks: Array<{ d: number; h: string; t: string }>;
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
};

const SCHOOL_DOCS_FILE = "school-docs.json";
// 汇总整理稿以原文为准、往年版本只作参考，排序时略让位给现行原文。往年资料里也有
// 目前唯一的数据（例如上一年的复试线），所以不压得太低，由模型按年份说明适用性。
const STATUS_PRIOR: Record<SchoolDocStatus, number> = { current: 1, summary: 0.85, historical: 0.8 };

let corpus: { source: string; chunks: IndexedChunk[] } | null | undefined;

function findSchoolDocsFile() {
  const candidates = [
    resolve(__dirname, "../assets/knowledge", SCHOOL_DOCS_FILE),
    resolve(__dirname, "../../assets/knowledge", SCHOOL_DOCS_FILE),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function indexSchoolDocs(data: SchoolDocsFile) {
  return data.chunks.map((chunk, index) => {
    const doc = data.documents[chunk.d];
    const titleKey = normalizeKnowledgeText(`${doc.title} ${chunk.h}`);
    return {
      index,
      doc,
      heading: chunk.h,
      text: chunk.t,
      titleKey,
      bodyKey: `${titleKey}\n${normalizeKnowledgeText(doc.category)}\n${normalizeKnowledgeText(chunk.t)}`,
    };
  });
}

function loadCorpus() {
  if (corpus !== undefined) return corpus;
  const file = findSchoolDocsFile();
  if (!file) {
    console.warn("[school-docs] knowledge file not found; school document answers are disabled");
    corpus = null;
    return corpus;
  }
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as SchoolDocsFile;
    corpus = { source: data.source, chunks: indexSchoolDocs(data) };
  } catch (error) {
    console.warn("[school-docs] failed to load knowledge file", error instanceof Error ? error.message : error);
    corpus = null;
  }
  return corpus;
}

export function setSchoolDocsForTests(data?: SchoolDocsFile | null) {
  if (data === undefined) {
    corpus = undefined;
    return;
  }
  corpus = data ? { source: data.source, chunks: indexSchoolDocs(data) } : null;
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
  for (const { entry, coverage } of ranked) {
    const used = perDoc.get(entry.doc.id) || 0;
    if (used >= perDocument) continue;
    perDoc.set(entry.doc.id, used + 1);
    hits.push({
      documentId: entry.doc.id,
      title: entry.doc.title,
      category: entry.doc.category,
      status: entry.doc.status,
      date: entry.doc.date,
      sourceUrl: entry.doc.sourceUrl,
      heading: entry.heading,
      excerpt: focusedExcerpt(entry.text, terms, options.excerptChars ?? 700),
      coverage,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
