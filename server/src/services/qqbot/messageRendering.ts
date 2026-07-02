import { callQqBotAction } from "./connection";
import { queueQqBotForwardDebug } from "./forwardDebug";
import { renderQqVideoBlock, resolveQqImageUrl, resolveQqVideoUrl } from "./messageMedia";
import {
  escapeShareCardHtml,
  parseCqParams,
  parseJsonShareCard,
  parseMusicSegmentCard,
  parseShareSegmentCard,
  parseXmlShareCard,
  renderShareCardBlock,
} from "./shareCards";

export type ParsedForwardPayload = {
  summary: string;
  content: string;
  sourceMessageId?: string;
  messageCount: number;
  blockCount: number;
  participantCount: number;
  imageCount: number;
};

type ParsedForwardEntry = {
  nickname: string;
  text: string;
  messageCount: number;
  imageCount: number;
};

export type ForwardSource = "direct-forward" | "reply-forward" | "reply-message";

export type QqMessageExtractOptions = {
  forwardDepth?: number;
  imageMode?: "upload" | "placeholder";
  videoMode?: "upload" | "placeholder";
  forwardMode?: "expand" | "placeholder";
};

const QQBOT_MESSAGE_SOFT_LIMIT = 720;
function debugMessagePreview(value: string, limit = 240) {
  const normalized = normalizeRenderedMessage(value).replace(/\n+/g, " ");
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

const MAX_FORWARD_DEPTH = 4;
export const QQBOT_POST_SUBMIT_PENDING_MESSAGE = [
  "已收到投稿确认，开始为你投递",
  "长消息、多图、多视频时速度会比较慢",
  "投递完成后，我会再给你发送反馈",
].join("\n");

export async function extractMessageText(
  message: unknown,
  options: QqMessageExtractOptions = {},
): Promise<string> {
  if (typeof message === "string") return cleanCqMessage(message, options);
  if (message && typeof message === "object") {
    const maybeMessage = message as any;
    if (maybeMessage.type === "node") {
      if (options.forwardMode === "placeholder") return "[合并转发]";
      const embedded = await renderEmbeddedNodeSegmentContent(
        maybeMessage.data?.content ?? maybeMessage.data?.message,
        options,
      );
      if (embedded) return normalizeRenderedMessage(embedded);
      if (maybeMessage.data?.id) return normalizeRenderedMessage(await resolveReferencedNodeContent(maybeMessage.data.id, options));
      if (Array.isArray(maybeMessage.data?.content)) return extractMessageText(maybeMessage.data.content, options);
      if (typeof maybeMessage.data?.content === "string") return cleanCqMessage(maybeMessage.data.content, options);
    }
    if (maybeMessage.type === "forward") {
      if (options.forwardMode === "placeholder") return "[合并转发]";
      const embedded = await renderEmbeddedForwardSegmentContent(
        maybeMessage.data?.content ?? maybeMessage.data?.message,
        options,
      );
      if (embedded) return normalizeRenderedMessage(embedded);
      const forwardId = readForwardSegmentId(maybeMessage.data);
      if (forwardId) {
        return normalizeRenderedMessage(await renderNestedForwardContent(forwardId, {
          ...options,
          forwardDepth: (options.forwardDepth ?? 0) + 1,
        }));
      }
    }
    if (["image", "video", "record", "json", "xml", "share", "music"].includes(String(maybeMessage.type || "").trim())) {
      const rendered = await renderMessageSegment(maybeMessage, options);
      if (rendered) return normalizeRenderedMessage(rendered);
    }
    if (Array.isArray(maybeMessage.message)) return extractMessageText(maybeMessage.message, options);
    if (Array.isArray(maybeMessage.content)) return extractMessageText(maybeMessage.content, options);
    if (typeof maybeMessage.message === "string") return cleanCqMessage(maybeMessage.message, options);
    if (typeof maybeMessage.content === "string") return cleanCqMessage(maybeMessage.content, options);
  }
  if (!Array.isArray(message)) return "";
  const parts: string[] = [];
  for (const seg of message) {
    const rendered = await renderMessageSegment(seg, options);
    if (rendered) parts.push(rendered);
  }
  return normalizeRenderedMessage(parts.join(""));
}

function readForwardSegmentId(data: any) {
  return String(data?.id || data?.resid || data?.forward_id || data?.message_id || "").trim();
}

function looksLikeForwardMessageList(value: unknown): value is any[] {
  if (!Array.isArray(value) || !value.length) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const type = String((item as any).type || "").trim();
    if (type && type !== "node") return false;
    const node = (item as any).data ?? item;
    return Boolean(
      type === "node"
      || node?.sender
      || node?.nickname
      || node?.user_id
      || node?.message_type
      || node?.content !== undefined
      || node?.message !== undefined,
    );
  });
}

function pickEmbeddedForwardMessages(value: unknown): unknown[] | null {
  if (looksLikeForwardMessageList(value)) return value;
  if (!value || typeof value !== "object") return null;
  const maybeValue = value as any;
  if (looksLikeForwardMessageList(maybeValue.messages)) return maybeValue.messages;
  if (looksLikeForwardMessageList(maybeValue.data?.messages)) return maybeValue.data.messages;
  if (looksLikeForwardMessageList(maybeValue.content)) return maybeValue.content;
  if (looksLikeForwardMessageList(maybeValue.data?.content)) return maybeValue.data.content;
  return null;
}

async function renderEmbeddedForwardLikeContent(
  content: unknown,
  options: QqMessageExtractOptions & { withForwardTitle: boolean },
) {
  if (content == null) return "";
  const nestedOptions = {
    ...options,
    forwardDepth: (options.forwardDepth ?? 0) + 1,
  };
  const embeddedMessages = pickEmbeddedForwardMessages(content);
  if (embeddedMessages) {
    const parsed = await parseForwardMessages(embeddedMessages, "", nestedOptions);
    if (parsed?.content) return `\n${parsed.content}\n`;
  }
  const nested = await extractMessageText(content, nestedOptions).catch(() => "");
  if (!nested.trim()) return "";
  return `\n${nested}\n`;
}

async function renderEmbeddedNodeSegmentContent(content: unknown, options: QqMessageExtractOptions) {
  return renderEmbeddedForwardLikeContent(content, { ...options, withForwardTitle: false });
}

async function renderEmbeddedForwardSegmentContent(content: unknown, options: QqMessageExtractOptions) {
  return renderEmbeddedForwardLikeContent(content, { ...options, withForwardTitle: true });
}

async function renderMessageSegment(seg: any, options: QqMessageExtractOptions): Promise<string> {
  if (seg?.type === "text") return String(seg.data?.text || "");
  if (seg?.type === "image") {
    if (options.imageMode === "placeholder") return "\n[图片]\n";
    const url = await resolveQqImageUrl(seg.data?.url, seg.data?.file);
    return url ? `\n![QQ图片](${url})\n` : "\n[图片]\n";
  }
  if (seg?.type === "video") {
    if (options.videoMode === "placeholder") return "\n[视频]\n";
    const media = await resolveQqVideoUrl(
      seg.data?.url ?? seg.data?.src,
      seg.data?.file ?? seg.data?.file_id ?? seg.data?.path,
    );
    return media?.url ? `\n${renderQqVideoBlock(media.url, media.posterUrl)}\n` : "\n[视频]\n";
  }
  if (seg?.type === "share") {
    return renderShareCardBlock(parseShareSegmentCard(seg.data));
  }
  if (seg?.type === "music") {
    return renderShareCardBlock(parseMusicSegmentCard(seg.data));
  }
  if (seg?.type === "json") {
    return renderShareCardBlock(parseJsonShareCard(seg.data?.data ?? seg.data));
  }
  if (seg?.type === "xml") {
    return renderShareCardBlock(parseXmlShareCard(seg.data?.data ?? seg.data));
  }
  if (seg?.type === "node") {
    if (options.forwardMode === "placeholder") return "\n[合并转发]\n";
    const embedded = await renderEmbeddedNodeSegmentContent(seg.data?.content ?? seg.data?.message, options);
    if (embedded) return embedded;
    if (seg?.data?.id) return resolveReferencedNodeContent(seg.data.id, options);
  }
  if (seg?.type === "forward") {
    if (options.forwardMode === "placeholder") return "\n[合并转发]\n";
    const embedded = await renderEmbeddedForwardSegmentContent(seg.data?.content ?? seg.data?.message, options);
    if (embedded) return embedded;
    return renderNestedForwardContent(readForwardSegmentId(seg.data), {
      ...options,
      forwardDepth: (options.forwardDepth ?? 0) + 1,
    });
  }
  if (seg?.type === "record") return "\n[语音]\n";
  return "";
}

export async function extractForwardPayload(
  message: unknown,
  options: QqMessageExtractOptions = {},
): Promise<(ParsedForwardPayload & { source: ForwardSource }) | null> {
  const forwardId = extractForwardNodeId(message);
  if (forwardId) {
    const payload = await callQqBotAction("get_forward_msg", { id: forwardId }).catch(() => null);
    const parsed = await parseForwardMessages(payload?.data?.messages, forwardId, options);
    if (parsed) {
      queueQqBotForwardDebug("forward.extract", {
        source: "direct-forward",
        forwardId,
        summary: parsed.summary,
        preview: debugMessagePreview(parsed.content),
      });
      return { ...parsed, source: "direct-forward" };
    }
  }
  const replyId = extractReplyMessageId(message);
  if (!replyId) return null;
  const replied = await callQqBotAction("get_msg", { message_id: Number(replyId) || replyId }).catch(() => null);
  const replyMessage = replied?.data?.message ?? replied?.data?.content;
  const replyForwardId = extractForwardNodeId(replyMessage);
  if (replyForwardId) {
    const payload = await callQqBotAction("get_forward_msg", { id: replyForwardId }).catch(() => null);
    const parsed = await parseForwardMessages(payload?.data?.messages, replyForwardId, options);
    if (parsed) {
      queueQqBotForwardDebug("forward.extract", {
        source: "reply-forward",
        replyId,
        forwardId: replyForwardId,
        summary: parsed.summary,
        preview: debugMessagePreview(parsed.content),
      });
      return { ...parsed, source: "reply-forward" };
    }
  }
  const replyContent = (await extractMessageText(replyMessage, options).catch(() => "")).trim();
  if (!replyContent) return null;
  const imageCount = countForwardImageTokens(replyContent);
  const summary = buildReplyMessageSummary(replyContent, imageCount);
  queueQqBotForwardDebug("forward.extract", {
    source: "reply-message",
    replyId,
    summary,
    preview: debugMessagePreview(replyContent),
    message: replyMessage,
  });
  return {
    source: "reply-message",
    summary,
    content: replyContent,
    sourceMessageId: replyId,
    messageCount: 1,
    blockCount: 1,
    participantCount: 1,
    imageCount,
  };
}

async function parseForwardMessages(
  messages: unknown,
  forwardId: string,
  options: QqMessageExtractOptions = {},
): Promise<ParsedForwardPayload | null> {
  const list = Array.isArray(messages) ? messages : [];
  const entries: ParsedForwardEntry[] = [];
  const forwardDepth = options.forwardDepth ?? 0;
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const node = item?.data ?? item;
    const nickname = String(
      node?.sender?.nickname
      || node?.sender?.card
      || node?.nickname
      || node?.user_id
      || item?.sender?.nickname
      || item?.sender?.user_id
      || "QQ用户",
    );
    const text = (await extractMessageText(
      node?.content
      ?? node?.message
      ?? item?.content
      ?? item?.message
      ?? "",
      options,
    )).trim();
    if (!text) continue;
    entries.push({
      nickname,
      text,
      messageCount: 1,
      imageCount: countForwardImageTokens(text),
    });
  }
  const mergedEntries = mergeForwardEntries(entries);
  if (!mergedEntries.length) {
    queueQqBotForwardDebug("forward.parse.empty", {
      forwardId,
      forwardDepth,
      itemCount: list.length,
      messages: list,
    });
    return null;
  }
  const messageCount = entries.reduce((total, entry) => total + entry.messageCount, 0);
  const imageCount = entries.reduce((total, entry) => total + entry.imageCount, 0);
  const participantNames = Array.from(new Set(mergedEntries.map((entry) => entry.nickname).filter(Boolean)));
  const parsed = {
    summary: buildForwardPayloadSummary(mergedEntries, {
      messageCount,
      blockCount: mergedEntries.length,
      participantCount: participantNames.length,
      imageCount,
    }),
    content: renderForwardPayloadContent(
      mergedEntries,
      {
        messageCount,
        blockCount: mergedEntries.length,
        participantCount: participantNames.length,
        imageCount,
        participantNames,
      },
      forwardDepth,
    ),
    sourceMessageId: forwardId,
    messageCount,
    blockCount: mergedEntries.length,
    participantCount: participantNames.length,
    imageCount,
  };
  queueQqBotForwardDebug("forward.parse.ok", {
    forwardId,
    forwardDepth,
    itemCount: list.length,
    summary: parsed.summary,
    preview: debugMessagePreview(parsed.content),
    messages: list,
  });
  return parsed;
}

export function extractReplyMessageId(message: unknown) {
  if (!Array.isArray(message)) return "";
  const replySeg = message.find((seg: any) => seg?.type === "reply" && seg?.data?.id);
  return String(replySeg?.data?.id || "").trim();
}

export function shouldUseLightForwardExtraction(message: unknown) {
  if (!Array.isArray(message)) return false;
  return message.some((seg: any) => {
    const type = String(seg?.type || "").trim();
    return type === "forward" || type === "node" || type === "reply";
  });
}

export function extractForwardNodeId(message: unknown): string {
  if (!message) return "";
  if (Array.isArray(message)) {
    for (const seg of message) {
      const nested = extractForwardNodeId(seg);
      if (nested) return nested;
    }
    return "";
  }
  if (typeof message === "string") {
    const match = message.match(/\[CQ:(?:forward|node),[^\]]*(?:id|resid|forward_id|message_id)=([^,\]]+)/i);
    return String(match?.[1] || "").trim();
  }
  if (typeof message === "object") {
    const item = message as any;
    if ((item?.type === "forward" || item?.type === "node") && item?.data) {
      const id = item.data.id || item.data.resid || item.data.forward_id || item.data.message_id;
      if (id) return String(id).trim();
      if (item.data.content) return extractForwardNodeId(item.data.content);
      if (item.data.message) return extractForwardNodeId(item.data.message);
    }
    if (item?.content) return extractForwardNodeId(item.content);
    if (item?.message) return extractForwardNodeId(item.message);
    if (item?.data?.content) return extractForwardNodeId(item.data.content);
    if (item?.data?.message) return extractForwardNodeId(item.data.message);
  }
  return "";
}

async function cleanCqMessage(value: string, options: QqMessageExtractOptions = {}) {
  let normalized = String(value || "");
  const mediaMatches = Array.from(normalized.matchAll(/\[CQ:(image|video|forward|node|json|xml|share|music),([^\]]*)\]/g));
  for (const match of mediaMatches) {
    const raw = match[0];
    const type = String(match[1] || "").trim();
    const rawParams = String(match[2] || "");
    if (type === "json") {
      const rendered = renderShareCardBlock(parseJsonShareCard(rawParams.replace(/^data=/, "").trim()));
      normalized = normalized.replace(raw, rendered || "\n[分享卡片]\n");
      continue;
    }
    if (type === "xml") {
      const rendered = renderShareCardBlock(parseXmlShareCard(rawParams.replace(/^data=/, "").trim()));
      normalized = normalized.replace(raw, rendered || "\n[分享卡片]\n");
      continue;
    }
    const attrs = parseCqParams(rawParams);
    if (type === "image") {
      if (options.imageMode === "placeholder") {
        normalized = normalized.replace(raw, "\n[图片]\n");
        continue;
      }
      const url = await resolveQqImageUrl(attrs.url, attrs.file);
      normalized = normalized.replace(raw, url ? `\n![QQ图片](${url})\n` : "\n[图片]\n");
      continue;
    }
    if (type === "video") {
      if (options.videoMode === "placeholder") {
        normalized = normalized.replace(raw, "\n[视频]\n");
        continue;
      }
      const media = await resolveQqVideoUrl(
        attrs.url || attrs.src,
        attrs.file || attrs.file_id || attrs.path,
      );
      normalized = normalized.replace(raw, media?.url ? `\n${renderQqVideoBlock(media.url, media.posterUrl)}\n` : "\n[视频]\n");
      continue;
    }
    if (type === "share") {
      normalized = normalized.replace(raw, renderShareCardBlock(parseShareSegmentCard(attrs)) || "\n[分享卡片]\n");
      continue;
    }
    if (type === "music") {
      normalized = normalized.replace(raw, renderShareCardBlock(parseMusicSegmentCard(attrs)) || "\n[分享卡片]\n");
      continue;
    }
    if (options.forwardMode === "placeholder") {
      normalized = normalized.replace(raw, "\n[合并转发]\n");
      continue;
    }
    const forwardId = attrs.id || attrs.resid || attrs.file || attrs.message_id || attrs.forward_id;
    const expanded = await renderNestedForwardContent(forwardId, {
      ...options,
      forwardDepth: (options.forwardDepth ?? 0) + 1,
    });
    normalized = normalized.replace(raw, expanded || "\n[合并转发]\n");
  }
  normalized = normalized
    .replace(/\[CQ:at,[^\]]+\]/g, "")
    .replace(/\[CQ:video[^\]]*\]/g, "\n[视频]\n")
    .replace(/\[CQ:record[^\]]*\]/g, "\n[语音]\n")
    .replace(/\[CQ:[^\]]+\]/g, "");
  return normalizeRenderedMessage(normalized);
}

async function renderNestedForwardContent(forwardId: unknown, options: QqMessageExtractOptions = {}) {
  const normalizedId = String(forwardId || "").trim();
  const forwardDepth = options.forwardDepth ?? 0;
  if (!normalizedId) return "\n[合并转发]\n";
  if (forwardDepth > MAX_FORWARD_DEPTH) return "\n[合并转发层级过深]\n";
  const payload = await callQqBotAction("get_forward_msg", { id: normalizedId }).catch(() => null);
  const parsed = await parseForwardMessages(payload?.data?.messages, normalizedId, options);
  queueQqBotForwardDebug("forward.api.get_forward_msg", {
    forwardId: normalizedId,
    forwardDepth,
    payload: payload?.data?.messages ?? null,
    parsed: parsed
      ? { summary: parsed.summary, preview: debugMessagePreview(parsed.content) }
      : null,
  });
  if (!parsed?.content) return "\n[合并转发]\n";
  return `\n${parsed.content}\n`;
}

async function resolveReferencedNodeContent(messageId: unknown, options: QqMessageExtractOptions = {}) {
  const normalizedId = String(messageId || "").trim();
  const forwardDepth = options.forwardDepth ?? 0;
  if (!normalizedId) return "\n[合并转发]\n";
  const referenced = await callQqBotAction("get_msg", { message_id: Number(normalizedId) || normalizedId }).catch(() => null);
  const message = referenced?.data?.message ?? referenced?.data?.content;
  const forwardId = extractForwardNodeId(message);
  if (forwardId) {
    queueQqBotForwardDebug("forward.node.refers-forward", {
      messageId: normalizedId,
      forwardDepth,
      forwardId,
      message,
    });
    return renderNestedForwardContent(forwardId, {
      ...options,
      forwardDepth: forwardDepth + 1,
    });
  }
  const text = await extractMessageText(message, options).catch(() => "");
  queueQqBotForwardDebug("forward.node.resolve", {
    messageId: normalizedId,
    forwardDepth,
    preview: debugMessagePreview(text),
    message,
  });
  return text.trim() ? `\n${quoteMarkdownBlock(text)}\n` : "\n[合并转发]\n";
}

function mergeForwardEntries(entries: ParsedForwardEntry[]) {
  const merged: ParsedForwardEntry[] = [];
  for (const entry of entries) {
    const normalizedText = normalizeRenderedMessage(entry.text);
    if (!normalizedText) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.nickname === entry.nickname) {
      previous.text = normalizeRenderedMessage(`${previous.text}\n\n${normalizedText}`);
      previous.messageCount += entry.messageCount;
      previous.imageCount += entry.imageCount;
      continue;
    }
    merged.push({
      nickname: entry.nickname,
      text: normalizedText,
      messageCount: entry.messageCount,
      imageCount: entry.imageCount,
    });
  }
  return merged;
}

function countForwardImageTokens(text: string) {
  return (String(text || "").match(/!\[[^\]]*\]\([^)]+\)|\[图片\]/g) || []).length;
}

function buildForwardPayloadSummary(
  entries: ParsedForwardEntry[],
  stats: { messageCount: number; blockCount: number; participantCount: number; imageCount: number },
) {
  const statBits = [
    `${stats.messageCount} 条消息`,
    `${stats.blockCount} 段整理稿`,
    `${stats.participantCount} 人参与`,
  ];
  if (stats.imageCount > 0) statBits.push(`${stats.imageCount} 张图`);
  const previewBits = entries
    .slice(0, 3)
    .map((entry) => `${entry.nickname}：${forwardSummaryPreview(entry.text)}`);
  return [statBits.join("，"), previewBits.join(" / ")].filter(Boolean).join(" · ").slice(0, 160);
}

function buildReplyMessageSummary(content: string, imageCount: number) {
  const statBits = ["1 条消息"];
  if (imageCount > 0) statBits.push(`${imageCount} 张图`);
  return [statBits.join("，"), forwardSummaryPreview(content)].filter(Boolean).join(" · ").slice(0, 160);
}

function renderForwardPayloadContent(
  entries: ParsedForwardEntry[],
  stats: {
    messageCount: number;
    blockCount: number;
    participantCount: number;
    imageCount: number;
    participantNames: string[];
  },
  forwardDepth: number,
) {
  const flattenedNestedCard = unwrapSingleNestedForwardCard(entries, forwardDepth);
  if (flattenedNestedCard) {
    return normalizeRenderedMessage(["", flattenedNestedCard, ""].join("\n"));
  }
  const entryHtml = entries.map((entry) => renderForwardEntryBlock(entry)).filter(Boolean).join("");
  const badgeText = forwardDepth > 0 ? "转发内容" : "合并转发";
  return normalizeRenderedMessage([
    "",
    `<div class="qq-forward-card" data-forward-depth="${Math.min(forwardDepth, 4)}">`,
    `  <div class="qq-forward-card__head">`,
    `    <span class="qq-forward-card__badge">${badgeText}</span>`,
    `  </div>`,
    `  <div class="qq-forward-card__body">`,
    entryHtml,
    `  </div>`,
    `</div>`,
    "",
  ].filter(Boolean).join("\n"));
}

function unwrapSingleNestedForwardCard(entries: ParsedForwardEntry[], forwardDepth: number) {
  if (entries.length !== 1) return "";
  const onlyContent = normalizeRenderedMessage(entries[0]?.text || "");
  if (!onlyContent) return "";

  const directCardMatch = onlyContent.match(/^(<div class="qq-forward-card"[\s\S]*<\/div>)$/);
  const nestedCardMatch = onlyContent.match(
    /^<div class="qq-forward-nest">\s*(?:<div class="qq-forward-nest__label">转发内容<\/div>\s*)?(<div class="qq-forward-card"[\s\S]*<\/div>)\s*<\/div>$/,
  );
  const card = nestedCardMatch?.[1] || directCardMatch?.[1] || "";
  if (!card) return "";
  if (forwardDepth > 0) return card;
  return promoteNestedForwardCardToRoot(card);
}

function promoteNestedForwardCardToRoot(content: string) {
  let promoted = String(content || "");
  promoted = promoted.replace(/data-forward-depth="([1-4])"/, 'data-forward-depth="0"');
  promoted = promoted.replace(/<span class="qq-forward-card__badge">转发内容<\/span>/, '<span class="qq-forward-card__badge">合并转发</span>');
  return promoted;
}

function renderForwardEntryBlock(entry: ParsedForwardEntry) {
  const content = normalizeRenderedMessage(entry.text);
  if (!content) return "";
  const nickname = String(entry.nickname || "").trim();
  return [
    `<article class="qq-forward-entry">`,
    nickname ? `  <div class="qq-forward-entry__head"><span class="qq-forward-entry__name">${escapeShareCardHtml(nickname)}</span></div>` : "",
    `  <div class="qq-forward-entry__content">`,
    renderForwardEntryContent(content),
    `  </div>`,
    `</article>`,
  ].join("\n");
}

function renderForwardEntryContent(content: string) {
  const blocks = normalizeRenderedMessage(content).split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const html: string[] = [];
  let pendingImages: Array<{ url: string; alt: string }> = [];

  const flushImages = () => {
    if (!pendingImages.length) return;
    if (pendingImages.length === 1) {
      const image = pendingImages[0];
      html.push(renderForwardImageBlock(image));
    } else {
      html.push(renderForwardAlbumBlock(pendingImages));
    }
    pendingImages = [];
  };

  for (const block of blocks) {
    const image = parseStandaloneMarkdownImage(block);
    if (image) {
      pendingImages.push(image);
      continue;
    }
    flushImages();
    if (isTrustedForwardHtmlBlock(block)) {
      if (String(block).trim().startsWith("<div class=\"qq-forward-card")) {
        html.push([
          `<div class="qq-forward-nest">`,
          block,
          `</div>`,
        ].join("\n"));
      } else {
        html.push(block);
      }
      continue;
    }
    if (block === "[图片]") {
      html.push(`<p class="qq-forward-placeholder">图片</p>`);
      continue;
    }
    html.push(`<p>${escapeShareCardHtml(block).replace(/\n/g, "<br>")}</p>`);
  }
  flushImages();
  return html.join("\n");
}

function parseStandaloneMarkdownImage(block: string) {
  const match = String(block || "").trim().match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
  if (!match) return null;
  return {
    alt: String(match[1] || "QQ图片").trim() || "QQ图片",
    url: String(match[2] || "").trim(),
  };
}

function renderForwardImageBlock(image: { url: string; alt: string }) {
  return `<p><img src="${escapeShareCardHtml(image.url)}" alt="${escapeShareCardHtml(image.alt)}" data-size="small" /></p>`;
}

function renderForwardAlbumBlock(images: Array<{ url: string; alt: string }>) {
  const items = images
    .map((image) => `<img src="${escapeShareCardHtml(image.url)}" alt="${escapeShareCardHtml(image.alt)}" data-size="album" />`)
    .join("");
  return `<p class="qq-forward-album" data-image-album="1">${items}</p>`;
}

function isTrustedForwardHtmlBlock(block: string) {
  const normalized = String(block || "").trim();
  return normalized.startsWith("<div class=\"qq-share-card")
    || normalized.startsWith("<div class=\"qq-forward-card")
    || normalized.startsWith("<div class=\"qq-video-card")
    || normalized.startsWith("<p class=\"qq-forward-album")
    || normalized.startsWith("<p><img ");
}

function forwardSummaryPreview(text: string) {
  return normalizeRenderedMessage(
    text
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "[图片]")
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^\s*> ?/gm, "")
      .replace(/^\s*-{3,}\s*$/gm, "")
      .replace(/[*_]+/g, ""),
  ).replace(/\n+/g, " ").slice(0, 40) || "内容";
}

function quoteMarkdownBlock(content: string) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function normalizeRenderedMessage(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitQqMessageForDelivery(value: string, limit = QQBOT_MESSAGE_SOFT_LIMIT) {
  const normalized = normalizeRenderedMessage(value);
  if (!normalized) return [];
  if (normalized.length <= limit) return [normalized];
  const chunks: string[] = [];
  const blocks = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const pushChunk = (raw: string) => {
    const chunk = normalizeRenderedMessage(raw);
    if (!chunk) return;
    if (chunk.length <= limit) {
      chunks.push(chunk);
      return;
    }
    const lines = chunk.split(/\n/).map((item) => item.trimEnd()).filter(Boolean);
    if (lines.length > 1) {
      let lineBuffer = "";
      for (const line of lines) {
        const next = lineBuffer ? `${lineBuffer}\n${line}` : line;
        if (next.length <= limit) {
          lineBuffer = next;
          continue;
        }
        if (lineBuffer) chunks.push(lineBuffer);
        lineBuffer = "";
        if (line.length <= limit) {
          lineBuffer = line;
          continue;
        }
        const sentences = line.split(/(?<=[。！？；.!?;])\s*/).map((item) => item.trim()).filter(Boolean);
        let sentenceBuffer = "";
        for (const sentence of sentences) {
          const nextSentence = sentenceBuffer ? `${sentenceBuffer}${sentence}` : sentence;
          if (nextSentence.length <= limit) {
            sentenceBuffer = nextSentence;
            continue;
          }
          if (sentenceBuffer) chunks.push(sentenceBuffer);
          sentenceBuffer = "";
          if (sentence.length <= limit) {
            sentenceBuffer = sentence;
            continue;
          }
          for (let index = 0; index < sentence.length; index += limit) {
            chunks.push(sentence.slice(index, index + limit));
          }
        }
        if (sentenceBuffer) lineBuffer = sentenceBuffer;
      }
      if (lineBuffer) chunks.push(lineBuffer);
      return;
    }
    for (let index = 0; index < chunk.length; index += limit) {
      chunks.push(chunk.slice(index, index + limit));
    }
  };
  let buffer = "";
  for (const block of blocks) {
    const next = buffer ? `${buffer}\n\n${block}` : block;
    if (next.length <= limit) {
      buffer = next;
      continue;
    }
    if (buffer) pushChunk(buffer);
    buffer = "";
    if (block.length <= limit) {
      buffer = block;
      continue;
    }
    pushChunk(block);
  }
  if (buffer) pushChunk(buffer);
  return chunks.length ? chunks : [normalized];
}

export function appendSourceFooter(content: string, context: { groupId?: string }) {
  const source = context.groupId ? `QQ群 ${context.groupId}` : "QQ 私聊";
  return `${content}\n\n> 转自 QQBot（${source}）。`;
}

