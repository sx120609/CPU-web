import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["target", "rel", "data-size", "data-align", "data-image-album", "data-image-count"],
    // 允许学校公告中常见的表格相关标签
    ADD_TAGS: ["table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "sub", "sup"],
  });
}

/** 从 Markdown 提取纯文本摘要 */
export function mdSummary(md: string, max = 80): string {
  const text = md
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[#*`>_~\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}
