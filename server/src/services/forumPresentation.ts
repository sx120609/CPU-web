import { buildUserPreview } from "../utils/publicUser";
import { renderModeratedContent, summarizeForumImageModerationForContent } from "./imageModeration";
import { isGlobalPinnedTopic } from "./siteSettings";
import { renderModeratedVideoContent, summarizeForumVideoModerationForContent } from "./videoModeration";

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
  const metadata = baseMetadata;
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
