import { shallowRef } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { normalizeAdjacentStrongDelimiters, normalizeBareUrlBoundaries } from "./markdownNormalize";

type KatexRenderer = typeof import("katex").default;

// KaTeX 及其样式体积较大，只在内容真正出现公式时才按需加载。
// katexReady 是响应式标记：公式渲染时读取它，加载完成后依赖该结果的 computed / 模板会自动重新渲染。
let katex: KatexRenderer | null = null;
const katexReady = shallowRef(false);
let katexLoading: Promise<boolean> | null = null;

export function loadMarkdownMath(): Promise<boolean> {
  if (katex) return Promise.resolve(true);
  katexLoading ??= import("./markdownMath")
    .then((module) => {
      katex = module.default;
      katexReady.value = true;
      return true;
    })
    .catch(() => {
      katexLoading = null;
      return false;
    });
  return katexLoading;
}

/** 转换结果是否仍依赖尚未加载的 KaTeX；需要一次拿到最终 HTML 的调用方应先等待 loadMarkdownMath()。 */
export function markdownNeedsMathLoading(md: string) {
  return !katex && prepareMarkdown(md).includes("$");
}

/** 已保存的 HTML 可能带有 KaTeX 排版结果，显示前需要加载 KaTeX 样式。 */
export function ensureMarkdownMathStyles(html: string) {
  if (!katex && /\bclass="[^"]*\bkatex\b/.test(html)) void loadMarkdownMath();
}

marked.setOptions({ breaks: true, gfm: true });
marked.use({
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      start(source: string) {
        return source.indexOf("$$");
      },
      tokenizer(source: string) {
        const match = /^\$\$\s*\n?([\s\S]+?)\n?\s*\$\$(?:\n|$)/.exec(source);
        if (!match) return undefined;
        return { type: "mathBlock", raw: match[0], text: match[1].trim() };
      },
      renderer(token: { text: string; raw: string }) {
        return renderKatex(token.text, true, token.raw);
      },
    },
    {
      name: "mathInline",
      level: "inline",
      start(source: string) {
        return source.indexOf("$");
      },
      tokenizer(source: string) {
        const match = /^\$(?!\$)((?:\\.|[^$\\\n])+?)\$/.exec(source);
        if (!match) return undefined;
        return { type: "mathInline", raw: match[0], text: match[1].trim() };
      },
      renderer(token: { text: string; raw: string }) {
        return renderKatex(token.text, false, token.raw);
      },
    },
  ],
} as any);

function prepareMarkdown(md: string) {
  return autoFormatBareFormulaLines(normalizeAdjacentStrongDelimiters(normalizeBareUrlBoundaries(md)));
}

export function renderMarkdown(md: string): string {
  const raw = marked.parse(prepareMarkdown(md), { async: false }) as string;
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
  ensureMarkdownMathStyles(sanitized);
  return normalizeRenderedMarkup(sanitized);
}

function renderKatex(expression: string, displayMode: boolean, source: string) {
  if (!katexReady.value || !katex) {
    // KaTeX 加载完成前先显示公式原文，加载后自动替换为排版结果。
    void loadMarkdownMath();
    const text = escapeHtml(source.trim());
    return displayMode ? `<p>${text}</p>` : text;
  }
  return katex.renderToString(expression, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    trust: false,
    output: "htmlAndMathml",
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function autoFormatBareFormulaLines(markdown: string) {
  let insideFence = false;
  return markdown.split("\n").map((line) => {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      insideFence = !insideFence;
      return line;
    }
    if (
      insideFence
      || !trimmed
      || trimmed.includes("$")
      || !/^[A-Za-z][A-Za-z0-9_]*(?:\/\d+)?\s*=\s*\S.+$/.test(trimmed)
    ) {
      return line;
    }
    return `$$${normalizeBareFormula(trimmed)}$$`;
  }).join("\n");
}

function normalizeBareFormula(formula: string) {
  const [rawLeft, ...rawRightParts] = formula.split("=");
  if (!rawRightParts.length) return formula;
  const left = normalizeFormulaTokens(rawLeft.trim());
  let right = normalizeFormulaTokens(rawRightParts.join("=").trim());

  const parenthesizedFraction = /^\((.+)\)\/\((.+)\)$/.exec(right);
  const simpleFraction = /^([A-Za-z0-9_{}.\-\\]+)\/([A-Za-z0-9_{}.\-\\]+)$/.exec(right);
  if (parenthesizedFraction) {
    right = `\\frac{${parenthesizedFraction[1]}}{${parenthesizedFraction[2]}}`;
  } else if (simpleFraction) {
    right = `\\frac{${simpleFraction[1]}}{${simpleFraction[2]}}`;
  }
  return `${left} = ${right}`;
}

function normalizeFormulaTokens(value: string) {
  const replacements: Array<[RegExp, string]> = [
    [/\bAUCpo\b/g, "AUC_{po}"],
    [/\bAUCiv\b/g, "AUC_{iv}"],
    [/\bDosepo\b/g, "Dose_{po}"],
    [/\bDoseiv\b/g, "Dose_{iv}"],
    [/\bCss\b/g, "C_{ss}"],
    [/\bt1\/2\b/g, "t_{1/2}"],
    [/\bke\b/g, "k_e"],
    [/\bVd\b/g, "V_d"],
    [/\bC([012])\b/g, "C_$1"],
    [/\bt([12])\b/g, "t_$1"],
    [/\bR0\b/g, "R_0"],
    [/\bln\b/g, "\\ln"],
  ];
  let normalized = value
    .replace(/[−–—]/g, "-")
    .replace(/·/g, "\\cdot ");
  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/e\^\(([^)]+)\)/g, "e^{$1}");
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
