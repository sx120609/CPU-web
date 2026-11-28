/**
 * 学校事务资料整理脚本共用的清洗与切段：import-school-knowledge.mjs（资料包）和
 * build-school-guides.mjs（各部门网站的办事指南）都用这一套，切出的段落格式一致。
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

const CHUNK_TARGET = 620;
const CHUNK_MAX = 900;

export async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh"))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}


export function cleanCell(value) {
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
export function htmlTablesToRows(text) {
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

export function isStudentList(lines) {
  return lines.filter((line) => STUDENT_NUMBER_PATTERN.test(withoutUrls(line))).length >= STUDENT_LIST_LINE_THRESHOLD;
}

export function scrubLines(lines, stats) {
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

export function normalizeBody(raw, stats) {
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

export function chunkDocument(lines, docTitle) {
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

