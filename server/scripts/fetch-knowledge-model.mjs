#!/usr/bin/env node
/**
 * 下载拾间AI 语义检索用的中文向量模型（bge-small-zh-v1.5，int8 ONNX，约 24MB）到
 * server/assets/models/。按固定提交和 SHA-256 校验，已存在且校验通过就跳过。
 * 模型不进仓库：构建时下载并随 dist 一起打进部署制品。
 *
 *   node server/scripts/fetch-knowledge-model.mjs
 *
 * HF_ENDPOINT 可指定镜像；默认先试 huggingface.co，再试 hf-mirror.com。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KNOWLEDGE_MODEL = {
  repo: "Xenova/bge-small-zh-v1.5",
  revision: "75c43b069aac4d136ba6bc1122f995fedcfd2781",
  directory: "bge-small-zh-v1.5",
  files: {
    "onnx/model_quantized.onnx": "15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc",
    "tokenizer.json": "48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26",
    "tokenizer_config.json": "e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a",
  },
};

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const knowledgeModelDirectory = path.join(serverRoot, "assets", "models", KNOWLEDGE_MODEL.directory);

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function verified(file, expected) {
  try {
    return sha256(await readFile(file)) === expected;
  } catch {
    return false;
  }
}

export async function ensureKnowledgeModel({ log = console.log } = {}) {
  const endpoints = [...new Set([process.env.HF_ENDPOINT, "https://huggingface.co", "https://hf-mirror.com"].filter(Boolean))];
  for (const [name, expected] of Object.entries(KNOWLEDGE_MODEL.files)) {
    const target = path.join(knowledgeModelDirectory, name);
    if (await verified(target, expected)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    let lastError = null;
    for (const endpoint of endpoints) {
      const url = `${endpoint.replace(/\/$/u, "")}/${KNOWLEDGE_MODEL.repo}/resolve/${KNOWLEDGE_MODEL.revision}/${name}`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(300_000), redirect: "follow" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const actual = sha256(buffer);
        if (actual !== expected) throw new Error(`SHA-256 ${actual} does not match ${expected}`);
        await writeFile(`${target}.part`, buffer);
        await rename(`${target}.part`, target);
        log(`[knowledge-model] ${name} ← ${endpoint} (${buffer.length} bytes)`);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        log(`[knowledge-model] ${name} from ${endpoint} failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (lastError) throw new Error(`[knowledge-model] could not fetch ${name}: ${lastError.message}`);
  }
  return knowledgeModelDirectory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureKnowledgeModel();
  console.log(`[knowledge-model] ready in ${path.relative(process.cwd(), knowledgeModelDirectory)}`);
}
