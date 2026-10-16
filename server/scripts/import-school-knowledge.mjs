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
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const CHUNK_TARGET = 620;
const CHUNK_MAX = 900;

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

async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh"))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
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

function cleanCell(value) {
  return value
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

/** HTML 表格改成“格 | 格”的行，便于切段时逐行处理并重复表头。 */
function htmlTablesToRows(text) {
  return text.replace(/<table[\s\S]*?<\/table>/giu, (table) => {
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) => {
      const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/giu)].map((cell) => cleanCell(cell[1]));
      return cells.filter(Boolean).join(" | ");
    }).filter(Boolean);
    return `\n\n${rows.map((row) => `@@ROW ${row}`).join("\n")}\n\n`;
  });
}

// 本科学号（20 开头的 10 位）、推免报名号（20 开头的 11 位）、15 位考生编号、18 位身份证号。
// QQ 群号、手机号（1 开头）、链接里的数字不算。
const STUDENT_NUMBER_PATTERN = /(?<!\d)20[0-3]\d{7}(?!\d)/u;
const PERSONAL_NUMBER_PATTERN = /(?<!\d)20[0-3]\d{7,8}(?!\d)|(?<!\d)\d{15}(?!\d)|(?<!\d)\d{17}[\dXx](?![\dXx])/u;
// 正文里出现这么多行学号的，就是名单（文件名不一定写“名单”，例如“01-附件”）。
const STUDENT_LIST_LINE_THRESHOLD = 4;

function withoutUrls(line) {
  return line.replace(/https?:\/\/\S+/giu, " ").replace(/\]\([^)]*\)/gu, "]");
}

function isStudentList(lines) {
  return lines.filter((line) => STUDENT_NUMBER_PATTERN.test(withoutUrls(line))).length >= STUDENT_LIST_LINE_THRESHOLD;
}

function scrubLines(lines, stats) {
  const kept = [];
  for (const line of lines) {
    if (PERSONAL_NUMBER_PATTERN.test(withoutUrls(line))) {
      stats.personalLines += 1;
      continue;
    }
    kept.push(line);
  }
  return kept;
}

function normalizeBody(raw, stats) {
  let text = raw.replace(/^﻿/u, "").replace(/\r\n?/gu, "\n");
  text = text.replace(/<!--[\s\S]*?-->/gu, "");
  text = htmlTablesToRows(text);
  const lines = text.split("\n");
  const meta = { sourceUrl: null, extracted: null };
  const body = [];
  for (const rawLine of lines) {
    let line = rawLine.trimEnd();
    if (/^>\s*资料编号：/u.test(line)) continue;
    if (/^>\s*PDF机器提取文本/u.test(line)) {
      meta.extracted = "pdf";
      continue;
    }
    if (/^>\s*.*(?:适用年份|仅用于检索定位|提取为Markdown|来源编号：)/u.test(line)) continue;
    const source = line.match(/^来源：\s*(https?:\/\/\S+)/u);
    if (source) {
      meta.sourceUrl ??= source[1];
      continue;
    }
    if (/^（校内受限页面/u.test(line)) continue;
    line = line.replace(/!\[[^\]]*\]\([^)]*\)/gu, "").replace(/<img[^>]*>/giu, "");
    // 指向资料包本地文件（_assets、原件）的链接只留文字。
    line = line.replace(/\[([^\]]*)\]\(<?(?!https?:)[^)]*>?\)/gu, "$1");
    // 目录页的“标题....-12-”“标题 …… - 224 -”行。
    if (/(?:[.·]{3,}|…+)\s*-?\s*\d+\s*-?\s*$/u.test(line)) continue;
    // Markdown 表格：去掉分隔行，其余按行保留。
    if (/^\s*\|?\s*:?-{3,}/u.test(line)) continue;
    if (/^\s*\|.*\|\s*$/u.test(line)) {
      line = `@@ROW ${line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cleanCell(cell)).join(" | ")}`;
    }
    body.push(line);
  }
  if (isStudentList(body)) return { meta, lines: [], studentList: true };
  return { meta, lines: scrubLines(body, stats) };
}

function headingLevel(text) {
  if (/^第[一二三四五六七八九十]+(?:部分|编)/u.test(text)) return "part";
  if (/^第[一二三四五六七八九十百零\d]+[章节]/u.test(text)) return "chapter";
  return "title";
}

function splitLongParagraph(paragraph) {
  if (paragraph.length <= CHUNK_MAX) return [paragraph];
  const pieces = [];
  let current = "";
  for (const sentence of paragraph.split(/(?<=[。；！？])/u)) {
    if (current && current.length + sentence.length > CHUNK_TARGET) {
      pieces.push(current);
      current = "";
    }
    current += sentence;
    while (current.length > CHUNK_MAX) {
      pieces.push(current.slice(0, CHUNK_TARGET));
      current = current.slice(CHUNK_TARGET);
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function chunkDocument(lines, docTitle) {
  const chunks = [];
  const context = { part: "", title: "", chapter: "" };
  let buffer = [];
  let size = 0;
  let tableHeader = null;
  const heading = () => [context.part, context.title && context.title !== docTitle ? context.title : "", context.chapter]
    .filter(Boolean).join(" > ");
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text && (text.match(/[㐀-鿿A-Za-z0-9]/gu) || []).length >= 12) chunks.push({ h: heading(), t: text });
    buffer = [];
    size = 0;
  };
  const push = (text) => {
    if (size && size + text.length > CHUNK_TARGET) {
      flush();
      if (tableHeader && text.startsWith("@@ROW")) {
        buffer.push(tableHeader);
        size = tableHeader.length;
      }
    }
    buffer.push(text);
    size += text.length + 1;
  };

  let paragraph = [];
  // 短段落先压一下：如果下面紧跟表格，它就是表格标题，改作小标题而不是正文。
  let pendingCaption = null;
  const releaseCaption = () => {
    if (pendingCaption === null) return;
    const caption = pendingCaption;
    pendingCaption = null;
    push(caption);
  };
  const endParagraph = () => {
    if (!paragraph.length) return;
    const joined = paragraph.join("").replace(/[ \t　]+/gu, " ").trim();
    paragraph = [];
    if (!joined) return;
    releaseCaption();
    if (joined.length <= 40 && !tableHeader) {
      pendingCaption = joined;
      return;
    }
    for (const piece of splitLongParagraph(joined)) push(piece);
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*#*$/u);
    if (headingMatch) {
      endParagraph();
      releaseCaption();
      tableHeader = null;
      const text = cleanCell(headingMatch[1]);
      if (!text || text === "目录") continue;
      flush();
      const level = headingLevel(text);
      if (level === "part") Object.assign(context, { part: text, title: "", chapter: "" });
      else if (level === "chapter") context.chapter = text;
      else Object.assign(context, { title: text, chapter: "" });
      continue;
    }
    if (line.startsWith("@@ROW ")) {
      // 表格前紧挨着的一行短标题（“2026版…自然科学类共识期刊目录”）作为这张表的小标题。
      if (!tableHeader) {
        endParagraph();
        if (pendingCaption !== null) {
          flush();
          context.chapter = pendingCaption;
          pendingCaption = null;
        }
      }
      endParagraph();
      const row = line.slice(6).trim();
      if (!row) continue;
      const formatted = `@@ROW ${row}`;
      if (!tableHeader) tableHeader = formatted;
      push(formatted);
      continue;
    }
    if (!line.trim()) {
      endParagraph();
      tableHeader = null;
      continue;
    }
    // 手动换行的段落合并成一段（中文不加空格）。
    paragraph.push(paragraph.length && /[A-Za-z0-9]$/u.test(paragraph[paragraph.length - 1]) ? ` ${line.trim()}` : line.trim());
    if (/^(?:[-*+]|\d+[.、)]|[（(]?[一二三四五六七八九十]+[）)、])/u.test(line.trim())) endParagraph();
  }
  endParagraph();
  releaseCaption();
  flush();

  const seen = new Set();
  return chunks
    .map((chunk) => ({ ...chunk, t: chunk.t.replace(/@@ROW /gu, "") }))
    .filter((chunk) => {
      if (seen.has(chunk.t)) return false;
      seen.add(chunk.t);
      return true;
    });
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
