import { Resvg } from "@resvg/resvg-js";
import { lexer, type Token, type Tokens } from "marked";

const QQBOT_AI_IMAGE_WIDTH = 1200;
const QQBOT_AI_IMAGE_SIDE_PADDING = 72;
const QQBOT_AI_IMAGE_BODY_WIDTH = QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING * 2;
const QQBOT_AI_IMAGE_TOP_BAR_HEIGHT = 112;
const QQBOT_AI_IMAGE_FOOTER_HEIGHT = 72;
const QQBOT_AI_IMAGE_MAX_SOURCE_LENGTH = 10_000;
const QQBOT_AI_IMAGE_MAX_HEIGHT = 16_000;
const QQBOT_AI_DISCLOSURE_PATTERN = /以上回复由拾间AI生成，内容可能存在偏差，请自行鉴别并以官方信息为准。?/u;
const QQBOT_MARKDOWN_PATTERN = /(?:^|\n)\s*(?:#{1,6}\s|[-*+]\s+|\d+[.)]\s+|>\s)|(?:\*\*|__|~~|`{1,3})|!?\[[^\]]*\]\([^)]*\)/m;
const QQBOT_AI_FONT_FILES = [
  "C:/Windows/Fonts/msyh.ttc",
  "C:/Windows/Fonts/msyhbd.ttc",
  "C:/Windows/Fonts/simhei.ttf",
  "C:/Windows/Fonts/simsun.ttc",
];

type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  color?: string;
};

type RenderLine = {
  runs: InlineRun[];
  fontSize: number;
  indent: number;
  prefix?: string;
  prefixColor?: string;
  before: number;
  after: number;
  background?: string;
  borderLeft?: boolean;
  rule?: boolean;
};

export function containsQqBotMarkdown(value: string) {
  return QQBOT_MARKDOWN_PATTERN.test(String(value || ""));
}

/** Render a daily AI answer into a QQ-safe PNG message. */
export function renderQqBotAiReplyAsQqMessage(markdown: string) {
  const source = String(markdown || "").trim();
  if (!containsQqBotMarkdown(source)) return null;
  const image = renderQqBotAiReplyImage(source);
  return `[CQ:image,file=base64://${image.toString("base64")}]`;
}

export function renderQqBotAiReplyImage(markdown: string) {
  const normalized = String(markdown || "").replace(/\r\n?/g, "\n").slice(0, QQBOT_AI_IMAGE_MAX_SOURCE_LENGTH);
  const disclosure = normalized.match(QQBOT_AI_DISCLOSURE_PATTERN)?.[0] || "";
  const content = disclosure ? normalized.replace(disclosure, "").trim() : normalized;
  const lines = buildMarkdownLines(content);
  const bodyHeight = lines.reduce((total, line) => total + lineHeight(line) + line.before + line.after, 0);
  const height = Math.min(
    QQBOT_AI_IMAGE_MAX_HEIGHT,
    Math.max(
      QQBOT_AI_IMAGE_TOP_BAR_HEIGHT + QQBOT_AI_IMAGE_FOOTER_HEIGHT + 120,
      QQBOT_AI_IMAGE_TOP_BAR_HEIGHT + bodyHeight + QQBOT_AI_IMAGE_FOOTER_HEIGHT + 56,
    ),
  );
  const svg = buildReplySvg(lines, height, Boolean(disclosure));
  return new Resvg(svg, {
    fitTo: { mode: "width", value: QQBOT_AI_IMAGE_WIDTH },
    font: {
      loadSystemFonts: true,
      fontFiles: QQBOT_AI_FONT_FILES,
      defaultFontFamily: "Microsoft YaHei",
    },
  }).render().asPng();
}

function buildMarkdownLines(markdown: string) {
  const tokens = lexer(markdown, { gfm: true, breaks: true });
  const lines: RenderLine[] = [];
  for (const token of tokens) appendBlockToken(lines, token);
  if (!lines.length) {
    lines.push({
      runs: [{ text: "我暂时没有找到合适的答案。" }],
      fontSize: 28,
      indent: 0,
      before: 20,
      after: 0,
    });
  }
  return lines;
}

function appendBlockToken(lines: RenderLine[], token: Token, options: { indent?: number; borderLeft?: boolean } = {}) {
  const indent = options.indent || 0;
  const borderLeft = options.borderLeft || false;
  switch (token.type) {
    case "space":
      return;
    case "heading":
      appendRuns(lines, inlineRuns(token.tokens), {
        fontSize: Math.max(30, 42 - token.depth * 3),
        indent,
        before: 20,
        after: 8,
        borderLeft,
      });
      return;
    case "paragraph":
      appendRuns(lines, inlineRuns(token.tokens), {
        fontSize: 28,
        indent,
        before: 10,
        after: 4,
        borderLeft,
      });
      return;
    case "text":
      appendRuns(lines, inlineRuns(getTokenChildren(token).length ? getTokenChildren(token) : [token]), {
        fontSize: 28,
        indent,
        before: 10,
        after: 4,
        borderLeft,
      });
      return;
    case "blockquote":
      for (const child of getTokenChildren(token)) appendBlockToken(lines, child, { indent: indent + 24, borderLeft: true });
      return;
    case "list": {
      const list = token as Tokens.List;
      list.items.forEach((item, index) => appendListItem(lines, list, item, index, indent, borderLeft));
      return;
    }
    case "code": {
      const codeLines = String(token.text || "").split("\n");
      codeLines.forEach((line, index) => {
        appendRuns(lines, [{ text: line || " " , code: true, color: "#334155" }], {
          fontSize: 23,
          indent: indent + 18,
          prefix: index === 0 ? "" : undefined,
          before: index === 0 ? 12 : 0,
          after: index === codeLines.length - 1 ? 10 : 0,
          background: "#f2f5f7",
          borderLeft,
        });
      });
      return;
    }
    case "hr":
      lines.push({
        runs: [],
        fontSize: 1,
        indent,
        before: 14,
        after: 8,
        rule: true,
      });
      return;
    case "table": {
      const table = token as Tokens.Table;
      appendTableRow(lines, table.header, indent, borderLeft, true);
      table.rows.forEach((row: Tokens.TableCell[]) => appendTableRow(lines, row, indent, borderLeft, false));
      return;
    }
    case "html":
      appendRuns(lines, [{ text: stripHtml(token.text) }], {
        fontSize: 28,
        indent,
        before: 10,
        after: 4,
        borderLeft,
      });
      return;
    default: {
      const text = "text" in token ? String((token as { text?: unknown }).text || "") : "";
      if (text) appendRuns(lines, [{ text: stripHtml(text) }], { fontSize: 28, indent, before: 10, after: 4, borderLeft });
    }
  }
}

function appendListItem(
  lines: RenderLine[],
  list: Tokens.List,
  item: Tokens.ListItem,
  index: number,
  indent: number,
  borderLeft: boolean,
) {
  const prefix = list.ordered ? `${Number(list.start || 1) + index}. ` : "• ";
  const contentTokens = item.tokens.filter((token) => token.type !== "list");
  const nestedLists = item.tokens.filter((token): token is Tokens.List => token.type === "list");
  appendRuns(lines, inlineRuns(contentTokens), {
    fontSize: 28,
    indent: indent + 8,
    prefix,
    prefixColor: "#438f80",
    before: 8,
    after: 3,
    borderLeft,
  });
  nestedLists.forEach((nested) => nested.items.forEach((nestedItem, nestedIndex) => appendListItem(
    lines,
    nested,
    nestedItem,
    nestedIndex,
    indent + 32,
    borderLeft,
  )));
}

function appendTableRow(
  lines: RenderLine[],
  cells: Tokens.TableCell[],
  indent: number,
  borderLeft: boolean,
  header: boolean,
) {
  const runs: InlineRun[] = [];
  cells.forEach((cell, index) => {
    if (index > 0) runs.push({ text: "  |  ", color: "#94a3b8" });
    runs.push(...inlineRuns(cell.tokens).map((run) => ({ ...run, bold: header || run.bold })));
  });
  appendRuns(lines, runs, {
    fontSize: 25,
    indent,
    before: header ? 12 : 2,
    after: header ? 5 : 2,
    background: header ? "#eef7f4" : undefined,
    borderLeft,
  });
}

function appendRuns(
  lines: RenderLine[],
  runs: InlineRun[],
  options: Omit<RenderLine, "runs"> & { prefix?: string },
) {
  const normalizedRuns = runs
    .map((run) => ({ ...run, text: decodeHtmlEntities(String(run.text || "")) }))
    .filter((run) => run.text.length > 0);
  const prefix = options.prefix || "";
  const prefixWidth = estimateTextWidth(prefix, options.fontSize, { bold: true });
  const wrapped = wrapRuns(normalizedRuns, Math.max(240, QQBOT_AI_IMAGE_BODY_WIDTH - options.indent - prefixWidth), options.fontSize);
  wrapped.forEach((lineRuns, index) => {
    lines.push({
      ...options,
      runs: lineRuns,
      prefix: index === 0 ? prefix : prefix ? " ".repeat(Array.from(prefix).length) : undefined,
      before: index === 0 ? options.before : 0,
      after: index === wrapped.length - 1 ? options.after : 0,
    });
  });
}

function wrapRuns(runs: InlineRun[], maxWidth: number, fontSize: number) {
  const output: InlineRun[][] = [];
  let line: InlineRun[] = [];
  let width = 0;
  const pushLine = () => {
    while (line.length && !line[line.length - 1].text.trim()) line.pop();
    output.push(line);
    line = [];
    width = 0;
  };
  for (const run of runs) {
    for (const char of Array.from(run.text)) {
      if (char === "\n") {
        pushLine();
        continue;
      }
      const charWidth = estimateTextWidth(char, fontSize, run);
      if (line.length && width + charWidth > maxWidth) pushLine();
      if (!line.length && /\s/u.test(char)) continue;
      const previous = line[line.length - 1];
      if (previous && sameRunStyle(previous, run)) previous.text += char;
      else line.push({ ...run, text: char });
      width += charWidth;
    }
  }
  if (line.length || !output.length) pushLine();
  return output;
}

function inlineRuns(tokens: Token[] | undefined): InlineRun[] {
  if (!tokens?.length) return [];
  const runs: InlineRun[] = [];
  const append = (items: InlineRun[], style: Partial<InlineRun> = {}) => {
    items.forEach((item) => {
      const next = { ...item, ...style };
      const previous = runs[runs.length - 1];
      if (previous && sameRunStyle(previous, next)) previous.text += next.text;
      else runs.push(next);
    });
  };
  for (const token of tokens) {
    switch (token.type) {
      case "strong": append(inlineRuns(token.tokens), { bold: true }); break;
      case "em": append(inlineRuns(token.tokens), { italic: true }); break;
      case "del": append(inlineRuns(token.tokens), { strike: true }); break;
      case "codespan": append([{ text: token.text, code: true, color: "#b42318" }]); break;
      case "link": {
        const linkText = inlineRuns(token.tokens);
        append(linkText, { color: "#2f8f80" });
        const href = safeDisplayUrl(token.href);
        if (href && href !== flattenRunText(linkText)) append([{ text: ` (${href})`, color: "#2f8f80" }]);
        break;
      }
      case "image": append([{ text: `[${token.text || "图片"}]`, color: "#667085" }]); break;
      case "br": append([{ text: "\n" }]); break;
      case "html":
      case "tag": append([{ text: stripHtml(token.text) }]); break;
      case "escape":
      case "text": {
        const children = getTokenChildren(token);
        append(children.length ? inlineRuns(children) : [{ text: "text" in token ? String(token.text || "") : "" }]);
        break;
      }
      default: {
        const text = "text" in token ? String((token as { text?: unknown }).text || "") : "";
        if (text) append([{ text: stripHtml(text) }]);
      }
    }
  }
  return runs;
}

function getTokenChildren(token: Token) {
  if ("tokens" in token && Array.isArray(token.tokens)) return token.tokens as Token[];
  return [];
}

function buildReplySvg(lines: RenderLine[], height: number, hasDisclosure: boolean) {
  let y = QQBOT_AI_IMAGE_TOP_BAR_HEIGHT + 46;
  const body: string[] = [];
  for (const line of lines) {
    y += line.before;
    if (y > height - QQBOT_AI_IMAGE_FOOTER_HEIGHT - 20) break;
    const lineHeightValue = lineHeight(line);
    if (line.rule) {
      body.push(`<line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${y}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${y}" stroke="#dce7e4" stroke-width="2" />`);
      y += lineHeightValue + line.after;
      continue;
    }
    const x = QQBOT_AI_IMAGE_SIDE_PADDING + line.indent;
    if (line.background) {
      body.push(`<rect x="${x - 12}" y="${y - line.fontSize - 10}" width="${QQBOT_AI_IMAGE_BODY_WIDTH - line.indent + 12}" height="${lineHeightValue + 14}" rx="10" fill="${line.background}" />`);
    }
    if (line.borderLeft) {
      body.push(`<rect x="${x - 18}" y="${y - line.fontSize - 4}" width="5" height="${lineHeightValue}" rx="2" fill="#83b9ae" />`);
    }
    const prefix = line.prefix || "";
    const prefixWidth = estimateTextWidth(prefix, line.fontSize, { bold: true });
    const prefixSvg = prefix
      ? `<tspan fill="${line.prefixColor || "#667085"}" font-weight="700">${escapeXml(prefix)}</tspan>`
      : "";
    const runSvg = line.runs.map((run) => renderRun(run)).join("");
    body.push(`<text x="${x}" y="${y}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${line.fontSize}" fill="#263238">${prefixSvg}${runSvg}</text>`);
    y += lineHeightValue + line.after;
    void prefixWidth;
  }
  const footerY = height - QQBOT_AI_IMAGE_FOOTER_HEIGHT;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${QQBOT_AI_IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${QQBOT_AI_IMAGE_WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${QQBOT_AI_IMAGE_WIDTH}" height="${height}" fill="#ffffff" />
  <rect width="${QQBOT_AI_IMAGE_WIDTH}" height="${QQBOT_AI_IMAGE_TOP_BAR_HEIGHT}" fill="#438f80" />
  <circle cx="${QQBOT_AI_IMAGE_SIDE_PADDING - 22}" cy="56" r="19" fill="#dff3ee" />
  <text x="${QQBOT_AI_IMAGE_SIDE_PADDING + 12}" y="70" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="34" font-weight="800" fill="#ffffff">拾间AI</text>
  <text x="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y="67" text-anchor="end" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="21" fill="#e8f6f2">药大拾间 · AI 助手</text>
  <rect x="0" y="${footerY}" width="${QQBOT_AI_IMAGE_WIDTH}" height="${QQBOT_AI_IMAGE_FOOTER_HEIGHT}" fill="#f0f7f5" />
  <text x="${QQBOT_AI_IMAGE_SIDE_PADDING}" y="${footerY + 44}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="20" fill="#55716b">${escapeXml(hasDisclosure ? "以上内容由拾间AI生成，请注意甄别。" : "拾间AI · 药大拾间")}</text>
  ${body.join("\n  ")}
</svg>`;
}

function renderRun(run: InlineRun) {
  const attrs = [
    run.bold ? `font-weight="700"` : "",
    run.italic ? `font-style="italic"` : "",
    run.code ? `font-family="Consolas, Microsoft YaHei, monospace"` : "",
    run.color ? `fill="${run.color}"` : "",
    run.strike ? `text-decoration="line-through"` : "",
  ].filter(Boolean).join(" ");
  return `<tspan${attrs ? ` ${attrs}` : ""}>${escapeXml(run.text)}</tspan>`;
}

function lineHeight(line: RenderLine) {
  return line.rule ? 2 : Math.ceil(line.fontSize * 1.58);
}

function estimateTextWidth(text: string, fontSize: number, style: Pick<InlineRun, "bold" | "code"> = {}) {
  let width = 0;
  for (const char of Array.from(String(text || ""))) {
    if (/\s/u.test(char)) width += fontSize * 0.34;
    else if (/[\u2e80-\u9fff\uff00-\uffef\u{1f300}-\u{1faff}]/u.test(char)) width += fontSize;
    else width += fontSize * (style.code ? 0.62 : style.bold ? 0.62 : 0.56);
  }
  return width;
}

function sameRunStyle(left: InlineRun, right: InlineRun) {
  return Boolean(left.bold) === Boolean(right.bold)
    && Boolean(left.italic) === Boolean(right.italic)
    && Boolean(left.code) === Boolean(right.code)
    && Boolean(left.strike) === Boolean(right.strike)
    && left.color === right.color;
}

function flattenRunText(runs: InlineRun[]) {
  return runs.map((run) => run.text).join("");
}

function safeDisplayUrl(value: string) {
  const href = String(value || "").trim();
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(href)) return href;
  return "";
}

function stripHtml(value: string) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, ""));
}

function decodeHtmlEntities(value: string) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function escapeXml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
