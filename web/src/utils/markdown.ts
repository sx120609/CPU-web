import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  const sanitized = DOMPurify.sanitize(raw, {
    ADD_ATTR: [
      "class",
      "target",
      "rel",
      "src",
      "href",
      "type",
      "controls",
      "preload",
      "playsinline",
      "poster",
      "muted",
      "loop",
      "data-size",
      "data-align",
      "data-image-album",
      "data-image-count",
      "data-forward-depth",
      "align",
    ],
    // 允许学校公告中常见的表格相关标签
    ADD_TAGS: ["table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "sub", "sup", "video", "source"],
  });
  return normalizeRenderedMarkup(sanitized);
}

export function normalizeSafeBlankTargets(html: string) {
  if (!html || typeof document === "undefined") return html;
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll<HTMLAnchorElement>("a[target]").forEach((anchor) => {
    if (anchor.getAttribute("target")?.toLowerCase() !== "_blank") return;
    const relTokens = new Set((anchor.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
    relTokens.add("noopener");
    relTokens.add("noreferrer");
    anchor.setAttribute("rel", Array.from(relTokens).join(" "));
  });
  return container.innerHTML;
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

function normalizeRenderedMarkup(html: string) {
  if (!html) return html;
  if (typeof document === "undefined") {
    return html.replace(/\salign=(['"]?)(left|center|right)\1/gi, (_match, _quote, align) => ` data-align="${String(align).toLowerCase()}"`);
  }
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll<HTMLElement>("[align]").forEach((element) => {
    const align = String(element.getAttribute("align") || "").trim().toLowerCase();
    if (align === "left" || align === "center" || align === "right") {
      element.setAttribute("data-align", align);
    }
    element.removeAttribute("align");
  });
  return normalizeSafeBlankTargets(container.innerHTML);
}
