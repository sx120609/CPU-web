#!/usr/bin/env node
/**
 * 把“学校事务问答资料”压缩包解压后的目录整理成拾间AI 的检索语料。
 *
 *   node server/scripts/import-school-knowledge.mjs <解压后的“中国药科大学学校问答资料”目录>
 *
 * 输出 server/assets/knowledge/school-docs.json（文档清单 + 已切好的段落），并在终端列出
 * 收录、跳过的文件和原因。规则：
 * - 只收 Markdown 正文。网页快照、差异补充、待核材料、目录页、汇编（与原文重复）、
 *   公众号/小红书/直播稿这类非官方整理不收。
 * - 名单、评定结果、加分表、一志愿名单这类含学生姓名学号排名的资料不收；
 *   收录的正文里仍带学号、考生编号、身份证号的行整行删除。
 * - 90_历史资料标为 historical，91_汇总与辅助标为 summary，其余为 current。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkDocument, cleanCell, normalizeBody, walk } from "./lib/knowledgeChunks.mjs";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = path.join(serverRoot, "assets", "knowledge", "school-docs.json");
const archiveRoot = process.argv[2];
const archiveLabel = process.argv[3] || "中国药科大学_学校事务问答资料_2026-10-15";
if (!archiveRoot) {
  console.error("用法：node server/scripts/import-school-knowledge.mjs <资料目录> [资料包名称]");
  process.exit(1);
}

const SKIPPED_DIRECTORIES = new Set(["92_网页快照", "99_待核材料", "_assets", "原件"]);
const CATEGORY_NAMES = {
  "01": "校园事务与研究生培养",
  "02": "本校本科生推免资格与推荐",
  "03": "申请药大推免与直博",
  "04": "硕士统考招生",
  "05": "科研期刊与会议",
};
const PERSONAL_LIST_PATTERN = /名单|评定结果|加分公示|加分总表|递补|替补|保研人数|一志愿|全面发展评价(?!指导)/u;
const SUMMARY_ALLOW_PATTERN = /汇总说明|汇总对比表|汇总表|第二轮预推免汇总|各学院2027年接收推免生预报名通知汇总|预报名通知-校级/u;

function skipReason(relativePath) {
  const parts = relativePath.split(/[\\/]/u);
  const file = parts[parts.length - 1];
  if (parts.some((part) => SKIPPED_DIRECTORIES.has(part))) return "快照/待核/原件目录";
  if (parts.length === 1) return "资料库说明文件";
  if (!file.endsWith(".md")) return "非 Markdown";
  if (/差异补充/u.test(file)) return "解析差异补充（正文已收）";
  if (PERSONAL_LIST_PATTERN.test(file)) return "含学生个人信息的名单或评定结果";
  if (parts[0] === "91_汇总与辅助" && !SUMMARY_ALLOW_PATTERN.test(file)) return "非官方整理稿、目录或与原文重复的汇编";
  return null;
}

function categoryFor(relativePath) {
  const parts = relativePath.split("/");
  const top = parts[0];
  const code = top.slice(0, 2);
  if (CATEGORY_NAMES[code]) return { category: CATEGORY_NAMES[code], status: "current" };
  const nested = parts[1]?.slice(0, 2);
  const category = CATEGORY_NAMES[nested] || "其他";
  if (code === "90") return { category, status: "historical" };
  return { category, status: "summary" };
}

function dateFromName(file) {
  const match = file.match(/(20\d{2})-(\d{2})-(\d{2})/u);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * 资料包的文件名是整理者起的完整标题（“S0024_中国药科大学研究生学生手册”），比正文第一个
 * 标题（“第一部分 爱校荣校篇”“附件1”）可靠；只有文件名太短时才用正文标题。
 */
function titleFrom(lines, file) {
  const fromName = file
    .replace(/\.md$/u, "")
    .replace(/^S\d{4}_/u, "")
    .replace(/^20\d{2}-\d{2}-\d{2}-/u, "")
    .replace(/^\d{2}-(?:附件-)?/u, "")
    .replace(/-20\d{2}-\d{2}-\d{2}$/u, "")
    .trim();
  if (fromName.length >= 6) return fromName;
  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/u);
    if (!match) continue;
    const text = cleanCell(match[1]);
    if (text && text !== "目录" && !/^第[一二三四五六七八九十]+部分/u.test(text)) return text;
  }
  return fromName || file;
}

const files = await walk(archiveRoot);
const documents = [];
const chunks = [];
const skipped = [];
let personalLines = 0;
for (const relative of files) {
  const reason = skipReason(relative);
  if (reason) {
    if (relative.endsWith(".md")) skipped.push({ relative, reason });
    continue;
  }
  const file = relative.split("/").pop();
  const id = file.match(/^(S\d{4})_/u)?.[1] || file;
  const stats = { personalLines: 0 };
  const { meta, lines, studentList } = normalizeBody(await readFile(path.join(archiveRoot, relative), "utf8"), stats);
  if (studentList) {
    skipped.push({ relative, reason: "正文是含学号的学生名单" });
    continue;
  }
  personalLines += stats.personalLines;
  const title = titleFrom(lines, file);
  const docChunks = chunkDocument(lines, title);
  if (!docChunks.length) {
    skipped.push({ relative, reason: "没有可用正文" });
    continue;
  }
  const { category, status } = categoryFor(relative);
  const docIndex = documents.length;
  documents.push({
    id,
    title,
    category,
    status,
    date: dateFromName(file),
    sourceUrl: meta.sourceUrl,
    extracted: meta.extracted,
  });
  for (const chunk of docChunks) chunks.push({ d: docIndex, ...chunk });
  console.log(`收录 ${id} ${status} ${docChunks.length}段${stats.personalLines ? `，删去${stats.personalLines}行个人信息` : ""}  ${title.slice(0, 50)}`);
}
for (const item of skipped) console.log(`跳过 ${item.relative.slice(0, 90)} —— ${item.reason}`);

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify({
  version: 1,
  source: archiveLabel,
  documents,
  chunks,
}, null, 0)}\n`);
const characters = chunks.reduce((sum, chunk) => sum + chunk.t.length, 0);
console.log(`\n共 ${documents.length} 份文档、${chunks.length} 段、${characters} 字；跳过 ${skipped.length} 份；删去含学号/编号的行 ${personalLines} 行。`);
console.log(`已写入 ${path.relative(process.cwd(), outputFile)}`);
