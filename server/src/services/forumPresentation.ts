import { buildUserPreview } from "../utils/publicUser";
import { renderModeratedContent, summarizeForumImageModerationForContent } from "./imageModeration";
import { isGlobalPinnedTopic } from "./siteSettings";
import { renderModeratedVideoContent, summarizeForumVideoModerationForContent } from "./videoModeration";

type Viewer = {
  userId?: number | null;
  role?: string | null;
} | null | undefined;

type TopicContact = {
  type: string;
  label: string;
  value: string;
};

function safeJson(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function defaultContactLabel(type: string) {
  if (type === "phone") return "手机";
  if (type === "wechat") return "微信";
  if (type === "qq") return "QQ";
  if (type === "email") return "邮箱";
  return "联系方式";
}

function normalizeContactValue(type: string, input: unknown) {
  let value = String(input ?? "").trim();
  if (!value) return "";
  if (type === "phone") {
    value = value.replace(/[^\d]/g, "");
    if (!/^1[3-9]\d{9}$/.test(value)) return "";
    return value;
  }
  if (type === "qq") {
    value = value.replace(/[^\d]/g, "");
    if (!/^[1-9]\d{4,11}$/.test(value)) return "";
    return value;
  }
  if (type === "email") {
    value = value.toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return "";
    return value.slice(0, 80);
  }
  return value.slice(0, 40);
}

function stripMarkdownForContactRecognition(input: unknown) {
  return String(input ?? "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/[#>*_~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pushTopicContact(list: TopicContact[], seen: Set<string>, type: string, value: unknown, label = defaultContactLabel(type)) {
  const normalizedValue = normalizeContactValue(type, value);
  if (!normalizedValue) return;
  const normalizedType = String(type || "other").trim().toLowerCase() || "other";
  const key = `${normalizedType}:${normalizedValue.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push({
    type: normalizedType,
    label: String(label || defaultContactLabel(normalizedType)).trim() || defaultContactLabel(normalizedType),
    value: normalizedValue,
  });
}

function normalizeTopicContacts(raw: unknown) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim()
      ? [{ type: "other", label: "联系方式", value: raw.trim() }]
      : [];
  const normalized: TopicContact[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item) continue;
    if (typeof item === "string") {
      pushTopicContact(normalized, seen, "other", item, "联系方式");
      continue;
    }
    const type = String((item as any).type || "other").trim().toLowerCase() || "other";
    const label = String((item as any).label || defaultContactLabel(type)).trim() || defaultContactLabel(type);
    pushTopicContact(normalized, seen, type, (item as any).value, label);
  }
  return normalized;
}

function deriveWeiwallTopicContacts(topic: any) {
  const text = [
    stripMarkdownForContactRecognition(topic?.metadata?.originalTitle),
    stripMarkdownForContactRecognition(topic?.title),
    stripMarkdownForContactRecognition(topic?.content),
  ].filter(Boolean).join(" ");
  if (!text) return [] as TopicContact[];

  const contacts: TopicContact[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(/(?:^|[^a-z0-9_-])(?:微信|vx|wx|微.?信|薇信|v信)(?:号)?\s*[:：]?\s*([a-z][a-z0-9_-]{4,19}|1[3-9]\d[\d -]{8,11})/gi)) {
    pushTopicContact(contacts, seen, "wechat", match[1], "微信");
  }
  for (const match of text.matchAll(/(?:加|联系)\s*v\s*[:：]?\s*([a-z][a-z0-9_-]{4,19}|1[3-9]\d[\d -]{8,11})/gi)) {
    pushTopicContact(contacts, seen, "wechat", match[1], "微信");
  }
  for (const match of text.matchAll(/(?:^|[^a-z0-9_-])(?:qq|QQ|Qq|qQ)(?:号)?\s*[:：]?\s*([1-9]\d{4,11})(?!\d)/g)) {
    pushTopicContact(contacts, seen, "qq", match[1], "QQ");
  }
  for (const match of text.matchAll(/(?:邮箱|email|mail)(?:地址)?\s*[:：]?\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)) {
    pushTopicContact(contacts, seen, "email", match[1], "邮箱");
  }

  const hasContactCue = /联系方式|联系(?:方式|我)?|加我|咨询|私聊|电话|手机|手机号|同号|微信|邮箱|\b(?:vx|wx|qq|email|mail)\b/i.test(text);
  if (hasContactCue) {
    for (const match of text.matchAll(/1[3-9]\d[\d -]{8,11}/g)) {
      pushTopicContact(contacts, seen, "phone", match[0], "手机");
    }
    for (const match of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      pushTopicContact(contacts, seen, "email", match[0], "邮箱");
    }
  }

  return contacts;
}

function hydrateWeiwallMetadata(topic: any, metadata: Record<string, any>) {
  const existingContacts = normalizeTopicContacts(metadata?.contacts);
  const derivedContacts = deriveWeiwallTopicContacts({
    ...topic,
    metadata,
  });
  if (!existingContacts.length && !derivedContacts.length) return metadata;
  const contacts: TopicContact[] = [];
  const seen = new Set<string>();
  for (const item of [...existingContacts, ...derivedContacts]) {
    pushTopicContact(contacts, seen, item.type, item.value, item.label);
  }
  return contacts.length ? { ...metadata, contacts } : metadata;
}

function canRevealAnonymousAuthor(viewer: Viewer, authorId?: number | null) {
  if (!viewer || !authorId) return false;
  return viewer.role === "admin" || viewer.role === "mod" || viewer.userId === authorId;
}

function buildAnonymousAuthor(alias?: string | null) {
  return {
    id: null,
    nickname: alias || "匿名同学",
    avatar: null,
    role: "anonymous",
    anonymous: true,
  };
}

function buildExternalAuthor(name?: string | null, avatar?: string | null) {
  return {
    id: null,
    nickname: name || "逛逛同学",
    avatar: avatar || null,
    role: "external",
    external: true,
  };
}

function normalizeTags(tags: any) {
  return Array.isArray(tags)
    ? tags
        .map((item: any) => item?.tag ? { id: item.tag.id, name: item.tag.name } : item)
        .filter((item: any) => item?.name)
    : [];
}

export function decodeTopicForViewer(topic: any, viewer?: Viewer) {
  const rawMetadata = safeJson(topic.metadata);
  const baseMetadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata : {};
  const metadata = baseMetadata?.externalPlatform === "weiwall" ? hydrateWeiwallMetadata(topic, baseMetadata) : baseMetadata;
  const isWeiwall = metadata?.externalPlatform === "weiwall";
  if (isWeiwall) {
    const externalName = topic?.weiwallMap?.externalAuthorName || metadata?.externalAuthorName || "逛逛同学";
    const externalAvatar = topic?.weiwallMap?.externalAuthorAvatar || metadata?.externalAuthorAvatar || null;
    return {
      ...topic,
      authorId: null,
      globalPinned: isGlobalPinnedTopic(Number(topic.id)),
      metadata,
      tags: normalizeTags(topic.tags),
      isAnonymous: false,
      anonymousAlias: null,
      author: buildExternalAuthor(externalName, externalAvatar),
      realAuthor: undefined,
    };
  }
  const anonymous = Boolean(topic?.isAnonymous);
  const reveal = anonymous && canRevealAnonymousAuthor(viewer, topic?.authorId);
  return {
    ...topic,
    authorId: anonymous && !reveal ? null : topic.authorId,
    globalPinned: isGlobalPinnedTopic(Number(topic.id)),
    metadata,
    tags: normalizeTags(topic.tags),
    isAnonymous: anonymous,
    anonymousAlias: anonymous ? (topic.anonymousAlias || "匿名同学") : null,
    author: anonymous ? buildAnonymousAuthor(topic.anonymousAlias) : buildUserPreview(topic.author, viewer),
    realAuthor: anonymous && reveal ? buildUserPreview(topic.author, viewer) : undefined,
  };
}

export function decodeReplyForViewer(reply: any, viewer?: Viewer) {
  if (reply?.weiwallMap?.externalAuthorName) {
    return {
      ...reply,
      authorId: null,
      isAnonymous: false,
      anonymousAlias: null,
      author: buildExternalAuthor(reply.weiwallMap.externalAuthorName, reply.weiwallMap.externalAuthorAvatar),
      realAuthor: undefined,
    };
  }
  const anonymous = Boolean(reply?.isAnonymous);
  const reveal = anonymous && canRevealAnonymousAuthor(viewer, reply?.authorId);
  return {
    ...reply,
    authorId: anonymous && !reveal ? null : reply.authorId,
    isAnonymous: anonymous,
    anonymousAlias: anonymous ? (reply.anonymousAlias || "匿名同学") : null,
    author: anonymous ? buildAnonymousAuthor(reply.anonymousAlias) : buildUserPreview(reply.author, viewer),
    realAuthor: anonymous && reveal ? buildUserPreview(reply.author, viewer) : undefined,
  };
}

export async function decodeTopicForViewerWithImages(topic: any, viewer?: Viewer) {
  const decoded = decodeTopicForViewer(topic, viewer);
  const sourceContent = String(decoded.content || "");
  const [imageReview, videoReview, videoRenderedContent] = await Promise.all([
    summarizeForumImageModerationForContent(sourceContent),
    summarizeForumVideoModerationForContent(sourceContent),
    renderModeratedVideoContent(sourceContent, viewer),
  ]);
  const content = await renderModeratedContent(videoRenderedContent, viewer);
  return {
    ...decoded,
    imageReview,
    videoReview,
    content,
  };
}

export async function decodeReplyForViewerWithImages(reply: any, viewer?: Viewer) {
  const decoded = decodeReplyForViewer(reply, viewer);
  const sourceContent = String(decoded.content || "");
  const [imageReview, videoReview, videoRenderedContent] = await Promise.all([
    summarizeForumImageModerationForContent(sourceContent),
    summarizeForumVideoModerationForContent(sourceContent),
    renderModeratedVideoContent(sourceContent, viewer),
  ]);
  const content = await renderModeratedContent(videoRenderedContent, viewer);
  return {
    ...decoded,
    imageReview,
    videoReview,
    content,
  };
}
