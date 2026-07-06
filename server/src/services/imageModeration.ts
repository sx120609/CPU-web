import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { prisma } from "../prisma";
import { runWithDistributedLock } from "./cache";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
import { extractAiJsonTextResponse, normalizeAiJsonApiUrl, sendAiJsonRequest } from "./aiJsonApi";
import { prepareMediaLocalFileForProcessing, resolveMediaLocalPathFromUploadUrl, resolveMediaPublicUrl } from "./mediaStorage";
import { resolveModelCandidates, shouldFallbackToNextModel } from "./modelFallback";
import { getSiteConfig } from "./siteSettings";

const IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const IMAGE_HTML_RE = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))[^>]*>/gi;
const MEDIA_HTML_ATTR_RE = /<(video|source|a)\b[^>]*\b(src|href|poster)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))[^>]*>/gi;
const IMAGE_REVIEW_MAX_INLINE_BYTES = 6 * 1024 * 1024;
const IMAGE_REVIEW_MAX_BATCH_INLINE_BYTES = 12 * 1024 * 1024;
const IMAGE_REVIEW_POLL_INTERVAL_MS = 20_000;
const IMAGE_REVIEW_DEFAULT_CONCURRENCY = 2;
const IMAGE_REVIEW_DEFAULT_REQUEST_GROUP_SIZE = 3;
const FORUM_IMAGE_SWEEP_BATCH_SIZE = 200;

let pollerStarted = false;
let moderationDrainBudget = 0;
let moderationDrainPromise: Promise<number> | null = null;
let forumImageSweepPromise: Promise<ForumImageSweepSummary> | null = null;

type Viewer = {
  userId?: number | null;
  role?: string | null;
} | null | undefined;

type ImageReviewDecision = {
  approved: boolean;
  reason: string;
  detail: string;
  riskLevel: "low" | "medium" | "high";
  riskScore: number;
  decision: "auto_pass" | "block";
  model: string;
  endpoint: string;
};
type ParsedImageReviewJson = {
  approved?: boolean;
  risk_score?: number;
  risk_level?: string;
  decision?: string;
  reason?: string;
  detail?: string;
  categories?: Record<string, number>;
};
type PreparedImageReviewInput = {
  asset: {
    id: number;
    url: string;
    localPath: string;
    mimeType: string | null;
    attemptCount: number;
  };
  mimeType: string;
  dataUrl: string;
};

export type ForumImageModerationSummary = {
  enabled: boolean;
  totalCount: number;
  pendingCount: number;
  rejectedCount: number;
  approvedCount: number;
};

export type ForumImageSweepSummary = {
  reviewEnabled: boolean;
  scannedTopics: number;
  scannedReplies: number;
  imageReferences: number;
  uniqueImageUrls: number;
  createdAssets: number;
  requeuedAssets: number;
  alreadyTracked: number;
  skippedAssets: number;
  pendingAfterScan: number;
  moderationTriggered: boolean;
};

export type ForumImageReviewAsset = {
  id: number;
  url: string;
  status: string;
  reason: string | null;
  detail: string | null;
  reviewModel: string | null;
  reviewEndpoint: string | null;
  reviewedAt: Date | null;
  lastError: string | null;
  manualReviewedAt: Date | null;
  manualReviewNote: string | null;
  manualReviewedBy: {
    id: number;
    nickname: string;
    username: string;
  } | null;
};

export function startForumImageModerationPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  const tick = () => {
    triggerForumImageModerationDrain(getImageReviewDispatchCapacity())
      .catch((error: unknown) => {
        console.warn("[image-review] moderation tick failed", error);
      });
  };
  setTimeout(tick, 5_000);
  setInterval(tick, IMAGE_REVIEW_POLL_INTERVAL_MS);
}

export function shouldRunImageReview() {
  const config = getSiteConfig();
  return Boolean(
    config.imageReviewEnabled
    && config.imageReviewApiKey.trim()
    && config.imageReviewModel.trim()
    && config.imageReviewApiUrl.trim(),
  );
}

export async function registerForumImageAsset(input: {
  url: string;
  localPath?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  createdById?: number | null;
}) {
  const normalizedUrl = normalizeForumImageUrl(input.url);
  if (!normalizedUrl) return null;
  const localPath = normalizeLocalUploadPath(input.localPath) || resolveForumImageLocalPath(normalizedUrl);
  if (!localPath) return null;
  const existing = await prisma.forumImageAsset.findUnique({
    where: { url: normalizedUrl },
    select: { id: true, status: true, reviewModel: true, reviewEndpoint: true },
  });
  if (existing) {
    const shouldRequeue = shouldRunImageReview()
      && existing.status === "approved"
      && (existing.reviewModel === "bypass" || existing.reviewEndpoint === "disabled");
    return prisma.forumImageAsset.update({
      where: { id: existing.id },
      data: {
        localPath,
        mimeType: input.mimeType ?? undefined,
        fileSize: input.fileSize ?? undefined,
        createdById: input.createdById ?? undefined,
        ...(shouldRequeue
          ? {
              status: "pending",
              reason: null,
              detail: null,
              reviewModel: null,
              reviewEndpoint: null,
              reviewedAt: null,
              nextRetryAt: null,
              lastError: null,
            }
          : {}),
      },
    });
  }
  const enabled = shouldRunImageReview();
  return prisma.forumImageAsset.create({
    data: {
      url: normalizedUrl,
      localPath,
      mimeType: input.mimeType || null,
      fileSize: input.fileSize ?? null,
      createdById: input.createdById ?? null,
      status: enabled ? "pending" : "approved",
      reviewedAt: enabled ? null : new Date(),
      reason: enabled ? null : "图片审核未启用",
      reviewModel: enabled ? null : "bypass",
      reviewEndpoint: enabled ? null : "disabled",
    },
  });
}

export async function ensureForumImageAssetsForContent(content: string, createdById?: number | null) {
  const urls = extractForumImageUrls(content);
  if (!urls.length) return [];
  const tasks = urls.map((url) => registerForumImageAsset({ url, createdById: createdById ?? null }));
  return Promise.all(tasks);
}

export async function backfillForumImageAssetsAndTriggerModeration() {
  if (!forumImageSweepPromise) {
    forumImageSweepPromise = performForumImageSweep().finally(() => {
      forumImageSweepPromise = null;
    });
  }
  return forumImageSweepPromise;
}

export async function moderatePendingForumImages(limit = getImageReviewDispatchCapacity()) {
  if (!shouldRunImageReview()) return { processed: 0 };
  const now = new Date();
  const take = Math.max(1, Math.floor(Number(limit) || getImageReviewDispatchCapacity()));
  const concurrency = getImageReviewConcurrency();
  const groupSize = getImageReviewRequestGroupSize();
  const list = await prisma.forumImageAsset.findMany({
    where: {
      OR: [
        { status: "pending" },
        { status: "error", nextRetryAt: { lte: now } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
  const groups = chunkImageAssets(list, groupSize);
  for (let index = 0; index < groups.length; index += concurrency) {
    const wave = groups.slice(index, index + concurrency);
    const results = await Promise.allSettled(wave.map((group) => moderateForumImageGroup(group)));
    const rejected = results.filter((item) => item.status === "rejected");
    if (rejected.length) {
      rejected.forEach((item) => {
        console.warn("[image-review] image moderation group failed", item.reason);
      });
    }
  }
  return { processed: list.length };
}

export async function decorateTopicForViewerWithImageModeration(topic: any, viewer?: Viewer) {
  const imageReview = await summarizeForumImageModerationForContent(topic.content);
  return {
    ...topic,
    imageReview,
    content: await renderModeratedContent(topic.content, viewer),
  };
}

export async function decorateReplyForViewerWithImageModeration(reply: any, viewer?: Viewer) {
  const imageReview = await summarizeForumImageModerationForContent(reply.content);
  return {
    ...reply,
    imageReview,
    content: await renderModeratedContent(reply.content, viewer),
  };
}

export async function summarizeForumImageModerationForContent(content: string): Promise<ForumImageModerationSummary> {
  const urls = extractForumImageUrls(content);
  if (!urls.length) {
    return {
      enabled: shouldRunImageReview(),
      totalCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      approvedCount: 0,
    };
  }
  const rows = await prisma.forumImageAsset.findMany({
    where: { url: { in: urls } },
    select: { url: true, status: true, reason: true, lastError: true },
  });
  const rowMap = new Map(rows.map((row) => [row.url, row]));
  const missing = urls.filter((url) => !rowMap.has(url));
  if (missing.length) {
    const created = await Promise.all(missing.map((url) => registerForumImageAsset({ url })));
    created.forEach((item, index) => {
      rowMap.set(missing[index], {
        url: missing[index],
        status: item?.status || (shouldRunImageReview() ? "pending" : "approved"),
        reason: item?.reason || null,
        lastError: item?.lastError || null,
      });
    });
  }
  let pendingCount = 0;
  let rejectedCount = 0;
  let approvedCount = 0;
  for (const url of urls) {
    const normalized = normalizeForumImageAssetState(rowMap.get(url));
    if (normalized.status === "approved") approvedCount += 1;
    else if (normalized.status === "rejected") rejectedCount += 1;
    else pendingCount += 1;
  }
  return {
    enabled: shouldRunImageReview(),
    totalCount: urls.length,
    pendingCount,
    rejectedCount,
    approvedCount,
  };
}

export async function listForumImageAssetsForContent(content: string): Promise<ForumImageReviewAsset[]> {
  const urls = extractForumImageUrls(content);
  if (!urls.length) return [];

  const select = {
    id: true,
    url: true,
    status: true,
    reason: true,
    detail: true,
    reviewModel: true,
    reviewEndpoint: true,
    reviewedAt: true,
    lastError: true,
    manualReviewedAt: true,
    manualReviewNote: true,
    manualReviewedBy: {
      select: {
        id: true,
        nickname: true,
        username: true,
      },
    },
  } as const;

  const initialRows = await prisma.forumImageAsset.findMany({
    where: { url: { in: urls } },
    select,
  });
  const initialMap = new Map(initialRows.map((row) => [row.url, row]));
  const missing = urls.filter((url) => !initialMap.has(url));
  if (missing.length) {
    await Promise.all(missing.map((url) => registerForumImageAsset({ url }))).catch(() => null);
  }

  const rows = missing.length
    ? await prisma.forumImageAsset.findMany({
        where: { url: { in: urls } },
        select,
      })
    : initialRows;
  const rowMap = new Map(rows.map((row) => [row.url, row]));

  return urls
    .map((url) => rowMap.get(url))
    .filter(Boolean)
    .map((row) => ({
      id: row!.id,
      url: row!.url,
      status: row!.status,
      reason: row!.reason,
      detail: row!.detail,
      reviewModel: row!.reviewModel,
      reviewEndpoint: row!.reviewEndpoint,
      reviewedAt: row!.reviewedAt,
      lastError: row!.lastError,
      manualReviewedAt: row!.manualReviewedAt,
      manualReviewNote: row!.manualReviewNote,
      manualReviewedBy: row!.manualReviewedBy
        ? {
            id: row!.manualReviewedBy.id,
            nickname: row!.manualReviewedBy.nickname,
            username: row!.manualReviewedBy.username,
          }
        : null,
    }));
}

export async function applyManualForumImageReview(input: {
  assetId: number;
  reviewerId: number;
  approved: boolean;
  note?: string | null;
}) {
  const existing = await prisma.forumImageAsset.findUnique({
    where: { id: input.assetId },
    select: {
      id: true,
      reason: true,
      detail: true,
    },
  });
  if (!existing) return null;

  const note = String(input.note || "").trim();
  const reviewedAt = new Date();
  const reason = input.approved
    ? (note || "管理员人工复核通过")
    : (note || existing.reason || "管理员人工驳回，继续隐藏");
  const detail = note || existing.detail || existing.reason || (input.approved ? "管理员人工复核通过，允许公开展示" : "管理员人工驳回，继续隐藏");

  return prisma.forumImageAsset.update({
    where: { id: input.assetId },
    data: {
      status: input.approved ? "approved" : "rejected",
      reason,
      detail,
      reviewModel: "manual",
      reviewEndpoint: "mod-panel",
      reviewedAt,
      nextRetryAt: null,
      lastError: null,
      manualReviewedById: input.reviewerId,
      manualReviewedAt: reviewedAt,
      manualReviewNote: note || null,
    },
    include: {
      manualReviewedBy: {
        select: {
          id: true,
          nickname: true,
          username: true,
        },
      },
    },
  });
}

export async function renderModeratedContent(content: string, _viewer?: Viewer) {
  const matches = collectImageMatches(content);
  if (!matches.length) return rewriteUploadMediaAttributes(content);
  const localUrls = Array.from(new Set(matches.map((item) => normalizeForumImageUrl(item.url)).filter(Boolean) as string[]));
  if (!localUrls.length) return rewriteUploadMediaAttributes(content);

  const rows = await prisma.forumImageAsset.findMany({
    where: { url: { in: localUrls } },
    select: { url: true, status: true, reason: true, lastError: true },
  });
  const rowMap = new Map(rows.map((row) => [row.url, row]));
  const missing = localUrls.filter((url) => !rowMap.has(url));
  if (missing.length) {
    const created = await Promise.all(missing.map((url) => registerForumImageAsset({ url })));
    missing.forEach((url, index) => {
      const row = created[index];
      rowMap.set(url, {
        url,
        status: row?.status || (shouldRunImageReview() ? "pending" : "approved"),
        reason: row?.reason || null,
        lastError: row?.lastError || null,
      } as any);
    });
  }

  const visibleUrls = localUrls.filter((url) => {
    const normalized = normalizeForumImageAssetState(rowMap.get(url));
    if (!shouldRunImageReview() && normalized.status !== "rejected") return true;
    return normalized.status === "approved";
  });
  const publicUrlMap = new Map<string, string>();
  await Promise.all(visibleUrls.map(async (url) => {
    publicUrlMap.set(url, await resolveMediaPublicUrl(url));
  }));

  let rendered = "";
  let lastIndex = 0;
  for (const match of matches) {
    rendered += content.slice(lastIndex, match.index);
    const normalizedUrl = normalizeForumImageUrl(match.url);
    const row = normalizedUrl ? rowMap.get(normalizedUrl) : null;
    rendered += rewriteImageToken(match, row, normalizedUrl ? publicUrlMap.get(normalizedUrl) : "");
    lastIndex = match.index + match.raw.length;
  }
  rendered += content.slice(lastIndex);
  return rewriteUploadMediaAttributes(rendered);
}

function rewriteImageToken(
  match: { raw: string; alt: string; url: string },
  row?: { status?: string | null; reason?: string | null; lastError?: string | null } | null,
  publicUrl?: string,
) {
  const normalized = normalizeForumImageAssetState(row);
  if (!shouldRunImageReview() && normalized.status !== "rejected") {
    return rewriteVisibleImageToken(match, publicUrl);
  }
  if (normalized.status === "approved") {
    return rewriteVisibleImageToken(match, publicUrl);
  }
  if (normalized.status === "rejected") {
    return buildImageReviewPlaceholder("rejected", normalized.reason || "未通过图片审核");
  }
  return buildImageReviewPlaceholder("pending");
}

function rewriteVisibleImageToken(match: { raw: string; alt: string; url: string }, publicUrl?: string) {
  const target = String(publicUrl || "").trim();
  if (!target || target === match.url) return match.raw;
  const trimmedRaw = match.raw.trimStart();
  if (trimmedRaw.startsWith("<img")) {
    return match.raw.replace(match.url, escapeHtmlAttribute(target));
  }
  if (trimmedRaw.startsWith("![")) {
    return `<img src="${escapeHtmlAttribute(target)}" alt="${escapeHtmlAttribute(match.alt)}" />`;
  }
  return match.raw.replace(match.url, target);
}

function collectImageMarkdownMatches(content: string) {
  const items: Array<{ raw: string; alt: string; url: string; index: number }> = [];
  for (const match of content.matchAll(IMAGE_MARKDOWN_RE)) {
    items.push({
      raw: match[0],
      alt: match[1] || "",
      url: match[2] || "",
      index: match.index ?? 0,
    });
  }
  return items;
}

function collectImageHtmlMatches(content: string) {
  const items: Array<{ raw: string; alt: string; url: string; index: number }> = [];
  for (const match of content.matchAll(IMAGE_HTML_RE)) {
    items.push({
      raw: match[0],
      alt: "",
      url: match[1] || match[2] || match[3] || "",
      index: match.index ?? 0,
    });
  }
  return items;
}

function collectImageMatches(content: string) {
  return [
    ...collectImageMarkdownMatches(content),
    ...collectImageHtmlMatches(content),
  ].sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);
}

function collectUploadMediaAttributeMatches(content: string) {
  const items: Array<{ raw: string; url: string; index: number }> = [];
  for (const match of content.matchAll(MEDIA_HTML_ATTR_RE)) {
    items.push({
      raw: match[0],
      url: match[3] || match[4] || match[5] || "",
      index: match.index ?? 0,
    });
  }
  return items.sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);
}

async function rewriteUploadMediaAttributes(content: string) {
  const matches = collectUploadMediaAttributeMatches(content);
  if (!matches.length) return content;
  const uploadUrls = Array.from(new Set(
    matches
      .map((item) => normalizeUploadManagedUrl(item.url))
      .filter(Boolean) as string[],
  ));
  if (!uploadUrls.length) return content;
  const publicUrlMap = new Map<string, string>();
  await Promise.all(uploadUrls.map(async (url) => {
    publicUrlMap.set(url, await resolveMediaPublicUrl(url));
  }));

  let rendered = "";
  let lastIndex = 0;
  for (const match of matches) {
    rendered += content.slice(lastIndex, match.index);
    const normalizedUrl = normalizeUploadManagedUrl(match.url);
    rendered += rewriteMediaAttributeToken(match.raw, match.url, normalizedUrl ? publicUrlMap.get(normalizedUrl) : "");
    lastIndex = match.index + match.raw.length;
  }
  rendered += content.slice(lastIndex);
  return rendered;
}

function rewriteMediaAttributeToken(raw: string, originalUrl: string, publicUrl?: string) {
  const target = String(publicUrl || "").trim();
  if (!target || target === originalUrl) return raw;
  return raw.replace(originalUrl, escapeHtmlAttribute(target));
}

function extractForumImageUrls(content: string) {
  return Array.from(new Set(
    collectImageMatches(content)
      .map((item) => normalizeForumImageUrl(item.url))
      .filter(Boolean) as string[],
  ));
}

function normalizeForumImageUrl(input: string | null | undefined) {
  return normalizeUploadManagedUrl(input);
}

function normalizeUploadManagedUrl(input: string | null | undefined) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/uploads/")) return raw.split("?")[0];
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    return url.pathname.startsWith("/uploads/") ? url.pathname : "";
  } catch {
    return "";
  }
}

function resolveForumImageLocalPath(url: string) {
  const normalized = normalizeUploadManagedUrl(url);
  if (!normalized.startsWith("/uploads/")) return "";
  return resolveMediaLocalPathFromUploadUrl(normalized);
}

function normalizeLocalUploadPath(input: string | null | undefined) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return path.resolve(raw);
}

function normalizeForumImageAssetState(row?: { status?: string | null; reason?: string | null; lastError?: string | null } | null) {
  const status = String(row?.status || "").trim().toLowerCase();
  if (status === "approved") {
    return { status: "approved" as const, reason: row?.reason || null };
  }
  if (status === "rejected") {
    return { status: "rejected" as const, reason: row?.reason || "未通过图片审核" };
  }
  if (isContentPolicyViolationText(`${row?.reason || ""}\n${row?.lastError || ""}`)) {
    return { status: "rejected" as const, reason: row?.reason || "图片未通过平台内容安全检查" };
  }
  return { status: "pending" as const, reason: row?.reason || null };
}

function buildImageReviewPlaceholder(status: "pending" | "rejected", reason?: string | null) {
  if (status === "rejected") {
    return `<span class="image-review-placeholder image-review-placeholder-rejected" data-image-review-state="rejected">[图片未通过审核，已隐藏${reason ? `：${escapeHtml(reason)}` : ""}]</span>`;
  }
  return '<span class="image-review-placeholder image-review-placeholder-pending" data-image-review-state="pending">[图片审核中，暂时不可查看]</span>';
}

function escapeHtml(input: string) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(input: string) {
  return escapeHtml(input);
}

async function performForumImageSweep(): Promise<ForumImageSweepSummary> {
  let scannedTopics = 0;
  let scannedReplies = 0;
  let imageReferences = 0;
  const uniqueUrls = new Set<string>();

  let lastTopicId = 0;
  for (;;) {
    const rows = await prisma.topic.findMany({
      where: { id: { gt: lastTopicId } },
      orderBy: { id: "asc" },
      take: FORUM_IMAGE_SWEEP_BATCH_SIZE,
      select: { id: true, content: true },
    });
    if (!rows.length) break;
    scannedTopics += rows.length;
    for (const row of rows) {
      const urls = extractForumImageUrls(row.content);
      imageReferences += urls.length;
      urls.forEach((url) => uniqueUrls.add(url));
    }
    lastTopicId = rows[rows.length - 1].id;
  }

  let lastReplyId = 0;
  for (;;) {
    const rows = await prisma.reply.findMany({
      where: { id: { gt: lastReplyId } },
      orderBy: { id: "asc" },
      take: FORUM_IMAGE_SWEEP_BATCH_SIZE,
      select: { id: true, content: true },
    });
    if (!rows.length) break;
    scannedReplies += rows.length;
    for (const row of rows) {
      const urls = extractForumImageUrls(row.content);
      imageReferences += urls.length;
      urls.forEach((url) => uniqueUrls.add(url));
    }
    lastReplyId = rows[rows.length - 1].id;
  }

  const reviewEnabled = shouldRunImageReview();
  const urls = Array.from(uniqueUrls);
  let createdAssets = 0;
  let requeuedAssets = 0;
  let alreadyTracked = 0;
  let skippedAssets = 0;

  for (let index = 0; index < urls.length; index += FORUM_IMAGE_SWEEP_BATCH_SIZE) {
    const chunk = urls.slice(index, index + FORUM_IMAGE_SWEEP_BATCH_SIZE);
    const existingRows = await prisma.forumImageAsset.findMany({
      where: { url: { in: chunk } },
      select: { url: true, status: true, reviewModel: true, reviewEndpoint: true },
    });
    const existingMap = new Map(existingRows.map((row) => [row.url, row]));
    const results = await Promise.all(chunk.map((url) => registerForumImageAsset({ url })));
    results.forEach((row, offset) => {
      if (!row) {
        skippedAssets += 1;
        return;
      }
      const previous = existingMap.get(chunk[offset]);
      if (!previous) {
        createdAssets += 1;
        return;
      }
      const requeued = reviewEnabled
        && previous.status === "approved"
        && (previous.reviewModel === "bypass" || previous.reviewEndpoint === "disabled")
        && row.status === "pending";
      if (requeued) requeuedAssets += 1;
      else alreadyTracked += 1;
    });
  }

  const pendingAfterScan = await prisma.forumImageAsset.count({
    where: { status: { in: ["pending", "error"] } },
  });
  const moderationTriggered = reviewEnabled && pendingAfterScan > 0;
  if (moderationTriggered) {
    void triggerForumImageModerationDrain(Number.POSITIVE_INFINITY).catch((error) => {
      console.warn("[image-review] manual sweep failed", error);
    });
  }

  return {
    reviewEnabled,
    scannedTopics,
    scannedReplies,
    imageReferences,
    uniqueImageUrls: urls.length,
    createdAssets,
    requeuedAssets,
    alreadyTracked,
    skippedAssets,
    pendingAfterScan,
    moderationTriggered,
  };
}

export function triggerForumImageModerationDrain(maxProcessed = getImageReviewDispatchCapacity()) {
  const normalized = Number.isFinite(maxProcessed)
    ? Math.max(1, Math.floor(maxProcessed))
    : Number.POSITIVE_INFINITY;
  moderationDrainBudget = Number.isFinite(normalized)
    ? (Number.isFinite(moderationDrainBudget)
      ? Math.max(moderationDrainBudget, normalized)
      : moderationDrainBudget)
    : Number.POSITIVE_INFINITY;
  if (!moderationDrainPromise) {
    moderationDrainPromise = runForumImageModerationDrain().finally(() => {
      moderationDrainPromise = null;
    });
  }
  return moderationDrainPromise;
}

async function runForumImageModerationDrain() {
  const locked = await runWithDistributedLock("forum-image-review:drain", 120_000, async () => {
    let processed = 0;
    while (!Number.isFinite(moderationDrainBudget) || moderationDrainBudget > 0) {
      const dispatchCapacity = getImageReviewDispatchCapacity();
      const batchLimit = Number.isFinite(moderationDrainBudget)
        ? Math.min(dispatchCapacity, moderationDrainBudget)
        : dispatchCapacity;
      const result = await moderatePendingForumImages(batchLimit);
      if (!result.processed) {
        moderationDrainBudget = 0;
        break;
      }
      processed += result.processed;
      if (Number.isFinite(moderationDrainBudget)) {
        moderationDrainBudget = Math.max(0, moderationDrainBudget - result.processed);
      }
      if (result.processed < batchLimit) {
        moderationDrainBudget = 0;
        break;
      }
    }
    return processed;
  });
  return locked.result ?? 0;
}

function getImageReviewConcurrency() {
  const config = getSiteConfig();
  return Math.max(1, Math.min(8, Math.floor(Number(config.imageReviewConcurrency) || IMAGE_REVIEW_DEFAULT_CONCURRENCY)));
}

function getImageReviewRequestGroupSize() {
  const config = getSiteConfig();
  return Math.max(1, Math.min(6, Math.floor(Number(config.imageReviewRequestGroupSize) || IMAGE_REVIEW_DEFAULT_REQUEST_GROUP_SIZE)));
}

function getImageReviewDispatchCapacity() {
  return getImageReviewConcurrency() * getImageReviewRequestGroupSize();
}

function chunkImageAssets<T>(list: T[], size: number) {
  const normalizedSize = Math.max(1, Math.floor(size) || 1);
  const out: T[][] = [];
  for (let index = 0; index < list.length; index += normalizedSize) {
    out.push(list.slice(index, index + normalizedSize));
  }
  return out;
}

async function moderateSingleForumImage(asset: {
  id: number;
  url: string;
  localPath: string;
  mimeType: string | null;
  attemptCount: number;
}) {
  try {
    const prepared = await prepareImageReviewInput(asset);
    await reviewPreparedImage(prepared);
  } catch (error: any) {
    await markImageReviewError(asset, error);
  }
}

async function moderateForumImageGroup(assets: Array<{
  id: number;
  url: string;
  localPath: string;
  mimeType: string | null;
  attemptCount: number;
}>) {
  const preparedResults = await Promise.allSettled(assets.map((asset) => prepareImageReviewInput(asset)));
  const prepared: PreparedImageReviewInput[] = [];
  for (let index = 0; index < preparedResults.length; index += 1) {
    const result = preparedResults[index];
    if (result.status === "fulfilled") prepared.push(result.value);
    else await markImageReviewError(assets[index], result.reason);
  }
  if (!prepared.length) return;
  const batches = splitPreparedImageReviewInputs(prepared);
  for (const batch of batches) {
    if (batch.length === 1) {
      await Promise.allSettled(batch.map((item) => reviewPreparedImage(item)));
      continue;
    }
    try {
      const decisions = await requestImageReviewBatch(batch);
      if (decisions.length !== batch.length) throw new Error(`批量图片审核结果数量异常：expected ${batch.length}, got ${decisions.length}`);
      await Promise.all(batch.map((item, index) => applyImageReviewDecision(item.asset.id, decisions[index])));
    } catch (error) {
      console.warn("[image-review] batch image review failed, fallback to single", error);
      await Promise.allSettled(batch.map((item) => reviewPreparedImage(item)));
    }
  }
}

async function prepareImageReviewInput(asset: {
  id: number;
  url: string;
  localPath: string;
  mimeType: string | null;
  attemptCount: number;
}): Promise<PreparedImageReviewInput> {
  const now = new Date();
  await prisma.forumImageAsset.update({
    where: { id: asset.id },
    data: {
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
      status: "pending",
      lastError: null,
    },
  });
  const preparedFile = await prepareMediaLocalFileForProcessing(asset.url);
  const localPath = preparedFile.localPath || asset.localPath;
  try {
    const buffer = await readFile(localPath);
    if (!buffer.length || buffer.length > IMAGE_REVIEW_MAX_INLINE_BYTES) {
      throw new Error(buffer.length ? "图片文件过大，无法送审" : "图片文件为空");
    }
    const mimeType = resolveMimeType(asset.mimeType, localPath, buffer);
    if (!mimeType) throw new Error("图片格式暂不支持审核");
    if (!preparedFile.temporary && localPath !== asset.localPath) {
      await prisma.forumImageAsset.update({
        where: { id: asset.id },
        data: { localPath },
      }).catch(() => null);
    }
    return {
      asset: {
        ...asset,
        localPath,
      },
      mimeType,
      dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    };
  } finally {
    if (preparedFile.temporary && preparedFile.localPath) {
      await rm(preparedFile.localPath, { force: true }).catch(() => null);
    }
  }
}

async function reviewPreparedImage(input: PreparedImageReviewInput) {
  try {
    const decision = await requestImageReview({
      url: input.asset.url,
      localPath: input.asset.localPath,
      mimeType: input.mimeType,
      dataUrl: input.dataUrl,
    });
    await applyImageReviewDecision(input.asset.id, decision);
  } catch (error: any) {
    await markImageReviewError(input.asset, error);
  }
}

async function applyImageReviewDecision(assetId: number, decision: ImageReviewDecision) {
  await prisma.forumImageAsset.update({
    where: { id: assetId },
    data: {
      status: decision.approved ? "approved" : "rejected",
      reason: decision.reason,
      detail: decision.detail,
      reviewModel: decision.model,
      reviewEndpoint: decision.endpoint,
      reviewedAt: new Date(),
      nextRetryAt: null,
      lastError: null,
    },
  });
}

async function markImageReviewError(
  asset: { id: number; attemptCount: number },
  error: unknown,
) {
  const delayMinutes = Math.min(60, Math.max(3, asset.attemptCount * 5 || 3));
  await prisma.forumImageAsset.update({
    where: { id: asset.id },
    data: {
      status: "error",
      lastError: String((error as any)?.message || error || "图片审核失败").slice(0, 500),
      nextRetryAt: new Date(Date.now() + delayMinutes * 60 * 1000),
    },
  });
}

function splitPreparedImageReviewInputs(inputs: PreparedImageReviewInput[]) {
  const maxGroupSize = getImageReviewRequestGroupSize();
  const batches: PreparedImageReviewInput[][] = [];
  let current: PreparedImageReviewInput[] = [];
  let currentBytes = 0;
  for (const input of inputs) {
    const payloadBytes = Buffer.byteLength(input.dataUrl, "utf8");
    if (
      current.length
      && (current.length >= maxGroupSize || currentBytes + payloadBytes > IMAGE_REVIEW_MAX_BATCH_INLINE_BYTES)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(input);
    currentBytes += payloadBytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function requestImageReview(input: {
  url: string;
  localPath: string;
  mimeType: string;
  dataUrl: string;
}): Promise<ImageReviewDecision> {
  const config = getSiteConfig();
  const endpoint = normalizeAiJsonApiUrl(config.imageReviewApiUrl, "https://api.openai.com/v1/chat/completions");
  const candidates = resolveModelCandidates(config.imageReviewModel, config.imageReviewFallbackModels);
  const promptCacheKey = buildImageReviewPromptCacheKey({
    configHash: buildImageReviewConfigHash(config),
    batchSize: 1,
  });
  let lastError: Error | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const started = await startAiReviewLog({
      kind: "image",
      targetLabel: path.basename(input.localPath),
      targetUrl: input.url,
      provider: "image-review",
      model,
      endpoint,
      requestSummary: `${input.mimeType}\n${input.url}`,
    });
    const logId = started?.id ?? null;
    const requestResult = await sendAiJsonRequest({
      endpoint,
      apiKey: config.imageReviewApiKey,
      model,
      temperature: 0.1,
      promptCacheKey,
      enablePromptCacheRetention: true,
      messages: [
        { role: "system", content: config.imageReviewSystemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: renderPromptTemplate(config.imageReviewUserPrompt, {
                imageUrl: input.url,
                mimeType: input.mimeType,
                fileName: path.basename(input.localPath),
              }),
            },
            {
              type: "image_url",
              image_url: {
                url: input.dataUrl,
                detail: "low",
              },
            },
          ],
        },
      ],
    });
    const response = requestResult.response;
    if (!response.ok) {
      const text = requestResult.errorText || await response.text().catch(() => "");
      const providerBlock = extractProviderContentPolicyBlock(text);
      if (providerBlock) {
        const decision = {
          approved: false,
          reason: "图片未通过平台内容安全检查",
          detail: buildImageDecisionDetail({
            riskScore: 100,
            riskLevel: "high",
            decision: "block",
            categories: { provider_policy: 100 },
            detail: providerBlock.message || "上游审核接口直接拦截了该图片请求",
          }),
          riskLevel: "high" as const,
          riskScore: 100,
          decision: "block" as const,
          model,
          endpoint,
        };
        await finishAiReviewLogSuccess(logId, JSON.stringify({
          risk_score: decision.riskScore,
          risk_level: decision.riskLevel,
          decision: decision.decision,
          reason: decision.reason,
          detail: decision.detail,
          providerErrorCode: providerBlock.code,
        }));
        return decision;
      }
      await finishAiReviewLogError(logId, `HTTP ${response.status}`, text);
      if (index < candidates.length - 1 && shouldFallbackToNextModel(response.status, text)) {
        lastError = new Error(`图片审核模型 ${model} 当前不可用，已自动切换备选模型`);
        continue;
      }
      throw new Error(`图片审核请求失败：${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
    }
    const json: any = await response.json();
    const content = extractAiJsonTextResponse(json, requestResult.mode);
    await finishAiReviewLogSuccess(logId, content);
    return buildImageReviewDecision(parseImageReviewJson(content), config.imageReviewThreshold, model, endpoint);
  }
  throw lastError || new Error("图片审核请求失败");
}

async function requestImageReviewBatch(inputs: PreparedImageReviewInput[]): Promise<ImageReviewDecision[]> {
  const config = getSiteConfig();
  const endpoint = normalizeAiJsonApiUrl(config.imageReviewApiUrl, "https://api.openai.com/v1/chat/completions");
  const requestSummary = inputs
    .map((item, index) => `${index + 1}. ${item.mimeType} ${item.asset.url}`)
    .join("\n")
    .slice(0, 4000);
  const contentItems: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }> = [
    {
      type: "text",
      text: buildBatchImageReviewPrompt(inputs, config.imageReviewUserPrompt),
    },
    ...inputs.map((item) => ({
      type: "image_url" as const,
      image_url: {
        url: item.dataUrl,
        detail: "low" as const,
      },
    })),
  ];
  const candidates = resolveModelCandidates(config.imageReviewModel, config.imageReviewFallbackModels);
  const promptCacheKey = buildImageReviewPromptCacheKey({
    configHash: buildImageReviewConfigHash(config),
    batchSize: inputs.length,
  });
  let lastError: Error | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const started = await startAiReviewLog({
      kind: "image",
      targetLabel: `${inputs.length} 张图片批量审核`,
      targetUrl: inputs.map((item) => item.asset.url).slice(0, 3).join("\n"),
      provider: "image-review",
      model,
      endpoint,
      requestSummary,
    });
    const logId = started?.id ?? null;
    const requestResult = await sendAiJsonRequest({
      endpoint,
      apiKey: config.imageReviewApiKey,
      model,
      temperature: 0.1,
      promptCacheKey,
      enablePromptCacheRetention: true,
      messages: [
        { role: "system", content: config.imageReviewSystemPrompt },
        { role: "user", content: contentItems },
      ],
    });
    const response = requestResult.response;
    if (!response.ok) {
      const text = requestResult.errorText || await response.text().catch(() => "");
      await finishAiReviewLogError(logId, `HTTP ${response.status}`, text);
      if (index < candidates.length - 1 && shouldFallbackToNextModel(response.status, text)) {
        lastError = new Error(`批量图片审核模型 ${model} 当前不可用，已自动切换备选模型`);
        continue;
      }
      throw new Error(`批量图片审核请求失败：${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
    }
    const json: any = await response.json();
    const content = extractAiJsonTextResponse(json, requestResult.mode);
    await finishAiReviewLogSuccess(logId, content);
    return parseImageReviewBatchJson(content, inputs.length)
      .map((item) => buildImageReviewDecision(item, config.imageReviewThreshold, model, endpoint));
  }
  throw lastError || new Error("批量图片审核请求失败");
}

function parseImageReviewJson(content: string): ParsedImageReviewJson {
  if (!content || typeof content !== "string") throw new Error("图片审核返回为空");
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* ignore */
      }
    }
    throw new Error("图片审核返回格式异常");
  }
}

function parseImageReviewBatchJson(content: string, expectedCount: number): ParsedImageReviewJson[] {
  const parsed = parseImageReviewJson(content) as any;
  const results = Array.isArray(parsed) ? parsed : parsed?.results;
  if (!Array.isArray(results)) {
    throw new Error("批量图片审核返回格式异常");
  }
  if (results.length !== expectedCount) {
    throw new Error(`批量图片审核结果数量异常：expected ${expectedCount}, got ${results.length}`);
  }
  return results as ParsedImageReviewJson[];
}

function renderPromptTemplate(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => stringifyPromptValue(vars[key]));
}

function extractProviderContentPolicyBlock(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  let code = "";
  let message = "";
  try {
    const parsed = JSON.parse(raw);
    code = String(parsed?.error?.code || "").trim();
    message = String(parsed?.error?.message || "").trim();
  } catch {
    /* ignore */
  }
  const combined = [code, message, raw].filter(Boolean).join("\n");
  if (!isContentPolicyViolationText(combined)) return null;
  return {
    code: code || "content_policy_violation",
    message: message || "Your input image may contain content that is not allowed by the content safety system.",
  };
}

function isContentPolicyViolationText(text: string) {
  return /content[_\s-]?policy[_\s-]?violation|content safety system|not allowed by (?:our|the) content safety system/i.test(String(text || ""));
}

function stringifyPromptValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveMimeType(inputMime: string | null | undefined, filePath: string, buffer: Buffer) {
  const normalized = String(inputMime || "").trim().toLowerCase();
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(normalized)) return normalized;
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  return "";
}

function clampImageRiskScore(value: unknown, approved?: boolean) {
  const score = Number(value);
  if (Number.isFinite(score)) return Math.max(0, Math.min(100, Math.round(score)));
  if (approved === true) return 0;
  if (approved === false) return 100;
  return 50;
}

function normalizeImageRiskLevel(value: unknown, score: number): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  if (score >= 70) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function normalizeImageDecision(
  approved: boolean | undefined,
  score: number,
  threshold: number,
): "auto_pass" | "block" {
  if (approved === true) return "auto_pass";
  if (approved === false) return "block";
  return score < threshold ? "auto_pass" : "block";
}

function fallbackImageReason(
  riskLevel: "low" | "medium" | "high",
  decision: "auto_pass" | "block",
) {
  if (decision === "auto_pass") return "图片审核通过";
  return riskLevel === "high" ? "图片风险较高，不适合公开展示" : "图片未通过审核";
}

function buildImageReviewDecision(
  parsed: ParsedImageReviewJson,
  threshold: number,
  model: string,
  endpoint: string,
): ImageReviewDecision {
  const riskScore = clampImageRiskScore(parsed.risk_score, parsed.approved);
  const riskLevel = normalizeImageRiskLevel(parsed.risk_level, riskScore);
  const decision = normalizeImageDecision(parsed.approved, riskScore, threshold);
  return {
    approved: decision === "auto_pass",
    reason: String(parsed.reason || fallbackImageReason(riskLevel, decision)).slice(0, 120),
    detail: buildImageDecisionDetail({
      riskScore,
      riskLevel,
      decision,
      categories: parsed.categories ?? {},
      detail: String(parsed.detail || "").slice(0, 1000),
      modelDecision: String(parsed.decision || "").trim(),
    }),
    riskLevel,
    riskScore,
    decision,
    model,
    endpoint,
  };
}

function buildImageDecisionDetail(input: {
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  decision: "auto_pass" | "block";
  categories?: Record<string, number>;
  detail?: string;
  modelDecision?: string;
}) {
  const topCategories = Object.entries(input.categories || {})
    .map(([name, value]) => [name, Number(value)] as const)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, value]) => `${name}:${Math.round(value)}`);
  return [
    `风险分：${input.riskScore}`,
    `风险等级：${input.riskLevel}`,
    `审核决策：${input.decision}`,
    input.modelDecision ? `模型原始决策：${input.modelDecision}` : "",
    topCategories.length ? `风险分类：${topCategories.join(" / ")}` : "",
    input.detail ? `补充说明：${input.detail}` : "",
  ].filter(Boolean).join("\n");
}

function buildBatchImageReviewPrompt(inputs: PreparedImageReviewInput[], promptTemplate: string) {
  const perImageInstructions = inputs.map((item, index) => [
    `# 第 ${index + 1} 张图片`,
    renderPromptTemplate(promptTemplate, {
      imageUrl: item.asset.url,
      mimeType: item.mimeType,
      fileName: path.basename(item.asset.localPath),
    }),
  ].join("\n"));
  return [
    "你将收到多张图片，请严格按照图片出现顺序逐张审核。",
    "你必须只返回一个 JSON 对象，格式如下：",
    "{\"results\":[{\"risk_score\":0-100,\"risk_level\":\"low|medium|high\",\"decision\":\"auto_pass|manual_review|block\",\"reason\":\"一句短原因\",\"detail\":\"补充说明\",\"categories\":{\"sexual\":0-100,\"minor\":0-100,\"violence\":0-100,\"self_harm\":0-100,\"privacy\":0-100,\"fraud\":0-100,\"hate\":0-100,\"gender_conflict\":0-100,\"extremism\":0-100}}]}",
    `要求：results 数组长度必须等于 ${inputs.length}，并且每一项都与对应序号的图片一一对应。`,
    "",
    ...perImageInstructions,
  ].join("\n\n");
}

function buildImageReviewConfigHash(config: ReturnType<typeof getSiteConfig>) {
  return hashString([
    config.imageReviewApiUrl,
    config.imageReviewModel,
    config.imageReviewFallbackModels,
    config.imageReviewThreshold,
    config.imageReviewSystemPrompt,
    config.imageReviewUserPrompt,
  ].join("\n"));
}

function buildImageReviewPromptCacheKey(input: {
  configHash: string;
  batchSize: number;
}) {
  return `image-review:${hashString(`${input.configHash}\n${input.batchSize}`)}`;
}

function hashString(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}
