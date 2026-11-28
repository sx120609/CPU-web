#!/usr/bin/env node
/**
 * 把 assets/knowledge/guides/<部门>/*.md（各部门网站上的办事指南、常见问题、开放时间、
 * 收费标准、校历等，逐页转录）整理成拾间AI 的检索语料 assets/knowledge/school-guides.json。
 *
 *   node server/scripts/build-school-guides.mjs
 *
 * 每个 Markdown 文件开头是：
 *   # 页面标题
 *   来源：https://…
 *   日期：YYYY-MM-DD（可省略）
 *   部门：教务处
 * 清洗、切段、去个人信息与资料包同一套（lib/knowledgeChunks.mjs）。改了指南之后要重算向量：
 *   npm --prefix server run knowledge:vectors
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkDocument, normalizeBody, walk } from "./lib/knowledgeChunks.mjs";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guidesRoot = path.join(serverRoot, "assets", "knowledge", "guides");
const outputFile = path.join(serverRoot, "assets", "knowledge", "school-guides.json");
const PERSONAL_LIST_PATTERN = /名单|评定结果|获奖|录取结果|(?:拟|结果|人员)公示/u;
// 通知里常留任课老师、经办人的个人手机号。原文公开，但不该由拾间AI 转述，整行去掉；办公室座机保留。
const MOBILE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/u;

function parseHeader(raw) {
  const lines = raw.replace(/^﻿/u, "").replace(/\r\n?/gu, "\n").split("\n");
  const header = { title: "", date: null, department: "" };
  const body = [];
  for (const line of lines) {
    const title = !header.title && line.match(/^#\s+(.+?)\s*$/u);
    if (title) {
      header.title = title[1].trim();
      continue;
    }
    const date = line.match(/^日期：\s*(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/u);
    if (date && !header.date) {
      header.date = `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`;
      continue;
    }
    const department = line.match(/^部门：\s*(.+?)\s*$/u);
    if (department && !header.department) {
      header.department = department[1];
      continue;
    }
    body.push(line);
  }
  return { header, body: body.join("\n") };
}

const files = (await walk(guidesRoot)).filter((file) => file.endsWith(".md"));
const documents = [];
const chunks = [];
const skipped = [];
let personalLines = 0;
for (const relative of files) {
  const fileName = relative.split("/").pop();
  const { header, body } = parseHeader(await readFile(path.join(guidesRoot, relative), "utf8"));
  const title = header.title || fileName.replace(/\.md$/u, "");
  if (PERSONAL_LIST_PATTERN.test(title)) {
    skipped.push({ relative, reason: "名单或公示" });
    continue;
  }
  const stats = { personalLines: 0 };
  const normalized = normalizeBody(body, stats);
  const { meta, studentList } = normalized;
  const lines = normalized.lines.filter((line) => {
    if (!MOBILE_PATTERN.test(line.replace(/https?:\/\/\S+/giu, " "))) return true;
    stats.personalLines += 1;
    return false;
  });
  if (studentList) {
    skipped.push({ relative, reason: "正文是含学号的学生名单" });
    continue;
  }
  if (!meta.sourceUrl) {
    skipped.push({ relative, reason: "缺来源链接" });
    continue;
  }
  personalLines += stats.personalLines;
  const docChunks = chunkDocument(lines, title);
  if (!docChunks.length) {
    skipped.push({ relative, reason: "没有可用正文" });
    continue;
  }
  const department = header.department || relative.split("/")[0];
  const docIndex = documents.length;
  documents.push({
    // 按路径取哈希，增删别的文件时 id 不变。
    id: `G${createHash("sha1").update(relative).digest("hex").slice(0, 8)}`,
    title,
    category: `${department} · 办事指南`,
    status: "current",
    date: header.date,
    sourceUrl: meta.sourceUrl,
    extracted: meta.extracted,
  });
  for (const chunk of docChunks) chunks.push({ d: docIndex, ...chunk });
  console.log(`收录 ${department} ${docChunks.length}段${stats.personalLines ? `，删去${stats.personalLines}行个人信息` : ""}  ${title.slice(0, 50)}`);
}
for (const item of skipped) console.log(`跳过 ${item.relative} —— ${item.reason}`);

const ids = new Set(documents.map((doc) => doc.id));
if (ids.size !== documents.length) throw new Error("guide document ids collide");
await writeFile(outputFile, `${JSON.stringify({
  version: 1,
  source: "各部门网站办事指南",
  documents,
  chunks,
}, null, 0)}\n`);
const characters = chunks.reduce((sum, chunk) => sum + chunk.t.length, 0);
console.log(`\n共 ${documents.length} 份、${chunks.length} 段、${characters} 字；跳过 ${skipped.length} 份；删去含学号/编号的行 ${personalLines} 行。`);
console.log(`已写入 ${path.relative(process.cwd(), outputFile)}`);
