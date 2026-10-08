import { isCommandMessage } from "./commands";
import type { QqGroupAssistantTrigger } from "./groupAssistantTrigger";

export const QQBOT_AI_DISCLOSURE = "以上回复由拾间AI生成，内容可能存在偏差，请自行鉴别并以官方信息为准。";
export const QQBOT_DAILY_ASSISTANT_DEBOUNCE_MS = 5_000;
export const QQBOT_DAILY_ASSISTANT_PROACTIVE_GROUP_DEBOUNCE_MS = 20_000;
const QQBOT_DAILY_ASSISTANT_MAX_BATCH_CHARS = 6_000;

type QqBotPrivateAssistantInput = {
  messageText: string;
  message: unknown;
};

/** Proactive group answers wait longer so a human gets the first chance to reply. */
export function getQqBotDailyAssistantDebounceMs(trigger: "private" | QqGroupAssistantTrigger) {
  return trigger === "proactive"
    ? QQBOT_DAILY_ASSISTANT_PROACTIVE_GROUP_DEBOUNCE_MS
    : QQBOT_DAILY_ASSISTANT_DEBOUNCE_MS;
}

/**
 * Private chats answer any plain text or image. Group messages go through
 * decideQqGroupAssistant instead.
 */
export function shouldHandleQqBotPrivateAssistant(input: QqBotPrivateAssistantInput) {
  const text = String(input.messageText || "").trim();
  if (text && isCommandMessage(text)) return false;
  return isSupportedQqAssistantMessage(input.message) && (Boolean(text) || containsQqImageSegment(input.message));
}

export function mergeQqBotDailyAssistantMessages(messages: string[]) {
  return messages
    .map((message) => String(message || "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, QQBOT_DAILY_ASSISTANT_MAX_BATCH_CHARS);
}

export function appendQqBotAiDisclosure(message: string) {
  const normalized = String(message || "").trim();
  return normalized ? `${normalized}\n\n${QQBOT_AI_DISCLOSURE}` : QQBOT_AI_DISCLOSURE;
}

// QQ emoji (face/mface) only decorate the text, so they do not turn a
// question into an unsupported message.
const QQ_ASSISTANT_SEGMENT_TYPES = new Set(["text", "at", "reply", "image", "face", "mface"]);

/** Text, images and emoji; voice, video, forwards and cards keep their own handlers. */
export function isSupportedQqAssistantMessage(message: unknown): boolean {
  if (typeof message === "string") {
    return Array.from(message.matchAll(/\[CQ:([^,\]]+)/gi))
      .every((match) => QQ_ASSISTANT_SEGMENT_TYPES.has(String(match[1] || "").trim().toLowerCase()));
  }
  if (Array.isArray(message)) {
    return message.length > 0 && message.every((segment) => isSupportedQqAssistantMessageSegment(segment));
  }
  if (!message || typeof message !== "object") return false;
  const value = message as Record<string, unknown>;
  if (QQ_ASSISTANT_SEGMENT_TYPES.has(String(value.type ?? ""))) return true;
  if (Array.isArray(value.message)) return isSupportedQqAssistantMessage(value.message);
  if (Array.isArray(value.content)) return isSupportedQqAssistantMessage(value.content);
  if (typeof value.message === "string") return isSupportedQqAssistantMessage(value.message);
  if (typeof value.content === "string") return isSupportedQqAssistantMessage(value.content);
  return false;
}

function isSupportedQqAssistantMessageSegment(segment: unknown) {
  if (!segment || typeof segment !== "object") return false;
  return QQ_ASSISTANT_SEGMENT_TYPES.has(String((segment as Record<string, unknown>).type ?? ""));
}

export function containsQqImageSegment(message: unknown): boolean {
  if (typeof message === "string") return /\[CQ:image(?:,|\])/iu.test(message);
  if (Array.isArray(message)) return message.some((segment) => containsQqImageSegment(segment));
  if (!message || typeof message !== "object") return false;
  const value = message as Record<string, unknown>;
  if (value.type === "image") return true;
  return containsQqImageSegment(value.message) || containsQqImageSegment(value.content);
}
