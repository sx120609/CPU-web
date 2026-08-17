import { Resvg } from "@resvg/resvg-js";
import { lexer, type Token, type Tokens } from "marked";
import QRCode from "qrcode";

// Keep the geometry of the reference QQBot renderer: a compact 900px card,
// a thin divider below the header, and the source QR block at the bottom.
// The current 拾间AI palette is applied separately in buildReplySvg().
const QQBOT_AI_IMAGE_WIDTH = 900;
const QQBOT_AI_IMAGE_SIDE_PADDING = 58;
const QQBOT_AI_IMAGE_BODY_WIDTH = QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING * 2 - 28;
const QQBOT_AI_IMAGE_TOP_BAR_HEIGHT = 88;
const QQBOT_AI_IMAGE_FOOTER_HEIGHT = 56;
const QQBOT_AI_IMAGE_BODY_TOP_PADDING = 28;
const QQBOT_AI_IMAGE_BODY_BOTTOM_PADDING = 52;
const QQBOT_AI_IMAGE_MAX_SOURCE_LENGTH = 10_000;
const QQBOT_AI_IMAGE_MAX_HEIGHT = 16_000;
const QQBOT_AI_QR_CARD_WIDTH = 320;
const QQBOT_AI_QR_CARD_HEIGHT = 242;
const QQBOT_AI_QR_CARD_GAP = 24;
const QQBOT_AI_QR_BOX_SIZE = 174;
const QQBOT_AI_QR_SINGLE_CARD_WIDTH = 720;
const QQBOT_AI_QR_SINGLE_CARD_HEIGHT = 218;
const QQBOT_AI_QR_SINGLE_BOX_SIZE = 174;
const QQBOT_AI_QR_SECTION_GAP = 26;
const QQBOT_AI_SOURCE_QR_SIZE = 124;
const QQBOT_AI_SOURCE_QR_PADDING = 6;
const QQBOT_AI_SOURCE_QR_BLOCK_HEIGHT = 176;
const QQBOT_AI_DISCLOSURE_PATTERN = /以上回复由拾间AI生成，内容可能存在偏差，请自行鉴别并以官方信息为准。?/u;
const QQBOT_MARKDOWN_PATTERN = /(?:^|\n)\s*(?:#{1,6}\s|[-*+]\s+|\d+[.)]\s+|>\s)|(?:\*\*|__|~~|`{1,3})|!?\[[^\]]*\]\([^)]*\)/m;
// Chinese line-breaking rules: closing punctuation must not start a line,
// while opening brackets/quotes must not be stranded at the end of one.
const QQBOT_NO_LINE_START_CHARS = new Set(Array.from("，。！？；：、）》」』】〕〉》”’)]}>,.!?;:%…％‰"));
const QQBOT_NO_LINE_END_CHARS = new Set(Array.from("（〔［｛《「『【〖〈“‘([{<"));
const QQBOT_URL_SEPARATOR_CHARS = new Set(Array.from("./-_:"));
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

export type QqBotAiReplyQrEntry = {
  label: string;
  url: string;
};

export type QqBotAiReplyImageOptions = {
  footerNotice?: string;
  /** Public answer page used by the reference bot's QR footer. */
  sourcePageUrl?: string;
  qrEntries?: QqBotAiReplyQrEntry[];
};

export function containsQqBotMarkdown(value: string) {
  return QQBOT_MARKDOWN_PATTERN.test(String(value || ""));
}

/** Render a daily AI answer into a QQ-safe PNG message. */
export function renderQqBotAiReplyAsQqMessage(markdown: string, options: QqBotAiReplyImageOptions = {}) {
  const source = String(markdown || "").trim();
  if (!source) return null;
  const image = renderQqBotAiReplyImage(source, options);
  return `[CQ:image,file=base64://${image.toString("base64")}]`;
}

export function renderQqBotAiReplyImage(markdown: string, options: QqBotAiReplyImageOptions = {}) {
  const normalized = String(markdown || "").replace(/\r\n?/g, "\n").slice(0, QQBOT_AI_IMAGE_MAX_SOURCE_LENGTH);
  const disclosure = normalized.match(QQBOT_AI_DISCLOSURE_PATTERN)?.[0] || "";
  const content = disclosure ? normalized.replace(disclosure, "").trim() : normalized;
  const sourcePageUrl = normalizeQqBotSourcePageUrl(options.sourcePageUrl);
  const qrEntries = sourcePageUrl ? [] : normalizeQrEntries(options.qrEntries);
  const lines = buildMarkdownLines(normalizeQqBotQrLinkMentions(content, qrEntries));
  const footerRows = buildFooterRows(Boolean(disclosure), options.footerNotice);
  const footerHeight = QQBOT_AI_IMAGE_FOOTER_HEIGHT;
  const textBodyHeight = lines.reduce((total, line) => total + lineHeight(line) + line.before + line.after, 0);
  const qrBodyHeight = sourcePageUrl
    ? QQBOT_AI_QR_SECTION_GAP + QQBOT_AI_SOURCE_QR_BLOCK_HEIGHT
    : qrEntries.length === 1
      ? QQBOT_AI_QR_SECTION_GAP + QQBOT_AI_SOURCE_QR_BLOCK_HEIGHT
      : qrEntries.length ? QQBOT_AI_QR_SECTION_GAP + getQrCardLayout(qrEntries.length).height : 0;
  const bodyHeight = QQBOT_AI_IMAGE_BODY_TOP_PADDING
    + textBodyHeight
    + qrBodyHeight
    + QQBOT_AI_IMAGE_BODY_BOTTOM_PADDING;
  const height = Math.min(
    QQBOT_AI_IMAGE_MAX_HEIGHT,
    Math.max(
      QQBOT_AI_IMAGE_TOP_BAR_HEIGHT + footerHeight + 120,
      QQBOT_AI_IMAGE_TOP_BAR_HEIGHT + bodyHeight + footerHeight,
    ),
  );
  const svg = buildReplySvg(lines, height, {
    hasDisclosure: Boolean(disclosure),
    footerRows,
    qrEntries,
    sourcePageUrl,
  });
  return new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      loadSystemFonts: true,
      fontFiles: QQBOT_AI_FONT_FILES,
      defaultFontFamily: "Microsoft YaHei",
    },
  }).render().asPng();
}

export function normalizeQqBotQrLinkMentions(
  markdown: string,
  entries: QqBotAiReplyQrEntry[] = [],
) {
  let normalized = String(markdown || "");
  for (const entry of normalizeQrEntries(entries)) {
    const urlPattern = escapeRegExp(entry.url);
    const label = entry.label;
    // An action already has a QR card, so keep the message body readable:
    // render Markdown links as their label and replace bare URLs with it too.
    normalized = normalized.replace(
      new RegExp(`\\[([^\\]]*)\\]\\(\\s*${urlPattern}\\s*\\)`, "giu"),
      (_value, linkLabel: string) => linkLabel.trim() || label,
    );
    normalized = normalized.replace(new RegExp(urlPattern, "giu"), label);
    const labelPattern = escapeRegExp(label);
    normalized = normalized.replace(new RegExp(`[（(]\\s*${labelPattern}\\s*[）)]`, "giu"), label);
  }
  return normalized;
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
  let pendingBreaks = 0;
  const pushLine = () => {
    while (line.length) {
      const last = line[line.length - 1];
      const trimmed = last.text.replace(/\s+$/u, "");
      if (trimmed) {
        last.text = trimmed;
        break;
      }
      line.pop();
    }
    output.push(line);
    line = [];
    width = 0;
  };
  for (const run of runs) {
    const chars = Array.from(run.text);
    for (let charIndex = 0; charIndex < chars.length; charIndex += 1) {
      const char = chars[charIndex];
      if (char === "\n") {
        pendingBreaks += 1;
        continue;
      }
      if (pendingBreaks) {
        // Do not let an explicit Markdown break put a closing mark at the
        // beginning of a line. This also fixes a break introduced between
        // adjacent Markdown tokens.
        if (!(line.length && isQqBotNoLineStartChar(char))) {
          pushLine();
          for (let breakIndex = 1; breakIndex < pendingBreaks; breakIndex += 1) output.push([]);
        }
        pendingBreaks = 0;
      }
      const charWidth = estimateTextWidth(char, fontSize, run);
      if (!line.length && /\s/u.test(char)) continue;
      if (line.length && width + charWidth > maxWidth) {
        const previousChar = getLastRunCharacter(line);
        if (isQqBotNoLineStartChar(char)) {
          // Keep URL separators (and punctuation clusters) attached to the
          // preceding text. The one-character overflow stays inside the
          // generous image side margin and avoids ugly leading punctuation.
          if (isQqBotUrlSeparator(char) && isQqBotAsciiWordChar(previousChar)) {
            appendRunCharacter(line, run, char);
            width += charWidth;
            continue;
          }
          const carried: InlineRun[] = [];
          prependLastRunCharacter(line, carried);
          while (line.length && isQqBotNoLineEndChar(getLastRunCharacter(line))) {
            prependLastRunCharacter(line, carried);
          }
          while (carried.length && isQqBotNoLineStartChar(carried[0].text[0] || "")) {
            prependLastRunCharacter(line, carried);
          }
          if (line.length) {
            pushLine();
            line = carried;
            width = estimateRunsWidth(line, fontSize);
          } else {
            // A single oversized character should not create an empty line.
            line = carried;
            width = estimateRunsWidth(line, fontSize);
          }
        } else if (isQqBotNoLineEndChar(previousChar)) {
          const carried: InlineRun[] = [];
          while (line.length && isQqBotNoLineEndChar(getLastRunCharacter(line))) {
            prependLastRunCharacter(line, carried);
          }
          if (line.length) {
            pushLine();
            line = carried;
            width = estimateRunsWidth(line, fontSize);
          } else {
            line = carried;
            width = estimateRunsWidth(line, fontSize);
          }
        } else {
          pushLine();
        }
      }
      const previous = line[line.length - 1];
      if (previous && sameRunStyle(previous, run)) previous.text += char;
      else line.push({ ...run, text: char });
      width += charWidth;
    }
  }
  if (pendingBreaks) {
    pushLine();
    for (let breakIndex = 1; breakIndex < pendingBreaks; breakIndex += 1) output.push([]);
  }
  if (line.length || !output.length) pushLine();
  return output;
}

/** Exposed for typography regression tests and non-visual callers. */
export function wrapQqBotAiTextForLayout(value: string, maxWidth: number, fontSize = 28) {
  return wrapRuns([{ text: String(value || "") }], maxWidth, fontSize).map(flattenRunText);
}

function appendRunCharacter(runs: InlineRun[], source: InlineRun, char: string) {
  const previous = runs[runs.length - 1];
  if (previous && sameRunStyle(previous, source)) previous.text += char;
  else runs.push({ ...source, text: char });
}

function prependLastRunCharacter(runs: InlineRun[], target: InlineRun[]) {
  const last = runs[runs.length - 1];
  if (!last) return;
  const chars = Array.from(last.text);
  const char = chars.pop();
  if (!char) return;
  if (chars.length) last.text = chars.join("");
  else runs.pop();
  const first = target[0];
  if (first && sameRunStyle(first, last)) first.text = char + first.text;
  else target.unshift({ ...last, text: char });
}

function getLastRunCharacter(runs: InlineRun[]) {
  const last = runs[runs.length - 1]?.text;
  return last ? Array.from(last).at(-1) || "" : "";
}

function estimateRunsWidth(runs: InlineRun[], fontSize: number) {
  return runs.reduce((total, run) => total + estimateTextWidth(run.text, fontSize, run), 0);
}

function isQqBotNoLineStartChar(value: string) {
  return QQBOT_NO_LINE_START_CHARS.has(value);
}

function isQqBotNoLineEndChar(value: string) {
  return QQBOT_NO_LINE_END_CHARS.has(value);
}

function isQqBotUrlSeparator(value: string) {
  return QQBOT_URL_SEPARATOR_CHARS.has(value);
}

function isQqBotAsciiWordChar(value: string) {
  return /^[A-Za-z0-9]$/u.test(value);
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
        const href = safeDisplayUrl(token.href);
        const plainText = flattenRunText(linkText).trim() || ("text" in token ? String(token.text || "").trim() : "");
        const displayText = href && plainText === href ? getQrTargetHint(href) : plainText;
        append(displayText ? [{ text: displayText }] : linkText, { color: "#2f8f80" });
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

function buildReplySvg(
  lines: RenderLine[],
  height: number,
  options: {
    hasDisclosure: boolean;
    footerRows: string[];
    qrEntries: QqBotAiReplyQrEntry[];
    sourcePageUrl: string | null;
  },
) {
  const footerHeight = QQBOT_AI_IMAGE_FOOTER_HEIGHT;
  let y = QQBOT_AI_IMAGE_TOP_BAR_HEIGHT + QQBOT_AI_IMAGE_BODY_TOP_PADDING;
  const body: string[] = [];
  for (const line of lines) {
    y += line.before;
    if (y > height - footerHeight - 20) break;
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
  if (options.sourcePageUrl) {
    body.push(renderSourcePageQr(options.sourcePageUrl, y + QQBOT_AI_QR_SECTION_GAP));
  } else if (options.qrEntries.length === 1) {
    body.push(renderReferenceQrEntry(options.qrEntries[0], y + QQBOT_AI_QR_SECTION_GAP));
  } else if (options.qrEntries.length) {
    body.push(renderQrCards(options.qrEntries, y + QQBOT_AI_QR_SECTION_GAP));
  }
  const footerY = height - footerHeight;
  const footerText = options.footerRows
    .map((row) => `<text x="${QQBOT_AI_IMAGE_SIDE_PADDING}" y="${footerY + 34}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="16" fill="#55716b">${escapeXml(row)}</text>`)
    .join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${QQBOT_AI_IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${QQBOT_AI_IMAGE_WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${QQBOT_AI_IMAGE_WIDTH}" height="${height}" fill="#ffffff" />
  <rect x="0" y="0" width="${QQBOT_AI_IMAGE_WIDTH}" height="${QQBOT_AI_IMAGE_TOP_BAR_HEIGHT}" fill="#438f80" />
  <circle cx="58" cy="54" r="14" fill="#eaf7f4" />
  <text x="84" y="63" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="26" font-weight="800" fill="#ffffff">拾间AI</text>
  <text x="842" y="62" text-anchor="end" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="22" font-weight="500" fill="#ffffff">药大拾间 · AI 助手</text>
  <line x1="58" y1="88" x2="842" y2="88" stroke="#dcebe7" stroke-width="2" />
  <rect x="0" y="${footerY}" width="${QQBOT_AI_IMAGE_WIDTH}" height="${footerHeight}" fill="#eef7f5" />
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${footerY}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${footerY}" stroke="#dcebe7" stroke-width="2" />
  ${footerText}
  ${body.join("\n  ")}
</svg>`;
}

function buildFooterRows(hasDisclosure: boolean, footerNotice?: string) {
  const notice = String(footerNotice || "").trim();
  const disclosure = hasDisclosure ? "以上内容由拾间AI生成，请注意甄别。" : "拾间AI · 药大拾间";
  return [notice ? `${notice} · ${disclosure}` : disclosure];
}

function normalizeQqBotSourcePageUrl(value: string | undefined): string | null {
  const input = String(value || "").trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeQrEntries(input: QqBotAiReplyQrEntry[] | undefined) {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => ({
      label: String(entry?.label || "").trim(),
      url: String(entry?.url || "").trim(),
    }))
    .filter((entry) => {
      if (!entry.label || !/^https?:\/\//i.test(entry.url)) return false;
      try {
        const parsed = new URL(entry.url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    })
    .slice(0, 3);
}

function renderSourcePageQr(url: string, top: number) {
  const qrX = QQBOT_AI_IMAGE_SIDE_PADDING;
  const qrY = top + 34;
  try {
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const moduleCount = Number(qr.modules.size || 0);
    const data = qr.modules.data as ArrayLike<number>;
    if (!moduleCount || data.length < moduleCount * moduleCount) throw new Error("二维码矩阵为空");
    const moduleSize = QQBOT_AI_SOURCE_QR_SIZE / moduleCount;
    const modules = [] as string[];
    for (let row = 0; row < moduleCount; row += 1) {
      for (let column = 0; column < moduleCount; column += 1) {
        if (!data[row * moduleCount + column]) continue;
        modules.push(`<rect x="${formatSvgNumber(qrX + column * moduleSize)}" y="${formatSvgNumber(qrY + row * moduleSize)}" width="${formatSvgNumber(moduleSize + 0.05)}" height="${formatSvgNumber(moduleSize + 0.05)}" fill="#172a27" />`);
      }
    }
    const textX = qrX + QQBOT_AI_SOURCE_QR_SIZE + 28;
    return `<g>
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${formatSvgNumber(top)}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${formatSvgNumber(top)}" stroke="#dcebe7" stroke-width="2" />
  <rect x="${qrX - QQBOT_AI_SOURCE_QR_PADDING}" y="${qrY - QQBOT_AI_SOURCE_QR_PADDING}" width="${QQBOT_AI_SOURCE_QR_SIZE + QQBOT_AI_SOURCE_QR_PADDING * 2}" height="${QQBOT_AI_SOURCE_QR_SIZE + QQBOT_AI_SOURCE_QR_PADDING * 2}" rx="8" fill="#ffffff" stroke="#d5e9e4" stroke-width="2" />
  <rect x="${qrX}" y="${qrY}" width="${QQBOT_AI_SOURCE_QR_SIZE}" height="${QQBOT_AI_SOURCE_QR_SIZE}" fill="#ffffff" />
  ${modules.join("\n  ")}
  <text x="${textX}" y="${qrY + 26}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="26" font-weight="800" fill="#2f7568">在线查看完整回答</text>
  <text x="${textX}" y="${qrY + 62}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="21" font-weight="500" fill="#55716b">扫码打开在线页面</text>
  <text x="${textX}" y="${qrY + 94}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="17" font-weight="500" fill="#7b918c">完整回答和相关入口</text>
</g>`;
  } catch {
    return `<g>
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${formatSvgNumber(top)}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${formatSvgNumber(top)}" stroke="#dcebe7" stroke-width="2" />
  <text x="${QQBOT_AI_IMAGE_SIDE_PADDING}" y="${formatSvgNumber(top + 54)}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="20" fill="#b42318">在线回答二维码暂时无法生成</text>
</g>`;
  }
}

function renderReferenceQrEntry(entry: QqBotAiReplyQrEntry, top: number) {
  const qrX = QQBOT_AI_IMAGE_SIDE_PADDING;
  const qrY = top + 34;
  try {
    const qr = QRCode.create(entry.url, { errorCorrectionLevel: "M" });
    const moduleCount = Number(qr.modules.size || 0);
    const data = qr.modules.data as ArrayLike<number>;
    if (!moduleCount || data.length < moduleCount * moduleCount) throw new Error("二维码矩阵为空");
    const moduleSize = QQBOT_AI_SOURCE_QR_SIZE / moduleCount;
    const modules: string[] = [];
    for (let row = 0; row < moduleCount; row += 1) {
      for (let column = 0; column < moduleCount; column += 1) {
        if (!data[row * moduleCount + column]) continue;
        modules.push(`<rect x="${formatSvgNumber(qrX + column * moduleSize)}" y="${formatSvgNumber(qrY + row * moduleSize)}" width="${formatSvgNumber(moduleSize + 0.05)}" height="${formatSvgNumber(moduleSize + 0.05)}" fill="#172a27" />`);
      }
    }
    const textX = qrX + QQBOT_AI_SOURCE_QR_SIZE + 28;
    return `<g>
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${formatSvgNumber(top)}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${formatSvgNumber(top)}" stroke="#dcebe7" stroke-width="2" />
  <rect x="${qrX - QQBOT_AI_SOURCE_QR_PADDING}" y="${qrY - QQBOT_AI_SOURCE_QR_PADDING}" width="${QQBOT_AI_SOURCE_QR_SIZE + QQBOT_AI_SOURCE_QR_PADDING * 2}" height="${QQBOT_AI_SOURCE_QR_SIZE + QQBOT_AI_SOURCE_QR_PADDING * 2}" rx="8" fill="#ffffff" stroke="#d5e9e4" stroke-width="2" />
  <rect x="${qrX}" y="${qrY}" width="${QQBOT_AI_SOURCE_QR_SIZE}" height="${QQBOT_AI_SOURCE_QR_SIZE}" fill="#ffffff" />
  ${modules.join("\n  ")}
  <text x="${textX}" y="${qrY + 26}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="26" font-weight="800" fill="#2f7568">${escapeXml(entry.label)}</text>
  <text x="${textX}" y="${qrY + 62}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="21" font-weight="500" fill="#55716b">扫码打开入口</text>
  <text x="${textX}" y="${qrY + 94}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="17" font-weight="500" fill="#7b918c">${escapeXml(getQrTargetHint(entry.url))}</text>
</g>`;
  } catch {
    return `<g>
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${formatSvgNumber(top)}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${formatSvgNumber(top)}" stroke="#dcebe7" stroke-width="2" />
  <text x="${QQBOT_AI_IMAGE_SIDE_PADDING}" y="${formatSvgNumber(top + 54)}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="20" fill="#b42318">${escapeXml(entry.label)}二维码暂时无法生成</text>
</g>`;
  }
}

function renderQrCards(entries: QqBotAiReplyQrEntry[], startY: number) {
  const layout = getQrCardLayout(entries.length);
  const totalWidth = layout.single
    ? layout.width
    : entries.length * layout.width + Math.max(0, entries.length - 1) * QQBOT_AI_QR_CARD_GAP;
  const startX = Math.max(
    QQBOT_AI_IMAGE_SIDE_PADDING,
    Math.round((QQBOT_AI_IMAGE_WIDTH - totalWidth) / 2),
  );
  return entries.map((entry, index) => {
    const x = layout.single
      ? startX
      : startX + index * (layout.width + QQBOT_AI_QR_CARD_GAP);
    try {
      const qr = QRCode.create(entry.url, { errorCorrectionLevel: "M" });
      const size = Number(qr.modules.size || 0);
      const data = qr.modules.data as ArrayLike<number>;
      if (!size || data.length < size * size) throw new Error("二维码矩阵为空");
      const quiet = 12;
      const moduleSize = (layout.boxSize - quiet * 2) / size;
      let path = "";
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          if (!data[row * size + column]) continue;
          const moduleX = quiet + column * moduleSize;
          const moduleY = quiet + row * moduleSize;
          const squareSize = moduleSize + 0.2;
          path += "M" + formatSvgNumber(moduleX) + " " + formatSvgNumber(moduleY)
            + "h" + formatSvgNumber(squareSize) + "v" + formatSvgNumber(squareSize)
            + "h-" + formatSvgNumber(squareSize) + "z";
        }
      }
      if (layout.single) {
        const qrX = 24;
        const qrY = 22;
        const labelLines = wrapQrLabel(entry.label, 10);
        const hint = getQrTargetHint(entry.url);
        const markup = [
          '<g transform="translate(' + x + ' ' + startY + ')">',
          '<rect width="' + layout.width + '" height="' + layout.height + '" rx="20" fill="#f7fbfa" stroke="#d5e9e4" stroke-width="2" />',
          '<rect x="' + qrX + '" y="' + qrY + '" width="' + layout.boxSize + '" height="' + layout.boxSize + '" rx="10" fill="#ffffff" />',
          '<g transform="translate(' + qrX + ' ' + qrY + ')"><path d="' + path + '" fill="#172a27" /></g>',
          '<text x="232" y="74" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="30" font-weight="700" fill="#2f7568">' + escapeXml(labelLines[0] || entry.label) + '</text>',
        ];
        if (labelLines[1]) {
          markup.push('<text x="232" y="108" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="24" font-weight="700" fill="#2f7568">' + escapeXml(labelLines[1]) + '</text>');
        }
        markup.push(
          '<text x="232" y="146" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="21" fill="#55716b">扫码打开</text>',
          '<text x="232" y="180" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="17" fill="#7b918c">' + escapeXml(hint) + '</text>',
          '</g>',
        );
        return markup.join("\n");
      }
      const labelLines = wrapQrLabel(entry.label, 12);
      const qrX = (layout.width - layout.boxSize) / 2;
      const markup = [
        '<g transform="translate(' + x + ' ' + startY + ')">',
        '<rect width="' + layout.width + '" height="' + layout.height + '" rx="18" fill="#f7fbfa" stroke="#d5e9e4" stroke-width="2" />',
        '<rect x="' + qrX + '" y="18" width="' + layout.boxSize + '" height="' + layout.boxSize + '" rx="8" fill="#ffffff" />',
        '<g transform="translate(' + qrX + ' 18)"><path d="' + path + '" fill="#172a27" /></g>',
        '<text x="' + layout.width / 2 + '" y="216" text-anchor="middle" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="22" font-weight="700" fill="#2f7568">' + escapeXml(labelLines[0] || entry.label) + '</text>',
      ];
      if (labelLines[1]) {
        markup.push('<text x="' + layout.width / 2 + '" y="238" text-anchor="middle" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="18" fill="#55716b">' + escapeXml(labelLines[1]) + '</text>');
      }
      markup.push('</g>');
      return markup.join("\n");
    } catch {
      return [
        '<g transform="translate(' + x + ' ' + startY + ')">',
        '<rect width="' + layout.width + '" height="' + layout.height + '" rx="18" fill="#fff8f7" stroke="#f2c8c3" stroke-width="2" />',
        '<text x="' + layout.width / 2 + '" y="' + layout.height / 2 + '" text-anchor="middle" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="20" fill="#b42318">二维码暂时无法生成</text>',
        '</g>',
      ].join("\n");
    }
  }).join("\n  ");
}

function getQrCardLayout(count: number) {
  if (count === 1) {
    return {
      width: QQBOT_AI_QR_SINGLE_CARD_WIDTH,
      height: QQBOT_AI_QR_SINGLE_CARD_HEIGHT,
      boxSize: QQBOT_AI_QR_SINGLE_BOX_SIZE,
      single: true,
    };
  }
  return {
    width: QQBOT_AI_QR_CARD_WIDTH,
    height: QQBOT_AI_QR_CARD_HEIGHT,
    boxSize: QQBOT_AI_QR_BOX_SIZE,
    single: false,
  };
}

function wrapQrLabel(value: string, maxChars = 12) {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return [value];
  return [chars.slice(0, maxChars).join(""), chars.slice(maxChars, maxChars * 2).join("")];
}

function getQrTargetHint(value: string) {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const hint = parsed.host + path;
    return hint.length <= 36 ? hint : parsed.host;
  } catch {
    return "使用手机相机识别";
  }
}

function formatSvgNumber(value: number) {
  return Number(value.toFixed(2)).toString();
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

function escapeRegExp(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
