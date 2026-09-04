import { buildUserPreview } from "../utils/publicUser";
import { editableForumContentForViewer } from "./forumContentEditing";
import { renderModeratedContent, renderModeratedContents, summarizeForumImageModerationForContent } from "./imageModeration";
import { sanitizeLostFoundTopicFields } from "./lostFoundPrivacy";
import { isGlobalPinnedTopic } from "./siteSettings";
import { renderModeratedVideoContent, summarizeForumVideoModerationForContent } from "./videoModeration";
import { presentAnonymousAlias } from "./userTrust";
import { presentQuestionMetadata } from "./questionBounty";

type Viewer = {
  userId?: number | null;
  role?: string | null;
  lostFoundRole?: string | null;
} | null | undefined;

export const forumAuthorReputationSelect = {
  createdAt: true,
  postCount: true,
  replyCount: true,
} as const;

export const forumReplyPreviewInclude = {
  where: { hidden: false },
  orderBy: { createdAt: "desc" },
  take: 2,
  select: {
    id: true,
    topicId: true,
    authorId: true,
    content: true,
    isAnonymous: true,
    anonymousAlias: true,
    parentReplyId: true,
    floor: true,
    likeCount: true,
    createdAt: true,
    author: { select: { id: true, nickname: true, role: true, verificationType: true, verificationLabel: true, verificationVerifiedAt: true, verificationExpiresAt: true, ...forumAuthorReputationSelect } },
  },
} as const;

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
    nickname: presentAnonymousAlias(alias),
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
  const { submissionId: _submissionId, replies: rawPreviewReplies, ...publicTopic } = privacySafeTopic;
  const rawMetadata = safeJson(privacySafeTopic.metadata);
  const baseMetadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata : {};
  const metadata = privacySafeTopic.board?.type === "question"
    ? presentQuestionMetadata(baseMetadata)
    : baseMetadata;
  const anonymous = Boolean(privacySafeTopic?.isAnonymous);
  const reveal = anonymous && canRevealAnonymousAuthor(viewer, privacySafeTopic?.authorId);
  return {
    ...publicTopic,
    authorId: anonymous && !reveal ? null : privacySafeTopic.authorId,
    globalPinned: isGlobalPinnedTopic(Number(privacySafeTopic.id)),
    metadata,
    tags: normalizeTags(topic.tags),
    isAnonymous: anonymous,
    anonymousAlias: anonymous ? presentAnonymousAlias(privacySafeTopic.anonymousAlias) : null,
    author: anonymous ? buildAnonymousAuthor(privacySafeTopic.anonymousAlias) : buildUserPreview(privacySafeTopic.author, viewer),
    realAuthor: anonymous && reveal ? buildUserPreview(privacySafeTopic.author, viewer) : undefined,
    ...(Array.isArray(rawPreviewReplies)
      ? { previewReplies: rawPreviewReplies.map((reply) => decodeReplyForViewer(reply, viewer)) }
      : {}),
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
    anonymousAlias: anonymous ? presentAnonymousAlias(reply.anonymousAlias) : null,
    author: anonymous ? buildAnonymousAuthor(reply.anonymousAlias) : buildUserPreview(reply.author, viewer),
    realAuthor: anonymous && reveal ? buildUserPreview(reply.author, viewer) : undefined,
  };
}

export async function decodeTopicForViewerWithImages(topic: any, viewer?: Viewer) {
  const decoded = decodeTopicForViewer(topic, viewer);
  const sourceContent = String(decoded.content || "");
  const editableContent = editableForumContentForViewer(sourceContent, topic.authorId, viewer);
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
    ...(editableContent !== undefined ? { editableContent } : {}),
  };
}

export async function decodeTopicsForViewerForList(topics: any[], viewer?: Viewer) {
  const decoded = topics.map((topic) => decodeTopicForViewer(topic, viewer));
  const videoRendered = await Promise.all(decoded.map((topic) => renderModeratedVideoContent(String(topic.content || ""), viewer)));
  const rendered = await renderModeratedContents(videoRendered, viewer);
  return decoded.map((topic, index) => ({ ...topic, content: rendered[index] }));
}

export async function decodeReplyForViewerWithImages(reply: any, viewer?: Viewer) {
  const decoded = decodeReplyForViewer(reply, viewer);
  const sourceContent = String(decoded.content || "");
  const editableContent = editableForumContentForViewer(sourceContent, reply.authorId, viewer);
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
    ...(editableContent !== undefined ? { editableContent } : {}),
  };
}
