import { getSiteConfig } from "./siteSettings";
import { requestAiJson } from "./topicAiReview";

export type TopicFormatEditorMode = "visual" | "markup";

export type TopicAutoFormatResult = {
  content: string;
  provider: "ai" | "fallback";
  model: string | null;
  summary: string;
};

type FormatJsonResponse = {
  content?: string;
  formattedContent?: string;
  summary?: string;
};

const FORMAT_SYSTEM_PROMPT = [
  "你是校园社区发帖排版助手。",
  "你的任务只是在不改变原意的前提下优化排版，不要编造新信息，也不要删除已有事实、价格、时间、课程名、联系方式、链接、图片地址或视频地址。",
  "优先输出 Markdown；在确实更适合时可以混用安全 HTML 标签，例如 p、div、h2、h3、blockquote、ul、ol、li、table、thead、tbody、tr、th、td、img、video、source。",
  "禁止输出 script、style、iframe 等不安全标签。",
  "如果原文已经很清晰，只做轻微整理。",
  "只返回 JSON。",
].join(" ");

const FORMAT_USER_PROMPT = [
  "请把下面这段论坛正文整理成更适合发布的版本。",
  "输出格式：{\"content\":\"排版后的正文\",\"summary\":\"一句话说明做了哪些排版整理\"}",
  "",
  "要求：",
  "1. 保留原有语气和信息，不要补充不存在的内容。",
  "2. 保留现有链接、图片、视频、表格和联系方式。",
  "3. 分段要清晰，必要时补充小标题、列表、引用或表格结构。",
  "4. 如果内容本身就是源码排版，请尽量延续现有 Markdown / HTML 风格。",
  "5. 输出长度尽量与原文接近，不要无意义扩写。",
  "",
  "板块名称：{{boardName}}",
  "板块类型：{{boardType}}",
  "编辑模式偏好：{{editorModeHint}}",
  "标题：{{title}}",
  "原文：",
  "{{content}}",
].join("\n");

export async function autoFormatTopicContent(input: {
  title?: string | null;
  content: string;
  boardName?: string | null;
  boardType?: string | null;
  editorMode?: TopicFormatEditorMode | null;
}): Promise<TopicAutoFormatResult> {
  const original = normalizeLineBreaks(input.content);
  const fallback = fallbackFormatContent(original);
  const config = getSiteConfig();

  if (!config.aiReviewApiKey.trim()) {
    return {
      content: fallback,
      provider: "fallback",
      model: null,
      summary: "未配置 AI，已使用本地规则整理排版",
    };
  }

  try {
    const { content, model } = await requestAiJson([
      {
        role: "system",
        content: FORMAT_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: renderPromptTemplate(FORMAT_USER_PROMPT, {
          boardName: input.boardName,
          boardType: input.boardType,
          editorModeHint: input.editorMode === "markup"
            ? "允许 Markdown + HTML 混合排版，尽量保留源码风格"
            : "优先整理成结构清晰、适合可视化继续编辑的发布格式",
          title: input.title,
          content: original,
        }),
      },
    ]);

    const parsed = parseFormatJson(content);
    const formatted = normalizeFormattedContent(parsed.content || parsed.formattedContent || "");
    if (!formatted) throw new Error("AI 返回为空");
    if (formatted.length > 20_000) throw new Error("AI 返回内容过长");

    return {
      content: formatted,
      provider: "ai",
      model,
      summary: String(parsed.summary || "已完成自动排版").trim().slice(0, 80) || "已完成自动排版",
    };
  } catch {
    return {
      content: fallback,
      provider: "fallback",
      model: null,
      summary: "AI 当前不可用，已改用本地规则整理排版",
    };
  }
}

function parseFormatJson(content: string): FormatJsonResponse {
  if (!content || typeof content !== "string") return {};
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function renderPromptTemplate(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => stringifyPromptValue(vars[key]));
}

function stringifyPromptValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeFormattedContent(value: string) {
  return normalizeLineBreaks(value)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLineBreaks(value: string) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function fallbackFormatContent(input: string) {
  const normalized = normalizeLineBreaks(input)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return "";
  if (looksLikeHtml(normalized) || looksLikeStructuredMarkup(normalized)) return normalized;

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((block) => formatPlainParagraph(block))
    .filter(Boolean);
  return paragraphs.join("\n\n");
}

function looksLikeHtml(value: string) {
  return /<\/?(p|div|h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|img|video|source|a)\b/i.test(value);
}

function looksLikeStructuredMarkup(value: string) {
  return /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```|\|.+\|)|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)/m.test(value);
}

function formatPlainParagraph(block: string) {
  const compact = block.replace(/\s*\n+\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= 90) return compact;

  const sentences = compact.match(/[^。！？；!?;]+[。！？；!?;]?/g)?.map((item) => item.trim()).filter(Boolean) ?? [compact];
  if (sentences.length <= 1) return compact;

  const output: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current}${sentence}` : sentence;
    if (current && next.length > 88) {
      output.push(current.trim());
      current = sentence;
      continue;
    }
    current = next;
  }
  if (current.trim()) output.push(current.trim());
  return output.join("\n\n");
}
