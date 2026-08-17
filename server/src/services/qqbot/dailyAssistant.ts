import { isCommandMessage } from "./commands";

export const QQBOT_AI_DISCLOSURE = "以上回复由拾间AI生成，内容可能存在偏差，请自行鉴别并以官方信息为准。";
export const QQBOT_DAILY_ASSISTANT_DEBOUNCE_MS = 2_000;
const QQBOT_DAILY_ASSISTANT_MAX_BATCH_CHARS = 6_000;

type QqBotDailyAssistantInput = {
  messageType?: "private" | "group";
  messageText: string;
  botMentioned: boolean;
  proactiveGroupReply?: boolean;
  allowUnmentionedContinuation?: boolean;
  message: unknown;
};

/**
 * Keep the daily-chat route text-only.  QQ commands, media and other
 * structured messages belong to their existing handlers (moderation,
 * posting, course automation, etc.) and must not be sent to the assistant.
 */
export function shouldHandleQqBotDailyAssistant(input: QqBotDailyAssistantInput) {
  const text = String(input.messageText || "").trim();
  if (!text || isCommandMessage(text)) return false;
  if (
    input.messageType === "group"
    && !input.botMentioned
    && !input.proactiveGroupReply
    && !input.allowUnmentionedContinuation
  ) return false;
  return isPlainTextQqMessage(input.message);
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

function isPlainTextQqMessage(message: unknown): boolean {
  if (typeof message === "string") {
    return Array.from(message.matchAll(/\[CQ:([^,\]]+)/gi))
      .every((match) => String(match[1] || "").trim().toLowerCase() === "at");
  }
  if (Array.isArray(message)) {
    return message.length > 0 && message.every((segment) => isPlainTextQqMessageSegment(segment));
  }
  if (!message || typeof message !== "object") return false;
  const value = message as Record<string, unknown>;
  if (value.type === "text" || value.type === "at") return true;
  if (Array.isArray(value.message)) return isPlainTextQqMessage(value.message);
  if (Array.isArray(value.content)) return isPlainTextQqMessage(value.content);
  if (typeof value.message === "string") return isPlainTextQqMessage(value.message);
  if (typeof value.content === "string") return isPlainTextQqMessage(value.content);
  return false;
}

function isPlainTextQqMessageSegment(segment: unknown) {
  if (!segment || typeof segment !== "object") return false;
  const value = segment as Record<string, unknown>;
  return value.type === "text" || value.type === "at";
}
