import { isCommandMessage } from "./commands";

export const QQBOT_AI_DISCLOSURE = "以上回复由拾间AI生成，内容可能存在偏差，请自行鉴别并以官方信息为准。";
export const QQBOT_DAILY_ASSISTANT_DEBOUNCE_MS = 5_000;
export const QQBOT_DAILY_ASSISTANT_PROACTIVE_GROUP_DEBOUNCE_MS = 20_000;
const QQBOT_DAILY_ASSISTANT_MAX_BATCH_CHARS = 6_000;

type QqBotDailyAssistantInput = {
  messageType?: "private" | "group";
  messageText: string;
  botMentioned: boolean;
  proactiveGroupReply?: boolean;
  allowUnmentionedContinuation?: boolean;
  message: unknown;
};

export function getQqBotDailyAssistantDebounceMs(input: {
  messageType?: "private" | "group";
  botMentioned: boolean;
  proactiveGroupReply?: boolean;
}) {
  if (
    input.messageType === "group"
    && !input.botMentioned
    && input.proactiveGroupReply === true
  ) {
    return QQBOT_DAILY_ASSISTANT_PROACTIVE_GROUP_DEBOUNCE_MS;
  }
  return QQBOT_DAILY_ASSISTANT_DEBOUNCE_MS;
}

/** Keep non-visual structured messages in their existing handlers. */
export function shouldHandleQqBotDailyAssistant(input: QqBotDailyAssistantInput) {
  const text = String(input.messageText || "").trim();
  if (text && isCommandMessage(text)) return false;
  if (
    input.messageType === "group"
    && !input.botMentioned
    && !input.proactiveGroupReply
    && !input.allowUnmentionedContinuation
  ) return false;
  const allowImages = input.messageType !== "group"
    || input.botMentioned
    || input.allowUnmentionedContinuation === true;
  return isSupportedQqAssistantMessage(input.message, allowImages) && (Boolean(text) || containsQqImageSegment(input.message));
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

function isSupportedQqAssistantMessage(message: unknown, allowImages: boolean): boolean {
  if (typeof message === "string") {
    return Array.from(message.matchAll(/\[CQ:([^,\]]+)/gi))
      .every((match) => ["at", "reply", ...(allowImages ? ["image"] : [])].includes(String(match[1] || "").trim().toLowerCase()));
  }
  if (Array.isArray(message)) {
    return message.length > 0 && message.every((segment) => isSupportedQqAssistantMessageSegment(segment, allowImages));
  }
  if (!message || typeof message !== "object") return false;
  const value = message as Record<string, unknown>;
  if (value.type === "text" || value.type === "at" || value.type === "reply" || (allowImages && value.type === "image")) return true;
  if (Array.isArray(value.message)) return isSupportedQqAssistantMessage(value.message, allowImages);
  if (Array.isArray(value.content)) return isSupportedQqAssistantMessage(value.content, allowImages);
  if (typeof value.message === "string") return isSupportedQqAssistantMessage(value.message, allowImages);
  if (typeof value.content === "string") return isSupportedQqAssistantMessage(value.content, allowImages);
  return false;
}

function isSupportedQqAssistantMessageSegment(segment: unknown, allowImages: boolean) {
  if (!segment || typeof segment !== "object") return false;
  const value = segment as Record<string, unknown>;
  return value.type === "text" || value.type === "at" || value.type === "reply" || (allowImages && value.type === "image");
}

function containsQqImageSegment(message: unknown): boolean {
  if (typeof message === "string") return /\[CQ:image(?:,|\])/iu.test(message);
  if (Array.isArray(message)) return message.some((segment) => containsQqImageSegment(segment));
  if (!message || typeof message !== "object") return false;
  const value = message as Record<string, unknown>;
  if (value.type === "image") return true;
  return containsQqImageSegment(value.message) || containsQqImageSegment(value.content);
}
