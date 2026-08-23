import { buildUserPreview } from "../utils/publicUser";
import { renderModeratedContent, summarizeForumImageModerationForContent } from "./imageModeration";
import { sanitizeLostFoundTopicFields } from "./lostFoundPrivacy";
import { isGlobalPinnedTopic } from "./siteSettings";
import { renderModeratedVideoContent, summarizeForumVideoModerationForContent } from "./videoModeration";

type Viewer = {
  userId?: number | null;
  role?: string | null;
  lostFoundRole?: string | null;
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
  const privacySafeTopic = sanitizeLostFoundTopicFields(topic, viewer);
  const { submissionId: _submissionId, ...publicTopic } = privacySafeTopic;
  const rawMetadata = safeJson(privacySafeTopic.metadata);
  const baseMetadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata : {};
  const metadata = baseMetadata;
  const anonymous = Boolean(privacySafeTopic?.isAnonymous);
  const reveal = anonymous && canRevealAnonymousAuthor(viewer, privacySafeTopic?.authorId);
  return {
    ...publicTopic,
    authorId: anonymous && !reveal ? null : privacySafeTopic.authorId,
    globalPinned: isGlobalPinnedTopic(Number(privacySafeTopic.id)),
    metadata,
    tags: normalizeTags(topic.tags),
    isAnonymous: anonymous,
    anonymousAlias: anonymous ? (privacySafeTopic.anonymousAlias || "匿名同学") : null,
    author: anonymous ? buildAnonymousAuthor(privacySafeTopic.anonymousAlias) : buildUserPreview(privacySafeTopic.author, viewer),
    realAuthor: anonymous && reveal ? buildUserPreview(privacySafeTopic.author, viewer) : undefined,
  };
}

export function decodeReplyForViewer(reply: any, viewer?: Viewer) {
  const { submissionId: _submissionId, ...publicReply } = reply;
  const anonymous = Boolean(reply?.isAnonymous);
  const reveal = anonymous && canRevealAnonymousAuthor(viewer, reply?.authorId);
  return {
    ...publicReply,
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
