/**
 * 拾间AI 语义检索：bge-small-zh-v1.5（int8 ONNX）把问题和资料段落映射成 512 维向量，
 * 补上关键词检索对不上说法的情况（问“后果”，规定写“处分”；问“毕业要满足什么条件”，
 * 规定写“准予毕业”）。
 *
 * - 模型由 scripts/fetch-knowledge-model.mjs 下载到 assets/models/，随 dist 发布。
 * - 段落向量由 scripts/build-knowledge-vectors.ts 预先算好，存为 int8（每行一个缩放系数），
 *   按段落内容哈希对齐；资料改了而向量没重算的段落只走关键词检索。
 * - 线上只给问题算一次向量（单线程、几毫秒）。模型或原生库加载失败时返回 null，
 *   检索退回纯关键词，服务照常运行。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const KNOWLEDGE_EMBEDDING_MODEL = "bge-small-zh-v1.5";
// bge 的检索用法：问题加这句前缀，段落不加。
const QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";
// 段落按“标题 文号 小标题 + 正文”编码；截断长度与模型 512 token 的上限相当。
const PASSAGE_MAX_CHARS = 900;
const VECTORS_FILE = "school-vectors";

export type KnowledgeEmbedder = {
  dimensions: number;
  embedQuery(text: string): Promise<Float32Array>;
  embedPassage(text: string): Promise<Float32Array>;
};

export type KnowledgeVectorStore = {
  dimensions: number;
  /** 段落哈希 → 行号。 */
  rows: Map<string, number>;
  values: Int8Array;
  scales: Float32Array;
};

type VectorManifest = { model: string; dimensions: number; count: number; hashes: string[] };

export function passageText(title: string, docNo: string | undefined, heading: string, text: string) {
  return `${title} ${docNo || ""} ${heading}\n${text}`.slice(0, PASSAGE_MAX_CHARS);
}

export function passageHash(passage: string) {
  return createHash("sha1").update(passage).digest("hex").slice(0, 16);
}

export function findKnowledgeAsset(...segments: string[]) {
  const candidates = [resolve(__dirname, "../assets", ...segments), resolve(__dirname, "../../assets", ...segments)];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

let embedder: Promise<KnowledgeEmbedder | null> | undefined;

/** 加载一次，之后复用；失败返回 null，不抛错。 */
export function loadKnowledgeEmbedder(): Promise<KnowledgeEmbedder | null> {
  embedder ??= createEmbedder().catch((error) => {
    console.warn("[knowledge-embedding] model unavailable; falling back to keyword search",
      error instanceof Error ? error.message : error);
    return null;
  });
  return embedder;
}

export function setKnowledgeEmbedderForTests(value?: KnowledgeEmbedder | null) {
  embedder = value === undefined ? undefined : Promise.resolve(value);
}

async function createEmbedder(): Promise<KnowledgeEmbedder | null> {
  const directory = findKnowledgeAsset("models", KNOWLEDGE_EMBEDDING_MODEL);
  if (!directory) {
    console.warn("[knowledge-embedding] model files not found; semantic search is disabled");
    return null;
  }
  const ort = await import("onnxruntime-node");
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const tokenizer = new Tokenizer(
    JSON.parse(readFileSync(resolve(directory, "tokenizer.json"), "utf8")),
    JSON.parse(readFileSync(resolve(directory, "tokenizer_config.json"), "utf8")),
  );
  // 单线程：一次问题编码只要几毫秒，不和主服务抢 CPU。建库脚本可调高。
  const threads = Math.max(1, Number(process.env.KNOWLEDGE_EMBED_THREADS) || 1);
  const session = await ort.InferenceSession.create(resolve(directory, "onnx", "model_quantized.onnx"), {
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    executionMode: "sequential",
    graphOptimizationLevel: "all",
  });
  const needsTokenTypes = session.inputNames.includes("token_type_ids");
  // 逐条编码（batch=1）：int8 动态量化按整批数据定缩放，成批编码与单条编码结果会有偏差，
  // 段落和问题都单条编码才一致。
  const encode = async (text: string) => {
    const encoded = tokenizer.encode(text);
    const ids = encoded.ids.slice(0, 512);
    const length = ids.length;
    const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, length]),
      attention_mask: new ort.Tensor("int64", new BigInt64Array(length).fill(1n), [1, length]),
    };
    if (needsTokenTypes) feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(length), [1, length]);
    const output = await session.run(feeds);
    const hidden = output[session.outputNames[0]].data as Float32Array;
    const dimensions = hidden.length / length;
    // bge 取 [CLS] 向量并归一化。
    const vector = hidden.slice(0, dimensions);
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm) || 1;
    for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
    return vector;
  };
  const probe = await encode("测试");
  return {
    dimensions: probe.length,
    embedQuery: (text) => encode(QUERY_PREFIX + text),
    embedPassage: encode,
  };
}

let vectors: KnowledgeVectorStore | null | undefined;

export function loadKnowledgeVectors(): KnowledgeVectorStore | null {
  if (vectors !== undefined) return vectors;
  const manifestFile = findKnowledgeAsset("knowledge", `${VECTORS_FILE}.json`);
  const binaryFile = findKnowledgeAsset("knowledge", `${VECTORS_FILE}.bin`);
  if (!manifestFile || !binaryFile) {
    vectors = null;
    return vectors;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as VectorManifest;
    vectors = decodeVectorStore(manifest, readFileSync(binaryFile));
  } catch (error) {
    console.warn("[knowledge-embedding] failed to load vectors", error instanceof Error ? error.message : error);
    vectors = null;
  }
  return vectors;
}

export function setKnowledgeVectorsForTests(value?: KnowledgeVectorStore | null) {
  vectors = value;
}

/** 文件布局：count×dimensions 个 int8，随后 count 个 float32 缩放系数。 */
export function decodeVectorStore(manifest: VectorManifest, buffer: Buffer): KnowledgeVectorStore {
  const { count, dimensions } = manifest;
  if (manifest.model !== KNOWLEDGE_EMBEDDING_MODEL) throw new Error(`vectors were built with ${manifest.model}`);
  if (buffer.length !== count * dimensions + count * 4 || manifest.hashes.length !== count) {
    throw new Error("vector file does not match its manifest");
  }
  const values = new Int8Array(buffer.buffer, buffer.byteOffset, count * dimensions);
  const scales = new Float32Array(buffer.buffer.slice(buffer.byteOffset + count * dimensions, buffer.byteOffset + buffer.length));
  return { dimensions, rows: new Map(manifest.hashes.map((hash, row) => [hash, row])), values, scales };
}

export function encodeVectorStore(entries: Array<{ hash: string; vector: Float32Array }>) {
  const dimensions = entries[0]?.vector.length || 0;
  const values = new Int8Array(entries.length * dimensions);
  const scales = new Float32Array(entries.length);
  entries.forEach(({ vector }, row) => {
    let max = 0;
    for (const value of vector) max = Math.max(max, Math.abs(value));
    const scale = max / 127 || 1;
    scales[row] = scale;
    for (let index = 0; index < dimensions; index += 1) values[row * dimensions + index] = Math.round(vector[index] / scale);
  });
  const manifest: VectorManifest = { model: KNOWLEDGE_EMBEDDING_MODEL, dimensions, count: entries.length, hashes: entries.map((entry) => entry.hash) };
  return { manifest, buffer: Buffer.concat([Buffer.from(values.buffer), Buffer.from(scales.buffer)]) };
}

/** 余弦相似度（向量已归一化，int8 行乘回缩放系数）。 */
export function vectorSimilarity(store: KnowledgeVectorStore, row: number, query: Float32Array) {
  const offset = row * store.dimensions;
  let sum = 0;
  for (let index = 0; index < store.dimensions; index += 1) sum += store.values[offset + index] * query[index];
  return sum * store.scales[row];
}
