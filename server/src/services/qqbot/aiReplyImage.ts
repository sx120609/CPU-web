import { Resvg } from "@resvg/resvg-js";
import twemoji from "@discordapp/twemoji";
import * as cheerio from "cheerio";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import katex from "katex";
import "katex/contrib/mhchem";
import { Marked, type Token, type Tokens } from "marked";
import QRCode from "qrcode";

// Keep the QQBot image renderer in step with web/src/utils/markdown.ts. The
// web renderer uses the same two delimiters and also promotes common bare
// formula lines (for example `AUC = Dose / C`) to display math.
const qqBotMarkdown = new Marked({ breaks: true, gfm: true });
qqBotMarkdown.use({
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
    },
    {
      name: "chemInline",
      level: "inline",
      start(source: string) {
        return source.indexOf("\\ce");
      },
      tokenizer(source: string) {
        const match = /^\\ce\s*\{([^\n{}]+)\}/u.exec(source);
        if (!match) return undefined;
        return { type: "chemInline", raw: match[0], text: `\\ce{${match[1].trim()}}` };
      },
    },
  ],
});

// Keep the geometry of the reference QQBot renderer: a compact 900px card,
// a thin divider below the header, and the source QR block at the bottom.
// The current 拾间AI palette is applied separately in buildReplySvg().
const QQBOT_AI_IMAGE_WIDTH = 900;
const QQBOT_AI_IMAGE_SIDE_PADDING = 58;
const QQBOT_AI_IMAGE_BODY_WIDTH = QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING * 2 - 28;
const QQBOT_AI_IMAGE_TOP_BAR_HEIGHT = 88;
const QQBOT_AI_IMAGE_FOOTER_HEIGHT = 48;
const QQBOT_AI_IMAGE_BODY_TOP_PADDING = 52;
const QQBOT_AI_IMAGE_BODY_BOTTOM_PADDING = 24;
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
const QQBOT_AI_SOURCE_QR_BLOCK_HEIGHT = 164;
const QQBOT_AI_DISCLOSURE_PATTERN = /以上回复由拾间AI生成，内容可能存在偏差，请自行鉴别并以官方信息为准。?/u;
const QQBOT_MARKDOWN_PATTERN = /(?:^|\n)\s*(?:#{1,6}\s|[-*+]\s+|\d+[.)]\s+|>\s|[A-Za-z][A-Za-z0-9_]*(?:\/\d+)?\s*=\s*\S.+$)|(?:\*\*|__|~~|`{1,3})|!?\[[^\]]*\]\([^)]*\)|\$\$(?:[\s\S]+?)\$\$|\$(?!\$)(?:\\.|[^$\\\n])+\$/m;
// Chinese line-breaking rules: closing punctuation must not start a line,
// while opening brackets/quotes must not be stranded at the end of one.
const QQBOT_NO_LINE_START_CHARS = new Set(Array.from("，。！？；：、）》」』】〕〉》”’)]}>,.!?;:%…％‰"));
const QQBOT_NO_LINE_END_CHARS = new Set(Array.from("（〔［｛《「『【〖〈“‘([{<"));
const QQBOT_URL_SEPARATOR_CHARS = new Set(Array.from("./-_:"));
const QQBOT_AI_TEXT_FONT_FAMILY = "Microsoft YaHei, Noto Sans CJK SC, Segoe UI Emoji, Noto Color Emoji, Apple Color Emoji, sans-serif";
const QQBOT_AI_EMOJI_ADVANCE_RATIO = 1.08;
const QQBOT_AI_FONT_FILES = [
  "C:/Windows/Fonts/msyh.ttc",
  "C:/Windows/Fonts/msyhbd.ttc",
  "C:/Windows/Fonts/simhei.ttf",
  "C:/Windows/Fonts/simsun.ttc",
  "C:/Windows/Fonts/seguiemj.ttf",
  "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
  "/usr/share/fonts/noto/NotoColorEmoji.ttf",
  "/System/Library/Fonts/Apple Color Emoji.ttc",
].filter(existsSync);
const QQBOT_TWEMOJI_SVG_DIRECTORY = join(dirname(require.resolve("@discordapp/twemoji")), "svg");
const qqBotTwemojiSvgCache = new Map<string, { viewBox: string; body: string } | null>();
const qqBotGraphemeSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh-CN", { granularity: "grapheme" })
  : null;

type QqBotEmojiTextSegment = {
  text: string;
  icon?: string;
};

type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  math?: boolean;
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
  /** Whether to include the online-answer QR code in the rendered image. */
  qrCodeEnabled?: boolean;
  qrEntries?: QqBotAiReplyQrEntry[];
};

function splitQqBotGraphemes(value: string) {
  const source = String(value || "");
  if (!source) return [];
  if (!qqBotGraphemeSegmenter) return Array.from(source);
  return Array.from(qqBotGraphemeSegmenter.segment(source), (entry) => entry.segment);
}

function resolveQqBotTwemojiIcon(rawText: string) {
  const normalized = rawText.includes("\u200d") ? rawText : rawText.replace(/\ufe0f/giu, "");
  return twemoji.convert.toCodePoint(normalized);
}

function splitQqBotEmojiText(value: string): QqBotEmojiTextSegment[] {
  const source = String(value || "");
  if (!source) return [];
  const output: QqBotEmojiTextSegment[] = [];
  let cursor = 0;
  twemoji.replace(source, (rawText: string) => {
    const index = source.indexOf(rawText, cursor);
    if (index < 0) return rawText;
    if (index > cursor) output.push({ text: source.slice(cursor, index) });
    output.push({ text: rawText, icon: resolveQqBotTwemojiIcon(rawText) });
    cursor = index + rawText.length;
    return rawText;
  });
  if (cursor < source.length) output.push({ text: source.slice(cursor) });
  return output.length ? output : [{ text: source }];
}

function loadQqBotTwemojiSvg(icon: string) {
  const normalized = String(icon || "").toLowerCase();
  if (!/^[0-9a-f]+(?:-[0-9a-f]+)*$/u.test(normalized)) return null;
  if (qqBotTwemojiSvgCache.has(normalized)) return qqBotTwemojiSvgCache.get(normalized) || null;
  try {
    const source = readFileSync(join(QQBOT_TWEMOJI_SVG_DIRECTORY, `${normalized}.svg`), "utf8").trim();
    const match = source.match(/^<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>([\s\S]*?)<\/svg>$/iu);
    const asset = match ? { viewBox: match[1], body: match[2] } : null;
    qqBotTwemojiSvgCache.set(normalized, asset);
    return asset;
  } catch {
    qqBotTwemojiSvgCache.set(normalized, null);
    return null;
  }
}

function renderQqBotTwemoji(icon: string, x: number, baselineY: number, fontSize: number) {
  const asset = loadQqBotTwemojiSvg(icon);
  if (!asset) return null;
  const advance = fontSize * QQBOT_AI_EMOJI_ADVANCE_RATIO;
  const size = fontSize * 1.04;
  const left = x + (advance - size) / 2;
  const top = baselineY - fontSize * 0.9;
  return `<svg x="${formatSvgNumber(left)}" y="${formatSvgNumber(top)}" width="${formatSvgNumber(size)}" height="${formatSvgNumber(size)}" viewBox="${asset.viewBox}" overflow="visible" aria-hidden="true">${asset.body}</svg>`;
}

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
  const normalized = normalizeQqBotAiReplyText(markdown).slice(0, QQBOT_AI_IMAGE_MAX_SOURCE_LENGTH);
  const disclosure = normalized.match(QQBOT_AI_DISCLOSURE_PATTERN)?.[0] || "";
  const content = disclosure ? normalized.replace(disclosure, "").trim() : normalized;
  const qrCodeEnabled = options.qrCodeEnabled !== false;
  const sourcePageUrl = qrCodeEnabled ? normalizeQqBotSourcePageUrl(options.sourcePageUrl) : null;
  const qrEntries = qrCodeEnabled && !sourcePageUrl ? normalizeQrEntries(options.qrEntries) : [];
  const lines = buildMarkdownLines(normalizeQqBotQrLinkMentions(content, qrEntries));
  const footerRows = buildFooterRows(Boolean(disclosure), options.footerNotice);
  const hasSingleQrFooter = Boolean(sourcePageUrl || qrEntries.length === 1);
  const footerHeight = hasSingleQrFooter ? 0 : QQBOT_AI_IMAGE_FOOTER_HEIGHT;
  const qrSectionGap = hasSingleQrFooter ? getQqBotSingleQrSectionGap(lines) : QQBOT_AI_QR_SECTION_GAP;
  const textBodyHeight = lines.reduce((total, line) => total + lineHeight(line) + line.before + line.after, 0);
  const qrBodyHeight = sourcePageUrl
    ? qrSectionGap + QQBOT_AI_SOURCE_QR_BLOCK_HEIGHT
    : qrEntries.length === 1
      ? qrSectionGap + QQBOT_AI_SOURCE_QR_BLOCK_HEIGHT
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
    footerHeight,
    qrSectionGap,
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

/**
 * Normalize model text before either the online answer page or the QQ image
 * renderer consumes it. Some providers return a JSON string that has already
 * been decoded once, leaving a second layer of `\\n`/`\\r\\n` escapes visible
 * to users. Decode text control escapes while preserving recognized LaTeX
 * commands such as `\\nabla`, `\\neq`, and `\\theta`.
 */
export function normalizeQqBotAiReplyText(value: string) {
  const source = String(value || "").replace(/\r\n?/g, "\n");
  let normalized = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char !== "\\" || index + 1 >= source.length) {
      normalized += char;
      continue;
    }
    const escape = source[index + 1];
    if (
      (escape === "r" || escape === "n")
      && source[index + 2] === "\\"
      && source[index + 3] === (escape === "r" ? "n" : "r")
    ) {
      normalized += "\n";
      index += 3;
      continue;
    }
    if (escape === "u") {
      const hex = source.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        normalized += String.fromCharCode(Number.parseInt(hex, 16));
        index += 5;
        continue;
      }
    }
    if (escape === "n" || escape === "r" || escape === "t") {
      const afterEscape = source[index + 2] || "";
      // A backslash followed by an ASCII letter may be a LaTeX command
      // (`\\nu`, `\\rho`, `\\text`, ...), but ordinary prose such as
      // `first\\nsecond` is still a serialized newline. Preserve only a
      // recognized command; decode every other control escape.
      if (!/[A-Za-z]/u.test(afterEscape) || !isQqBotLatexCommand(source, index)) {
        normalized += escape === "t" ? "\t" : "\n";
        index += 1;
        continue;
      }
    }
    normalized += char;
  }
  return normalized.replace(/\n{3,}/g, "\n\n");
}

const QQBOT_LATEX_COMMANDS = new Set([
  "alpha", "approx", "beta", "cdot", "chi", "cos", "delta", "displaystyle", "ell", "epsilon", "eta",
  "exists", "frac", "gamma", "ge", "geq", "gg", "in", "infty", "int", "iota", "kappa", "lambda",
  "le", "leq", "left", "ln", "log", "mapsto", "mid", "mu", "nabla", "ne", "neq", "newcommand", "nu",
  "not", "omega", "overline", "partial", "phi", "pi", "pm", "psi", "rho", "right", "rightarrow",
  "rm", "roman", "root", "rule", "sigma", "sin", "sqrt", "sum", "tau", "text", "theta", "times",
  "to", "top", "triangle", "underline", "upsilon", "varepsilon", "varphi", "varpi", "varrho", "varsigma",
  "vartheta", "vec", "xi", "zeta",
]);

function isQqBotLatexCommand(source: string, slashIndex: number) {
  const command = source.slice(slashIndex + 1).match(/^[A-Za-z]+/u)?.[0] || "";
  return QQBOT_LATEX_COMMANDS.has(command);
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
  const tokens = qqBotMarkdown.lexer(normalizeQqBotBareFormulaLines(markdown));
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
    case "mathBlock":
      appendRuns(lines, [{ text: renderQqBotMathExpression(String((token as { text?: unknown }).text || ""), true), math: true }], {
        fontSize: 30,
        indent,
        before: 16,
        after: 10,
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
    const chars = splitQqBotGraphemes(run.text);
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
  const chars = splitQqBotGraphemes(last.text);
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
  return last ? splitQqBotGraphemes(last).at(-1) || "" : "";
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
      case "mathInline":
      case "chemInline":
        append([{ text: renderQqBotMathExpression(String((token as { text?: unknown }).text || ""), false), math: true }]);
        break;
      case "link": {
        const linkText = inlineRuns(token.tokens);
        const rawHref = String(token.href || "").trim();
        const href = safeDisplayUrl(rawHref);
        const plainText = flattenRunText(linkText).trim() || ("text" in token ? String(token.text || "").trim() : "");
        const plainTextUrl = splitQqBotLinkUrl(plainText);
        const isUrlLabel = Boolean(plainTextUrl.url);
        const displayText = href && isUrlLabel ? getQrTargetHint(href) : plainText;
        append(displayText ? [{ text: displayText }] : linkText, { color: "#2f8f80" });
        if (isUrlLabel && plainTextUrl.trailing) append([{ text: plainTextUrl.trailing }]);
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

/**
 * Convert a TeX expression into a compact, SVG-safe representation.
 *
 * Resvg (the renderer used for QQ images) does not implement HTML
 * `foreignObject`, so the browser's KaTeX HTML cannot be pasted into the
 * image SVG directly. KaTeX's MathML output is semantic, however, and can
 * be reduced to readable Unicode with the same parser and error handling as
 * the main site. Fractions, roots, limits and scripts therefore remain
 * recognizable instead of leaking `$...$` or `\\frac` source into QQ.
 */
export function renderQqBotMathExpression(expression: string, displayMode = false) {
  const source = normalizeQqBotChemistryExpression(String(expression || "").trim());
  if (!source) return "";
  try {
    const markup = katex.renderToString(source, {
      displayMode,
      output: "mathml",
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
    const $ = cheerio.load(markup, { xmlMode: true });
    const math = $("math").first().get(0);
    const expressionText = math ? renderMathMlNode($, math) : "";
    return expressionText.trim() || source.replace(/[{}]/g, "");
  } catch {
    return source.replace(/[{}]/g, "");
  }
}

function renderMathMlNode($: cheerio.CheerioAPI, node: any, options: { compact?: boolean } = {}): string {
  if (node.type === "text") return String(node.data || "");
  if (node.type !== "tag") return "";
  const tag = String(node.name || "").toLowerCase();
  const children = (childOptions = options) => $(node).contents().toArray().map((child) => renderMathMlNode($, child, childOptions)).join("");
  switch (tag) {
    case "math":
    case "semantics":
    case "mrow":
    case "mstyle":
    case "mpadded":
      return children();
    case "mphantom":
      return "";
    case "annotation":
      return "";
    case "mi":
    case "mn":
    case "mtext":
      return children();
    case "mo": {
      const value = children();
      if (!options.compact && /^[=+\-×÷<>≤≥≈∝←→⇄⇌]$/u.test(value.trim())) return ` ${value.trim()} `;
      if (!options.compact && value.trim() === ",") return ", ";
      return value;
    }
    case "mspace":
      return " ";
    case "msup": {
      const parts = $(node).children().toArray();
      return `${renderMathMlNode($, parts[0], options)}${toMathSuperscript(renderMathMlNode($, parts[1], { compact: true }))}`;
    }
    case "msub": {
      const parts = $(node).children().toArray();
      return `${renderMathMlNode($, parts[0], options)}${toMathSubscript(renderMathMlNode($, parts[1], { compact: true }))}`;
    }
    case "msubsup": {
      const parts = $(node).children().toArray();
      return `${renderMathMlNode($, parts[0], options)}${toMathSubscript(renderMathMlNode($, parts[1], { compact: true }))}${toMathSuperscript(renderMathMlNode($, parts[2], { compact: true }))}`;
    }
    case "mfrac": {
      const parts = $(node).children().toArray();
      const numerator = renderMathMlNode($, parts[0]);
      const denominator = renderMathMlNode($, parts[1]);
      return `${wrapMathPart(numerator)} / ${wrapMathPart(denominator)}`;
    }
    case "msqrt":
      return `√${wrapMathPart(children())}`;
    case "mroot": {
      const parts = $(node).children().toArray();
      return `${toMathSuperscript(renderMathMlNode($, parts[1]))}√${wrapMathPart(renderMathMlNode($, parts[0]))}`;
    }
    case "mover":
    case "munder":
    case "munderover": {
      const parts = $(node).children().toArray();
      return parts.map((part, index) => {
        const text = renderMathMlNode($, part);
        if (tag === "mover" && index === 1) return toMathAccent(text);
        if (tag === "munder" && index === 1) return toMathSubscript(text);
        if (tag === "munderover" && index === 1) return toMathSubscript(text);
        if (tag === "munderover" && index === 2) return toMathSuperscript(text);
        return text;
      }).join("");
    }
    case "mtable":
      return $(node).children("mtr").toArray().map((row) => renderMathMlNode($, row)).join("; ");
    case "mtr":
      return $(node).children("mtd").toArray().map((cell) => renderMathMlNode($, cell)).join("  ");
    case "mtd":
      return children();
    default:
      return children();
  }
}

function wrapMathPart(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.length === 1 || /^[\p{L}\p{N}]+$/u.test(normalized) ? normalized : `(${normalized})`;
}

const MATH_SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ",
};
const MATH_SUBSCRIPT_MAP: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

function mapMathScript(value: string, map: Record<string, string>, marker: string) {
  const chars = Array.from(value.trim());
  if (!chars.length) return "";
  const mapped = chars.map((char) => map[char] || char).join("");
  return mapped === value.trim() && chars.some((char) => !map[char]) ? `${marker}${value.trim()}` : mapped;
}

function toMathSuperscript(value: string) {
  return mapMathScript(value, MATH_SUPERSCRIPT_MAP, "^");
}

function toMathSubscript(value: string) {
  return mapMathScript(value, MATH_SUBSCRIPT_MAP, "_");
}

function toMathAccent(value: string) {
  const accents: Record<string, string> = { "¯": "̄", "→": "⃗", "˙": "̇", "^": "̂" };
  return accents[value.trim()] || value;
}

function normalizeQqBotBareFormulaLines(markdown: string) {
  let insideFence = false;
  let insideMathBlock = false;
  return String(markdown || "").split("\n").map((line) => {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      insideFence = !insideFence;
      return line;
    }
    if (/^\$\$\s*$/.test(trimmed)) {
      insideMathBlock = !insideMathBlock;
      return line;
    }
    if (!insideFence && !insideMathBlock && /^\\ce\s*/u.test(trimmed)) {
      return `$$${normalizeQqBotChemistryExpression(trimmed)}$$`;
    }
    if (
      insideFence
      || insideMathBlock
      || !trimmed
      || trimmed.includes("$")
      || !/^[A-Za-z][A-Za-z0-9_]*(?:\/\d+)?\s*=\s*\S.+$/.test(trimmed)
    ) {
      return line;
    }
    return `$$${normalizeQqBotBareFormula(trimmed)}$$`;
  }).join("\n");
}

function normalizeQqBotBareFormula(formula: string) {
  const [rawLeft, ...rawRightParts] = formula.split("=");
  if (!rawRightParts.length) return formula;
  const left = normalizeQqBotFormulaTokens(rawLeft.trim());
  let right = normalizeQqBotFormulaTokens(rawRightParts.join("=").trim());
  const parenthesizedFraction = /^\((.+)\)\/\((.+)\)$/.exec(right);
  const simpleFraction = /^([A-Za-z0-9_{}.\-\\]+)\/([A-Za-z0-9_{}.\-\\]+)$/.exec(right);
  if (parenthesizedFraction) right = `\\frac{${parenthesizedFraction[1]}}{${parenthesizedFraction[2]}}`;
  else if (simpleFraction) right = `\\frac{${simpleFraction[1]}}{${simpleFraction[2]}}`;
  return `${left} = ${right}`;
}

function normalizeQqBotFormulaTokens(value: string) {
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
  let normalized = value.replace(/[−–—]/g, "-").replace(/·/g, "\\cdot ");
  for (const [pattern, replacement] of replacements) normalized = normalized.replace(pattern, replacement);
  return normalized.replace(/e\^\(([^)]+)\)/g, "e^{$1}");
}

function buildReplySvg(
  lines: RenderLine[],
  height: number,
  options: {
    hasDisclosure: boolean;
    footerRows: string[];
    qrEntries: QqBotAiReplyQrEntry[];
    sourcePageUrl: string | null;
    footerHeight: number;
    qrSectionGap: number;
  },
) {
  const footerHeight = options.footerHeight;
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
    if (!twemoji.test(prefix + flattenRunText(line.runs))) {
      const prefixSvg = prefix
        ? `<tspan fill="${line.prefixColor || "#667085"}" font-weight="700">${escapeXml(prefix)}</tspan>`
        : "";
      const runSvg = line.runs.map((run) => renderRun(run)).join("");
      body.push(`<text x="${x}" y="${y}" font-family="${QQBOT_AI_TEXT_FONT_FAMILY}" font-size="${line.fontSize}" fill="#263238">${prefixSvg}${runSvg}</text>`);
    } else {
      const prefixSvg = prefix
        ? renderStyledRunsWithEmoji([{ text: prefix, bold: true, color: line.prefixColor || "#667085" }], x, y, line.fontSize)
        : "";
      const runSvg = renderStyledRunsWithEmoji(line.runs, x + prefixWidth, y, line.fontSize);
      body.push(`${prefixSvg}${runSvg}`);
    }
    y += lineHeightValue + line.after;
    void prefixWidth;
  }
  if (options.sourcePageUrl) {
    body.push(renderSourcePageQr(options.sourcePageUrl, y + options.qrSectionGap, options.footerRows, height));
  } else if (options.qrEntries.length === 1) {
    body.push(renderReferenceQrEntry(options.qrEntries[0], y + options.qrSectionGap, options.footerRows, height));
  } else if (options.qrEntries.length) {
    body.push(renderQrCards(options.qrEntries, y + QQBOT_AI_QR_SECTION_GAP));
  }
  const footerY = height - footerHeight;
  const footerText = footerHeight > 0
    ? options.footerRows
      .map((row) => renderPlainTextWithEmoji(row, QQBOT_AI_IMAGE_SIDE_PADDING, footerY + 32, 16, 'fill="#55716b"'))
      .join("\n  ")
    : "";
  const footerMarkup = footerHeight > 0
    ? `<rect x="0" y="${footerY}" width="${QQBOT_AI_IMAGE_WIDTH}" height="${footerHeight}" fill="#eef7f5" />
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${footerY}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${footerY}" stroke="#dcebe7" stroke-width="2" />
  ${footerText}`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${QQBOT_AI_IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${QQBOT_AI_IMAGE_WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${QQBOT_AI_IMAGE_WIDTH}" height="${height}" fill="#ffffff" />
  <rect x="0" y="0" width="${QQBOT_AI_IMAGE_WIDTH}" height="${QQBOT_AI_IMAGE_TOP_BAR_HEIGHT}" fill="#438f80" />
  <circle cx="58" cy="54" r="14" fill="#eaf7f4" />
  <text x="84" y="63" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="26" font-weight="800" fill="#ffffff">拾间AI</text>
  <text x="842" y="62" text-anchor="end" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="22" font-weight="500" fill="#ffffff">药大拾间 · AI 助手</text>
  ${footerMarkup}
  ${body.join("\n  ")}
</svg>`;
}

function buildFooterRows(hasDisclosure: boolean, footerNotice?: string) {
  const notice = String(footerNotice || "").trim();
  const disclosure = hasDisclosure ? "以上内容由拾间AI生成，请注意甄别。" : "拾间AI · 药大拾间";
  return [notice ? `${notice} · ${disclosure}` : disclosure];
}

function getQqBotSingleQrSectionGap(lines: RenderLine[]) {
  const first = lines.find((line) => !line.rule && line.runs.length);
  const last = [...lines].reverse().find((line) => !line.rule && line.runs.length);
  if (!first || !last) return 0;
  // Align the visible glyph gap before the QR footer with the visible gap
  // below the header, instead of aligning the SVG line boxes themselves.
  const topVisibleGap = QQBOT_AI_IMAGE_BODY_TOP_PADDING + first.before - first.fontSize;
  const lastGlyphDescent = Math.ceil(last.fontSize * 0.18);
  const lastLineBox = lineHeight(last) + last.after;
  return Math.max(-16, Math.min(16, Math.round(topVisibleGap + lastGlyphDescent - lastLineBox)));
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

function renderSourcePageQr(url: string, top: number, footerRows: string[], footerEndY: number) {
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
  <rect x="0" y="${formatSvgNumber(top)}" width="${QQBOT_AI_IMAGE_WIDTH}" height="${formatSvgNumber(Math.max(0, footerEndY - top))}" fill="#eef7f5" />
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${formatSvgNumber(top)}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${formatSvgNumber(top)}" stroke="#dcebe7" stroke-width="2" />
  <rect x="${qrX - QQBOT_AI_SOURCE_QR_PADDING}" y="${qrY - QQBOT_AI_SOURCE_QR_PADDING}" width="${QQBOT_AI_SOURCE_QR_SIZE + QQBOT_AI_SOURCE_QR_PADDING * 2}" height="${QQBOT_AI_SOURCE_QR_SIZE + QQBOT_AI_SOURCE_QR_PADDING * 2}" rx="8" fill="#ffffff" stroke="#d5e9e4" stroke-width="2" />
  <rect x="${qrX}" y="${qrY}" width="${QQBOT_AI_SOURCE_QR_SIZE}" height="${QQBOT_AI_SOURCE_QR_SIZE}" fill="#ffffff" />
  ${modules.join("\n  ")}
  <text x="${textX}" y="${qrY + 38}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="26" font-weight="800" fill="#2f7568">在线查看完整回答</text>
  <text x="${textX}" y="${qrY + 74}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="21" font-weight="500" fill="#55716b">扫码打开在线页面</text>
  <text x="${textX}" y="${qrY + 106}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="17" font-weight="500" fill="#7b918c">完整回答和相关入口</text>
  ${renderQrFooterNotice(footerRows, qrY)}
</g>`;
  } catch {
    return `<g>
  <rect x="0" y="${formatSvgNumber(top)}" width="${QQBOT_AI_IMAGE_WIDTH}" height="${formatSvgNumber(Math.max(0, footerEndY - top))}" fill="#eef7f5" />
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${formatSvgNumber(top)}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${formatSvgNumber(top)}" stroke="#dcebe7" stroke-width="2" />
  <text x="${QQBOT_AI_IMAGE_SIDE_PADDING}" y="${formatSvgNumber(top + 54)}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="20" fill="#b42318">在线回答二维码暂时无法生成</text>
  ${renderQrFooterNotice(footerRows, top + 34)}
</g>`;
  }
}

function renderReferenceQrEntry(entry: QqBotAiReplyQrEntry, top: number, footerRows: string[], footerEndY: number) {
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
  <rect x="0" y="${formatSvgNumber(top)}" width="${QQBOT_AI_IMAGE_WIDTH}" height="${formatSvgNumber(Math.max(0, footerEndY - top))}" fill="#eef7f5" />
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${formatSvgNumber(top)}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${formatSvgNumber(top)}" stroke="#dcebe7" stroke-width="2" />
  <rect x="${qrX - QQBOT_AI_SOURCE_QR_PADDING}" y="${qrY - QQBOT_AI_SOURCE_QR_PADDING}" width="${QQBOT_AI_SOURCE_QR_SIZE + QQBOT_AI_SOURCE_QR_PADDING * 2}" height="${QQBOT_AI_SOURCE_QR_SIZE + QQBOT_AI_SOURCE_QR_PADDING * 2}" rx="8" fill="#ffffff" stroke="#d5e9e4" stroke-width="2" />
  <rect x="${qrX}" y="${qrY}" width="${QQBOT_AI_SOURCE_QR_SIZE}" height="${QQBOT_AI_SOURCE_QR_SIZE}" fill="#ffffff" />
  ${modules.join("\n  ")}
  ${renderPlainTextWithEmoji(entry.label, textX, qrY + 38, 26, 'font-weight="800" fill="#2f7568"')}
  <text x="${textX}" y="${qrY + 74}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="21" font-weight="500" fill="#55716b">扫码打开入口</text>
  <text x="${textX}" y="${qrY + 106}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="17" font-weight="500" fill="#7b918c">${escapeXml(getQrTargetHint(entry.url))}</text>
  ${renderQrFooterNotice(footerRows, qrY)}
</g>`;
  } catch {
    return `<g>
  <rect x="0" y="${formatSvgNumber(top)}" width="${QQBOT_AI_IMAGE_WIDTH}" height="${formatSvgNumber(Math.max(0, footerEndY - top))}" fill="#eef7f5" />
  <line x1="${QQBOT_AI_IMAGE_SIDE_PADDING}" y1="${formatSvgNumber(top)}" x2="${QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING}" y2="${formatSvgNumber(top)}" stroke="#dcebe7" stroke-width="2" />
  ${renderPlainTextWithEmoji(`${entry.label}二维码暂时无法生成`, QQBOT_AI_IMAGE_SIDE_PADDING, top + 54, 20, 'fill="#b42318"')}
  ${renderQrFooterNotice(footerRows, top + 34)}
</g>`;
  }
}

function renderQrFooterNotice(footerRows: string[], qrY: number) {
  const text = String(footerRows[0] || "").trim();
  if (!text) return "";
  return renderPlainTextWithEmoji(text, QQBOT_AI_IMAGE_WIDTH - QQBOT_AI_IMAGE_SIDE_PADDING, qrY + 110, 16, 'fill="#55716b"', "end");
}

function normalizeQqBotChemistryExpression(value: string) {
  const source = String(value || "")
    .trim()
    .replace(/[−–—]\s*>/gu, "->");
  if (!/^\\ce(?:\s|\{|[A-Za-z0-9]|\(|\[)/u.test(source)) return source;
  if (/^\\ce\s*\{/u.test(source)) return source;
  const loose = /^\\ce\s*([\s\S]+)$/u.exec(source);
  return loose?.[1]?.trim() ? `\\ce{${loose[1].trim()}}` : source;
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
          renderPlainTextWithEmoji(labelLines[0] || entry.label, 232, 74, 30, 'font-weight="700" fill="#2f7568"'),
        ];
        if (labelLines[1]) {
          markup.push(renderPlainTextWithEmoji(labelLines[1], 232, 108, 24, 'font-weight="700" fill="#2f7568"'));
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
        renderPlainTextWithEmoji(labelLines[0] || entry.label, layout.width / 2, 216, 22, 'font-weight="700" fill="#2f7568"', "middle"),
      ];
      if (labelLines[1]) {
        markup.push(renderPlainTextWithEmoji(labelLines[1], layout.width / 2, 238, 18, 'fill="#55716b"', "middle"));
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
  const chars = splitQqBotGraphemes(value);
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

function renderStyledRunsWithEmoji(runs: InlineRun[], startX: number, baselineY: number, fontSize: number) {
  const markup: string[] = [];
  let cursor = startX;
  for (const run of runs) {
    for (const segment of splitQqBotEmojiText(run.text)) {
      const width = estimateTextWidth(segment.text, fontSize, run);
      const emoji = segment.icon ? renderQqBotTwemoji(segment.icon, cursor, baselineY, fontSize) : null;
      if (emoji) {
        markup.push(emoji);
        if (run.strike) {
          markup.push(`<line x1="${formatSvgNumber(cursor)}" y1="${formatSvgNumber(baselineY - fontSize * 0.32)}" x2="${formatSvgNumber(cursor + width)}" y2="${formatSvgNumber(baselineY - fontSize * 0.32)}" stroke="${run.color || "#263238"}" stroke-width="2" />`);
        }
      } else {
        markup.push(`<text x="${formatSvgNumber(cursor)}" y="${formatSvgNumber(baselineY)}" font-family="${QQBOT_AI_TEXT_FONT_FAMILY}" font-size="${fontSize}" fill="#263238">${renderRun({ ...run, text: segment.text })}</text>`);
      }
      cursor += width;
    }
  }
  return markup.join("");
}

function renderPlainTextWithEmoji(
  value: string,
  anchorX: number,
  baselineY: number,
  fontSize: number,
  attributes: string,
  anchor: "start" | "middle" | "end" = "start",
) {
  const text = String(value || "");
  if (!twemoji.test(text)) {
    const anchorAttribute = anchor === "start" ? "" : ` text-anchor="${anchor}"`;
    return `<text x="${formatSvgNumber(anchorX)}" y="${formatSvgNumber(baselineY)}"${anchorAttribute} font-family="${QQBOT_AI_TEXT_FONT_FAMILY}" font-size="${fontSize}" ${attributes}>${escapeXml(text)}</text>`;
  }
  const totalWidth = estimateTextWidth(text, fontSize, { bold: /font-weight="[6-9]/u.test(attributes) });
  let cursor = anchor === "middle" ? anchorX - totalWidth / 2 : anchor === "end" ? anchorX - totalWidth : anchorX;
  const markup: string[] = [];
  for (const segment of splitQqBotEmojiText(text)) {
    const width = estimateTextWidth(segment.text, fontSize);
    const emoji = segment.icon ? renderQqBotTwemoji(segment.icon, cursor, baselineY, fontSize) : null;
    if (emoji) markup.push(emoji);
    else markup.push(`<text x="${formatSvgNumber(cursor)}" y="${formatSvgNumber(baselineY)}" font-family="${QQBOT_AI_TEXT_FONT_FAMILY}" font-size="${fontSize}" ${attributes}>${escapeXml(segment.text)}</text>`);
    cursor += width;
  }
  return markup.join("");
}

function renderRun(run: InlineRun) {
  const attrs = [
    run.bold ? `font-weight="700"` : "",
    run.italic ? `font-style="italic"` : "",
    run.code ? `font-family="Consolas, Microsoft YaHei, Segoe UI Emoji, Noto Color Emoji, Apple Color Emoji, monospace"` : "",
    run.math ? `font-family="Cambria Math, STIX Two Math, Times New Roman, Microsoft YaHei, Segoe UI Emoji, Noto Color Emoji, Apple Color Emoji, sans-serif"` : "",
    run.color ? `fill="${run.color}"` : "",
    run.strike ? `text-decoration="line-through"` : "",
  ].filter(Boolean).join(" ");
  return `<tspan${attrs ? ` ${attrs}` : ""}>${escapeXml(run.text)}</tspan>`;
}

function lineHeight(line: RenderLine) {
  return line.rule ? 2 : Math.ceil(line.fontSize * 1.58);
}

function estimateTextWidth(text: string, fontSize: number, style: Pick<InlineRun, "bold" | "code" | "math"> = {}) {
  let width = 0;
  for (const char of splitQqBotGraphemes(String(text || ""))) {
    if (/\s/u.test(char)) width += fontSize * 0.34;
    else if (twemoji.test(char)) width += fontSize * QQBOT_AI_EMOJI_ADVANCE_RATIO;
    else if (/[\u2e80-\u9fff\uff00-\uffef\u{1f300}-\u{1faff}]/u.test(char)) width += fontSize;
    else width += fontSize * (style.math ? 0.66 : style.code || style.bold ? 0.64 : 0.62);
  }
  return width;
}

function sameRunStyle(left: InlineRun, right: InlineRun) {
  return Boolean(left.bold) === Boolean(right.bold)
    && Boolean(left.italic) === Boolean(right.italic)
    && Boolean(left.code) === Boolean(right.code)
    && Boolean(left.math) === Boolean(right.math)
    && Boolean(left.strike) === Boolean(right.strike)
    && left.color === right.color;
}

function flattenRunText(runs: InlineRun[]) {
  return runs.map((run) => run.text).join("");
}

function safeDisplayUrl(value: string) {
  const href = String(value || "").trim();
  if (/^https?:\/\//i.test(href)) return splitQqBotLinkUrl(href).url;
  if (/^(?:mailto:|tel:)/i.test(href)) return href;
  return "";
}

/**
 * Marked's GFM URL tokenizer accepts Chinese text after an URL as part of the
 * link. Keep the ASCII URL boundary and return the swallowed prose so it can
 * be rendered as ordinary text instead of a giant punycode hostname.
 */
export function splitQqBotLinkUrl(value: string) {
  const input = String(value || "").trim();
  if (!/^https?:\/\//i.test(input)) return { url: "", trailing: "" };
  const match = input.match(/^(https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?)/i);
  if (!match) return { url: "", trailing: input };
  return {
    url: match[1],
    trailing: input.slice(match[1].length),
  };
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
