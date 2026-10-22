import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { findKnowledgeAsset, KNOWLEDGE_EMBEDDING_MODEL, loadKnowledgeEmbedder, loadKnowledgeVectors } from "../src/services/knowledgeEmbedding";
import { searchSchoolDocs } from "../src/services/schoolDocsKnowledge";

// 学生常问的学校事务问题，每题列出答案必须出现的原文片段（金额、文号、关键条款）。
// 检查的是拾间AI 实际收到的资料：前 5 条结果的正文、note 和附带的相关条款。
type EvalQuestion = { id: number; q: string; keys: string[] };
const questions = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "knowledgeRetrievalEval.json"), "utf8")) as EvalQuestion[];
const REQUIRED_RECALL = 0.97;

const modelPresent = Boolean(findKnowledgeAsset("models", KNOWLEDGE_EMBEDDING_MODEL));

test("knowledge vectors line up with every passage in the knowledge files", { skip: !modelPresent && "run scripts/fetch-knowledge-model.mjs to enable" }, async () => {
  const store = loadKnowledgeVectors();
  assert.ok(store, "assets/knowledge/school-vectors.{bin,json} missing; run scripts/build-knowledge-vectors.ts");
  const { listSchoolDocPassages } = await import("../src/services/schoolDocsKnowledge");
  const stale = listSchoolDocPassages().filter((passage) => !store.rows.has(passage.hash));
  assert.equal(stale.length, 0, `${stale.length} passages have no vector; rerun scripts/build-knowledge-vectors.ts`);
});

test("retrieval puts the answer in front of the model for common student questions", { skip: !modelPresent && "run scripts/fetch-knowledge-model.mjs to enable" }, async () => {
  assert.ok(await loadKnowledgeEmbedder(), "knowledge model failed to load");
  let found = 0;
  let total = 0;
  const misses: string[] = [];
  for (const question of questions) {
    const hits = await searchSchoolDocs(question.q);
    const text = hits.map((hit) => [hit.docNo, hit.heading, hit.excerpt, hit.note,
      ...(hit.related || []).flatMap((item) => [item.heading, item.excerpt])].join("\n")).join("\n");
    const missing = question.keys.filter((key) => !text.includes(key));
    found += question.keys.length - missing.length;
    total += question.keys.length;
    if (missing.length) misses.push(`${question.id} ${question.q} — 缺 ${missing.join("、")}`);
  }
  const recall = found / total;
  assert.ok(recall >= REQUIRED_RECALL, `recall ${found}/${total} = ${recall.toFixed(3)} < ${REQUIRED_RECALL}\n${misses.join("\n")}`);
});
