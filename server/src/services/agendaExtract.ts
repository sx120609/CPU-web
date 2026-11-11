import {
  allowsPlainTextAssistantAnswer,
  containsRestrictedPublicTopic,
  parseAssistantJson,
} from "./campusAssistant";
import { getSiteConfig, isAiProviderReady, resolveAiServiceCandidatesForScene } from "./siteSettings";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
import { extractAiJsonTextResponse, normalizeAiJsonApiUrl, sendAiJsonRequestWithProviderFallback, type AiJsonMessage, type AiJsonMessagePart } from "./aiJsonApi";
import { normalizeAiImageDataUrl } from "./aiImageValidation";
import { resolveModelCandidates } from "./modelFallback";
import {
  agendaChinaClock,
  agendaClockMinutes,
  agendaDayNumber,
  agendaWeekday,
  AGENDA_REMIND_CHOICES,
  type AgendaRepeat,
} from "../shared/agenda";

/**
 * 从截图或粘贴的通知里读出日程：活动通知往往一长串，拾间AI 把时间、地点和要带什么、
 * 怎么报名这类注意事项摘出来，交给日程编辑器预填，用户看过再保存。这里只读不存。
 */

export type AgendaExtractItem = {
  title: string;
  date: string;
  start: string;
  end: string;
  location: string;
  note: string;
  remind: number;
  repeat: AgendaRepeat;
};

export type AgendaExtractResult = {
  items: AgendaExtractItem[];
  /** 读不出日程时告诉用户原因。 */
  message: string;
  fallback: boolean;
};

const MAX_ITEMS = 6;
const MAX_OUTPUT_TOKENS = 2_400;
const DEFAULT_API_URL = "https://api.openai.com/v1/chat/completions";
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const REPEATS: AgendaRepeat[] = ["none", "daily", "weekdays", "weekly", "monthly"];
const REMINDS = new Set(AGENDA_REMIND_CHOICES.map((choice) => choice.value));

export function buildAgendaExtractPrompt(nowMs: number) {
  const clock = agendaChinaClock(nowMs);
  const minutes = clock.minutes;
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return [
    "你是拾间AI，帮大学生把活动通知、讲座海报、聊天截图或通知文字整理成日程。",
    "找出里面需要本人到场或在某个时间前完成的事：活动、讲座、会议、考试、报名截止、材料提交截止等。一次通知里有几场就列几条（最多 6 条），同一件事不要拆开；报名截止和活动本身是两件事时分开列。",
    "字段：title 不超过 20 字，写成“做什么”，去掉“关于举办……的通知”这类套话；date 为 YYYY-MM-DD，没写年份时取今天及以后最近的那一天，只写“周三”时取最近的那个周三，看不出日期就留空；start、end 为 24 小时制 HH:MM，只有截止时间时 start 写截止时刻、end 留空，没有具体时刻都留空；location 不超过 20 字，写最具体的地点（楼名+房间号），线上会议写平台和会议号；note 不超过 200 字，按“要带的东西、着装、报名方式、联系人、其他注意事项”逐条用“· ”开头分行列出，只写通知里有的，没有就留空，不要复述标题、时间和地点。",
    "remind：活动给 30，截止给 60，只有日期没有时刻的给 0。repeat 一般为 none，只有通知明确说每周都有时才写 weekly。",
    "只依据图片和文字里写明的内容，不要编造；看不清的字段留空。图片里没有任何可记的安排时，items 给空数组并在 message 里用一句话说明。",
    "本服务面向中国大陆公众，不整理违法违规或政治敏感内容。",
    "只输出一个 JSON 对象，不要 Markdown 代码块：",
    '{"items":[{"title":"","date":"","start":"","end":"","location":"","note":"","remind":30,"repeat":"none"}],"message":""}',
    `现在是 ${clock.date} ${time}（${WEEKDAYS[agendaWeekday(clock.date) - 1]}，北京时间）。`,
  ].join("\n");
}

/** 截图看得清细字才有用，所以按 high 发；文字和截图一起给时都放进同一条消息。 */
export function buildAgendaExtractMessages(input: { text: string; image: string; nowMs: number }): AiJsonMessage[] {
  const text = input.text ? `通知文字：\n${input.text}` : "请从这张截图里整理日程。";
  const content: string | AiJsonMessagePart[] = input.image
    ? [{ type: "text", text }, { type: "image_url", image_url: { url: input.image, detail: "high" } }]
    : text;
  return [
    { role: "system", content: buildAgendaExtractPrompt(input.nowMs) },
    { role: "user", content },
  ];
}

/**
 * 模型有时把换行写成字面上的 `\n`（JSON 里多转义了一层），原样存下来就会在备注里看到
 * 一串反斜杠。这里还原成真正的换行，制表符同理。
 */
function unescapeModelText(value: unknown) {
  return String(value ?? "")
    .replace(/\\r\\n|\\n|\\r/gu, "\n")
    .replace(/\\t/gu, " ")
    .replace(/\r\n?/gu, "\n");
}

function clip(value: unknown, max: number) {
  return unescapeModelText(value).trim().slice(0, max);
}

/** 规整模型给的日程：格式不对的字段清空，没有标题的丢掉。 */
export function sanitizeAgendaExtract(raw: unknown): AgendaExtractResult {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(value.items) ? value.items : [];
  const items: AgendaExtractItem[] = [];
  for (const entry of list) {
    if (items.length >= MAX_ITEMS) break;
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const title = clip(item.title, 60).replace(/\s+/gu, " ");
    if (!title) continue;
    const note = unescapeModelText(item.note)
      .split("\n").map((line) => line.trim()).filter(Boolean).join("\n")
      .slice(0, 1_000);
    const location = clip(item.location, 40).replace(/\s+/gu, " ");
    if ([title, note, location].some(containsRestrictedPublicTopic)) continue;
    const date = agendaDayNumber(item.date) === null ? "" : String(item.date);
    const start = date && agendaClockMinutes(item.start) !== null ? String(item.start) : "";
    const startMinutes = agendaClockMinutes(start);
    const endMinutes = agendaClockMinutes(item.end);
    const end = start && endMinutes !== null && startMinutes !== null && endMinutes > startMinutes ? String(item.end) : "";
    const remindValue = Number(item.remind);
    const remind = !date
      ? -1
      : REMINDS.has(remindValue) ? remindValue : (start ? 30 : 0);
    const repeat = date && REPEATS.includes(item.repeat as AgendaRepeat) ? item.repeat as AgendaRepeat : "none";
    items.push({ title, date, start, end, location, note, remind, repeat });
  }
  const message = items.length ? "" : (clip(value.message, 120) || "没有在里面找到时间和要做的事");
  return { items, message: containsRestrictedPublicTopic(message) ? "没有在里面找到时间和要做的事" : message, fallback: false };
}

export async function extractAgendaFromContent(input: {
  image?: string;
  text?: string;
  nowMs?: number;
  signal?: AbortSignal;
  usage?: { createdById?: number | null; pointCost?: number };
}): Promise<AgendaExtractResult> {
  const text = String(input.text ?? "").trim().slice(0, 4_000);
  const image = input.image ? (await normalizeAiImageDataUrl(input.image)).dataUrl : "";
  if (!text && !image) return { items: [], message: "先选一张截图或粘贴通知文字", fallback: false };

  const config = getSiteConfig();
  const providers = resolveAiServiceCandidatesForScene(config, "assistant");
  const provider = providers[0];
  if (!config.aiReviewEnabled || !providers.some((candidate) => isAiProviderReady({
    provider: candidate.provider,
    apiUrl: candidate.apiUrl,
    apiKey: candidate.apiKey,
    model: config.assistantModel,
  }))) {
    return { items: [], message: "拾间AI暂未启用", fallback: true };
  }

  const messages = buildAgendaExtractMessages({ text, image, nowMs: input.nowMs ?? Date.now() });
  const candidates = resolveModelCandidates(config.assistantModel, "");
  const started = await startAiReviewLog({
    kind: "campus-assistant",
    targetLabel: "拾间AI 识别日程",
    provider: provider.provider || "ai-json-api",
    model: candidates[0] || config.assistantModel,
    endpoint: normalizeAiJsonApiUrl(provider.apiUrl, DEFAULT_API_URL),
    requestSummary: image ? `[截图]${text ? ` ${text.slice(0, 200)}` : ""}` : text.slice(0, 300),
    createdById: input.usage?.createdById ?? null,
    pointCost: input.usage?.pointCost ?? 0,
  });
  const logId = started?.id ?? null;
  let lastError: unknown = null;

  for (const model of candidates) {
    try {
      const result = await sendAiJsonRequestWithProviderFallback({
        providers,
        fallbackEndpoint: DEFAULT_API_URL,
        model,
        temperature: 0.1,
        maxTokens: MAX_OUTPUT_TOKENS,
        messages,
        signal: input.signal,
      });
      if (!result.response.ok) {
        const errorText = result.errorText || await result.response.text().catch(() => "");
        throw new Error(`AI 请求失败：${result.response.status}${errorText ? ` ${errorText.slice(0, 120)}` : ""}`);
      }
      const json: unknown = await result.response.json();
      const answer = extractAiJsonTextResponse(json, result.mode);
      const parsed = parseAssistantJson(answer, { allowPlainText: allowsPlainTextAssistantAnswer(model) });
      const extracted = sanitizeAgendaExtract(parsed);
      await finishAiReviewLogSuccess(logId, JSON.stringify(extracted.items).slice(0, 2_000) || extracted.message);
      return extracted;
    } catch (error) {
      if (input.signal?.aborted) {
        await finishAiReviewLogError(logId, "请求已取消");
        throw error;
      }
      lastError = error;
    }
  }
  await finishAiReviewLogError(logId, lastError instanceof Error ? lastError.message : String(lastError || "AI 请求失败"));
  console.warn("[agenda-extract] AI request failed", lastError instanceof Error ? lastError.message : lastError);
  return { items: [], message: "拾间AI暂时没有响应，请稍后再试", fallback: true };
}
