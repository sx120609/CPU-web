/**
 * 为 school-docs.json / school-regulations.json 的每一段算语义向量，写入
 * assets/knowledge/school-vectors.{bin,json}。资料改了之后运行；已有向量按段落哈希复用，
 * 只给新增或改动的段落编码。
 *
 *   node server/scripts/fetch-knowledge-model.mjs
 *   KNOWLEDGE_EMBED_THREADS=2 npx tsx server/scripts/build-knowledge-vectors.ts
 *
 * 逐段编码（batch=1），与线上问题编码方式一致。默认 2 个线程，不占满机器。
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  encodeVectorStore,
  loadKnowledgeEmbedder,
  loadKnowledgeVectors,
} from "../src/services/knowledgeEmbedding";
import { listSchoolDocPassages } from "../src/services/schoolDocsKnowledge";

process.env.KNOWLEDGE_EMBED_THREADS ||= "2";

async function main() {
  const passages = listSchoolDocPassages();
  if (!passages.length) throw new Error("no knowledge passages found");
  const embedder = await loadKnowledgeEmbedder();
  if (!embedder) throw new Error("knowledge model is missing; run scripts/fetch-knowledge-model.mjs first");
  const previous = loadKnowledgeVectors();
  const unique = [...new Map(passages.map((passage) => [passage.hash, passage])).values()];
  const entries: Array<{ hash: string; vector: Float32Array }> = [];
  let reused = 0;
  const started = Date.now();
  for (const [index, passage] of unique.entries()) {
    const row = previous?.rows.get(passage.hash);
    if (previous && row !== undefined && previous.dimensions === embedder.dimensions) {
      const vector = new Float32Array(previous.dimensions);
      for (let dim = 0; dim < previous.dimensions; dim += 1) {
        vector[dim] = previous.values[row * previous.dimensions + dim] * previous.scales[row];
      }
      entries.push({ hash: passage.hash, vector });
      reused += 1;
    } else {
      entries.push({ hash: passage.hash, vector: await embedder.embedPassage(passage.text) });
    }
    if ((index + 1) % 500 === 0) console.log(`[knowledge-vectors] ${index + 1}/${unique.length} (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  const { manifest, buffer } = encodeVectorStore(entries);
  const directory = resolve(__dirname, "../assets/knowledge");
  writeFileSync(resolve(directory, "school-vectors.bin"), buffer);
  writeFileSync(resolve(directory, "school-vectors.json"), `${JSON.stringify(manifest)}\n`);
  console.log(`[knowledge-vectors] ${entries.length} passages (${reused} reused, ${entries.length - reused} encoded) in ${Math.round((Date.now() - started) / 1000)}s; ${buffer.length} bytes`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
