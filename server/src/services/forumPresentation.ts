import { buildUserPreview } from "../utils/publicUser";
import { decorateReplyForViewerWithImageModeration, decorateTopicForViewerWithImageModeration } from "./imageModeration";
import { isGlobalPinnedTopic } from "./siteSettings";

type Viewer = {
  userId?: number | null;
  role?: string | null;
} | null | undefined;

function safeJson(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
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

function normalizeTags(tags: any) {
  return Array.isArray(tags)
    ? tags
        .map((item: any) => item?.tag ? { id: item.tag.id, name: item.tag.name } : item)
        .filter((item: any) => item?.name)
    : [];
}

export function decodeTopicForViewer(topic: any, viewer?: Viewer) {
  const anonymous = Boolean(topic?.isAnonymous);
  const reveal = anonymous && canRevealAnonymousAuthor(viewer, topic?.authorId);
  return {
    ...topic,
    authorId: anonymous && !reveal ? null : topic.authorId,
    globalPinned: isGlobalPinnedTopic(Number(topic.id)),
    metadata: safeJson(topic.metadata),
    tags: normalizeTags(topic.tags),
    isAnonymous: anonymous,
    anonymousAlias: anonymous ? (topic.anonymousAlias || "匿名同学") : null,
    author: anonymous ? buildAnonymousAuthor(topic.anonymousAlias) : buildUserPreview(topic.author, viewer),
    realAuthor: anonymous && reveal ? buildUserPreview(topic.author, viewer) : undefined,
  };
}

export function decodeReplyForViewer(reply: any, viewer?: Viewer) {
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
  return decorateTopicForViewerWithImageModeration(decodeTopicForViewer(topic, viewer), viewer);
}

export async function decodeReplyForViewerWithImages(reply: any, viewer?: Viewer) {
  return decorateReplyForViewerWithImageModeration(decodeReplyForViewer(reply, viewer), viewer);
}
