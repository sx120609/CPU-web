import { isCommandMessage, isGreetingMessage } from "./commands";
import { containsQqImageSegment, isSupportedQqAssistantMessage } from "./dailyAssistant";

/**
 * Decides when 拾间AI speaks in a QQ group.
 *
 * A member addresses the bot by @-ing it, by calling it by name, or by quoting
 * one of its messages. A bare call ("@拾间AI", "拾间AI 在吗") summons the bot
 * and the member's next message is the question. After an answer, the same
 * member can keep asking for a few minutes without @-ing again. Anything aimed
 * at another member (an @ or a quote) is never answered unless the bot is
 * addressed explicitly in the same message. Proactive answers stay opt-in per
 * group, are rate limited, and step aside when a human answers first.
 */

export const QQBOT_GROUP_SUMMON_WINDOW_MS = 60_000;
export const QQBOT_GROUP_FOLLOW_UP_WINDOW_MS = 3 * 60_000;
export const QQBOT_GROUP_PROACTIVE_COOLDOWN_MS = 60_000;
export const QQBOT_GROUP_PROACTIVE_MIN_CHARS = 5;
/**
 * Quoting the bot and follow-ups need no @, so another bot that quotes
 * replies could keep a conversation going forever. After this many answers in
 * the window a member has to @ the bot again.
 */
export const QQBOT_GROUP_IMPLICIT_TURN_LIMIT = 4;
export const QQBOT_GROUP_IMPLICIT_TURN_WINDOW_MS = 3 * 60_000;
export const QQBOT_GROUP_SUMMON_ACK = "我在～直接说你的问题就好。";

const QUOTED_CONTEXT_MAX_CHARS = 1_500;
const ASSISTANT_REPLY_TTL_MS = 6 * 60 * 60_000;
const ASSISTANT_REPLY_MAX_ENTRIES = 500;
const SESSION_MAX_ENTRIES = 2_000;

const BOT_NAME = String.raw`(?:药大)?拾间\s*[·・]?\s*(?:ai|bot|助手)|qqbot`;
const TEXT_AT_NAME_PATTERN = new RegExp(String.raw`@\s*(?:${BOT_NAME})`, "giu");
const LEADING_NAME_PATTERN = new RegExp(String.raw`^(请问|问一?下|问问)?\s*(?:${BOT_NAME})([\s\S]*)$`, "iu");
const TRAILING_NAME_PATTERN = new RegExp(String.raw`^([\s\S]*?)(?:[\s，,。]*(问问|问一?下)|[\s，,。]+)(?:${BOT_NAME})[\s?？!！。~～]*$`, "iu");
const CALL_SEPARATOR_PATTERN = /^[\s，,:：、!！~～。.]+/u;
const ACKNOWLEDGEMENT_PATTERN = /^(?:谢谢|谢了|多谢|感谢|thx|thanks?|好的?|好滴|好嘞|ok|okay|收到|明白了?|懂了|知道了|了解|行|嗯+|哦+|噢+|哈+|草|牛|666+|👍)[\s!！~～。.…]*$/iu;
const QUESTION_MARK_PATTERN = /[?？]/u;
const QUESTION_ENDING_PATTERN = /(?:吗|嘛|呢)[\s!！~～。.…]*$/u;
const INTERROGATIVE_PATTERN = /(?:怎么|怎样|咋|如何|为什么|为啥|为何|什么|啥|哪|谁|多少|多久|几点|几号|几天|几个|几次|几门|是否|能不能|能否|可不可以|可以吗|行不行|会不会|要不要|有没有|是不是|对不对|该不该)/u;
const REQUEST_PATTERN = /^(?:那|那么|还有|另外|再|然后|顺便)?\s*(?:帮我|帮忙|请|麻烦|给我|告诉我|教我|查一下|查查|推荐|解释|介绍|翻译|总结|详细说|展开说|继续)/u;

export type QqGroupAssistantTrigger =
  | "mention"
  | "name"
  | "reply-to-bot"
  | "summoned"
  | "continuation"
  | "follow-up"
  | "proactive";

export type QqGroupAssistantSessionKind = "summoned" | "follow-up";

export type QqGroupAssistantSignals = {
  /** Message text with bot name calls removed. */
  text: string;
  /** Raw OneBot message, used for segment checks. */
  message: unknown;
  mentionsBot: boolean;
  calledByName: boolean;
  /** The message @-s someone other than the bot, including @全体成员. */
  mentionsOthers: boolean;
  /** Whose message this one quotes; an unresolvable quote counts as another member's. */
  quoted: "none" | "bot" | "other";
  /** The quoted message has text or images to answer about. */
  quotedHasContent: boolean;
  session: QqGroupAssistantSessionKind | null;
  /** A batch for this member is still waiting for more lines. */
  collecting: boolean;
  /** Answers this member received within QQBOT_GROUP_IMPLICIT_TURN_WINDOW_MS. */
  recentAnswers: number;
  proactiveCoolingDown: boolean;
};

export type QqGroupAssistantDecision =
  | { action: "ignore"; reason: "unsupported" | "command" | "addressed-to-others" | "not-addressed" }
  | { action: "summon"; trigger: "mention" | "name" | "reply-to-bot" }
  | { action: "answer"; trigger: Exclude<QqGroupAssistantTrigger, "proactive"> }
  /** Eligible for a proactive answer; the group's switch and the model's intent check decide. */
  | { action: "proactive-candidate" };

export function decideQqGroupAssistant(signals: QqGroupAssistantSignals): QqGroupAssistantDecision {
  const text = cleanQqGroupAssistantText(signals.text);
  if (text && isCommandMessage(text)) return { action: "ignore", reason: "command" };
  if (!isSupportedQqAssistantMessage(signals.message)) return { action: "ignore", reason: "unsupported" };
  const hasImage = containsQqImageSegment(signals.message);
  const implicitTurnsLeft = signals.recentAnswers < QQBOT_GROUP_IMPLICIT_TURN_LIMIT;

  const explicit = signals.mentionsBot
    ? "mention"
    : signals.calledByName
      ? "name"
      : signals.quoted === "bot" && implicitTurnsLeft
        ? "reply-to-bot"
        : null;
  if (explicit) {
    // A bare call, or one that only greets, has nothing to answer yet: wait
    // for the question instead of sending the model an empty prompt.
    const quotesSomethingToAnswer = signals.quoted === "other" && signals.quotedHasContent;
    const bareCall = !hasImage && !quotesSomethingToAnswer && (!text || isGreetingMessage(text));
    return bareCall ? { action: "summon", trigger: explicit } : { action: "answer", trigger: explicit };
  }

  const hasContent = Boolean(text) || hasImage;
  // Right after a bare call the member's next message is the question, even
  // when it quotes the message they want explained.
  if (signals.session === "summoned" && hasContent && !signals.mentionsOthers) {
    return { action: "answer", trigger: "summoned" };
  }
  if (signals.mentionsOthers || signals.quoted === "other") return { action: "ignore", reason: "addressed-to-others" };
  if (signals.collecting && hasContent) return { action: "answer", trigger: "continuation" };
  if (signals.session === "follow-up" && implicitTurnsLeft && !hasImage && looksLikeQqGroupFollowUpQuestion(text)) {
    return { action: "answer", trigger: "follow-up" };
  }
  if (
    !signals.proactiveCoolingDown
    && !hasImage
    && signals.quoted === "none"
    && Array.from(text).length >= QQBOT_GROUP_PROACTIVE_MIN_CHARS
    && !isGreetingMessage(text)
  ) {
    return { action: "proactive-candidate" };
  }
  return { action: "ignore", reason: "not-addressed" };
}

/** Every @ target in a OneBot message, including "all" for @全体成员. */
export function collectQqAtTargets(message: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\[CQ:at,([^\]]+)\]/giu)) {
        const params = new URLSearchParams(match[1].replace(/,/gu, "&"));
        const target = String(params.get("qq") || "").trim();
        if (target) found.add(target);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const segment = value as { type?: unknown; data?: { qq?: unknown; message?: unknown; content?: unknown }; message?: unknown; content?: unknown };
    if (segment.type === "at") {
      const target = String(segment.data?.qq ?? "").trim();
      if (target) found.add(target);
    }
    visit(segment.message);
    visit(segment.content);
    visit(segment.data?.message);
    visit(segment.data?.content);
  };
  visit(message);
  return Array.from(found);
}

/**
 * Detects a call by name in plain text: "拾间AI，…", "@拾间AI …" typed as
 * text, "请问拾间ai …", or a trailing "…，拾间AI". A name followed directly
 * by words only counts when the rest reads as a question or a greeting, so
 * "拾间ai挺好用的" stays a remark about the bot.
 */
export function parseQqBotNameCall(text: string): { called: boolean; text: string } {
  const original = String(text || "").trim();
  if (!original) return { called: false, text: "" };

  const withoutTextAt = original.replace(TEXT_AT_NAME_PATTERN, " ").replace(/\s+/gu, " ").trim();
  if (withoutTextAt !== original) return { called: true, text: stripCallSeparator(withoutTextAt) };

  const leading = original.match(LEADING_NAME_PATTERN);
  if (leading) {
    const prefixed = Boolean(leading[1]);
    const rest = leading[2] || "";
    const separated = !rest.trim() || CALL_SEPARATOR_PATTERN.test(rest);
    const remainder = stripCallSeparator(rest);
    if (prefixed || separated || looksLikeQqGroupFollowUpQuestion(remainder) || isGreetingMessage(remainder)) {
      return { called: true, text: remainder };
    }
  }

  const trailing = original.match(TRAILING_NAME_PATTERN);
  const trailingRemainder = stripCallSeparator(trailing?.[1] || "");
  if (trailing && trailingRemainder && (trailing[2] || looksLikeQqGroupFollowUpQuestion(trailingRemainder))) {
    return { called: true, text: trailingRemainder };
  }

  return { called: false, text: original };
}

/** Heuristic for continuing a conversation without @: a question or a request, not an acknowledgement. */
export function looksLikeQqGroupFollowUpQuestion(text: string) {
  const normalized = cleanQqGroupAssistantText(text);
  if (Array.from(normalized).length < 2) return false;
  if (ACKNOWLEDGEMENT_PATTERN.test(normalized)) return false;
  return QUESTION_MARK_PATTERN.test(normalized)
    || QUESTION_ENDING_PATTERN.test(normalized)
    || INTERROGATIVE_PATTERN.test(normalized)
    || REQUEST_PATTERN.test(normalized);
}

/** Drops media placeholders and CQ codes so only what the member typed remains. */
export function cleanQqGroupAssistantText(text: string) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^\r\n)]*\)/gu, " ")
    .replace(/\[(?:图片|视频|语音|合并转发|分享卡片)\]/gu, " ")
    .replace(/\[CQ:[^\]]+\]/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export type QqGroupQuotedMessage = {
  messageId: string;
  fromBot: boolean;
  senderName: string;
  text: string;
};

/** Puts the quoted message in front of the question so the model sees what "这个" refers to. */
export function buildQqGroupAssistantQuestion(question: string, quoted?: QqGroupQuotedMessage | null) {
  const asked = String(question || "").trim();
  const quotedText = String(quoted?.text || "").trim().slice(0, QUOTED_CONTEXT_MAX_CHARS);
  if (!quoted || !quotedText) return asked;
  const source = quoted.fromBot
    ? "你之前的回复"
    : `群友${quoted.senderName ? `「${quoted.senderName}」` : ""}的消息`;
  return [
    `【引用${source}】`,
    quotedText,
    "",
    asked ? `【提问】${asked}` : "【提问】请针对这条引用消息作答：如果它是问题就直接回答，否则简要解释。",
  ].join("\n");
}

function stripCallSeparator(value: string) {
  return String(value || "").replace(CALL_SEPARATOR_PATTERN, "").trim();
}

// In-process conversation state. Like the assistant history and batches it is
// best effort: a restart only forgets who was mid-conversation.

const sessions = new Map<string, { kind: QqGroupAssistantSessionKind; expiresAt: number }>();
const answerTimes = new Map<string, number[]>();
const proactiveCooldowns = new Map<string, number>();
const assistantReplies = new Map<string, { groupId: string; answer: string; at: number }>();

function sessionKey(groupId: string, qqId: string) {
  return `${groupId}::${qqId}`;
}

export function openQqGroupAssistantSession(
  groupId: string,
  qqId: string,
  kind: QqGroupAssistantSessionKind,
  now = Date.now(),
) {
  const key = sessionKey(groupId, qqId);
  sessions.delete(key);
  sessions.set(key, {
    kind,
    expiresAt: now + (kind === "summoned" ? QQBOT_GROUP_SUMMON_WINDOW_MS : QQBOT_GROUP_FOLLOW_UP_WINDOW_MS),
  });
  // Re-inserting keeps the map in last-touched order, so the oldest go first.
  while (sessions.size > SESSION_MAX_ENTRIES) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function readQqGroupAssistantSession(groupId: string, qqId: string, now = Date.now()) {
  const key = sessionKey(groupId, qqId);
  const entry = sessions.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    sessions.delete(key);
    return null;
  }
  return entry.kind;
}

export function closeQqGroupAssistantSession(groupId: string, qqId: string) {
  sessions.delete(sessionKey(groupId, qqId));
}

export function recordQqGroupAssistantAnswer(groupId: string, qqId: string, now = Date.now()) {
  const key = sessionKey(groupId, qqId);
  const recent = (answerTimes.get(key) || []).filter((at) => now - at < QQBOT_GROUP_IMPLICIT_TURN_WINDOW_MS);
  answerTimes.delete(key);
  answerTimes.set(key, [...recent, now]);
  while (answerTimes.size > SESSION_MAX_ENTRIES) {
    const oldest = answerTimes.keys().next().value;
    if (oldest === undefined) break;
    answerTimes.delete(oldest);
  }
}

export function countRecentQqGroupAssistantAnswers(groupId: string, qqId: string, now = Date.now()) {
  return (answerTimes.get(sessionKey(groupId, qqId)) || [])
    .filter((at) => now - at < QQBOT_GROUP_IMPLICIT_TURN_WINDOW_MS)
    .length;
}

export function markQqGroupProactiveReply(groupId: string, now = Date.now()) {
  proactiveCooldowns.set(groupId, now + QQBOT_GROUP_PROACTIVE_COOLDOWN_MS);
}

export function isQqGroupProactiveCoolingDown(groupId: string, now = Date.now()) {
  const until = proactiveCooldowns.get(groupId);
  if (until === undefined) return false;
  if (until > now) return true;
  proactiveCooldowns.delete(groupId);
  return false;
}

/** Remembers what an answer said, so a quote of its rendered image can be resolved back to text. */
export function rememberQqGroupAssistantReply(messageId: string, groupId: string, answer: string, now = Date.now()) {
  const id = String(messageId || "").trim();
  if (!id) return;
  assistantReplies.delete(id);
  assistantReplies.set(id, { groupId, answer: String(answer || "").trim(), at: now });
  while (assistantReplies.size > ASSISTANT_REPLY_MAX_ENTRIES) {
    const oldest = assistantReplies.keys().next().value;
    if (oldest === undefined) break;
    assistantReplies.delete(oldest);
  }
}

export function lookupQqGroupAssistantReply(messageId: string, groupId: string, now = Date.now()) {
  const id = String(messageId || "").trim();
  const entry = id ? assistantReplies.get(id) : undefined;
  if (!entry) return null;
  if (now - entry.at > ASSISTANT_REPLY_TTL_MS) {
    assistantReplies.delete(id);
    return null;
  }
  return entry.groupId === groupId ? entry.answer : null;
}

export function resetQqGroupAssistantState() {
  sessions.clear();
  answerTimes.clear();
  proactiveCooldowns.clear();
  assistantReplies.clear();
}
