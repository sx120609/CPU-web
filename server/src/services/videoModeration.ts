import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "../prisma";
import { runWithDistributedLock } from "./cache";
import { finishAiReviewLogError, finishAiReviewLogSuccess, startAiReviewLog } from "./aiReviewLog";
import { extractAiJsonTextResponse, normalizeAiJsonApiUrl, sendAiJsonRequest } from "./aiJsonApi";
import { prepareMediaLocalFileForProcessing, resolveMediaLocalPathFromUploadUrl, resolveMediaPublicUrl } from "./mediaStorage";
import { resolveModelCandidates, shouldFallbackToNextModel } from "./modelFallback";
import { DEFAULT_VIDEO_REVIEW_PROMPTS, getSiteConfig } from "./siteSettings";

const execFile = promisify(execFileCallback);

const VIDEO_BLOCK_RE = /<video\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))[^>]*>[\s\S]*?<\/video>(?:\s*<p>\s*<a\b[^>]*class=(?:"[^"]*\bqq-inline-video__link\b[^"]*"|'[^']*\bqq-inline-video__link\b[^']*')[\s\S]*?<\/a>\s*<\/p>)?/gi;
const LEGACY_ESCAPED_QQ_VIDEO_BLOCK_RE = /<p>\s*(&lt;div class=&quot;qq-video-card&quot;&gt;[\s\S]*?&lt;video class=&quot;qq-inline-video&quot;[\s\S]*?&lt;\/video&gt;[\s\S]*?&lt;\/div&gt;)\s*<\/p>/gi;
const VIDEO_REVIEW_POLL_INTERVAL_MS = 45_000;
const VIDEO_REVIEW_SWEEP_BATCH_SIZE = 120;
const VIDEO_FRAME_MAX_COUNT = 6;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const VIDEO_INLINE_FRAME_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_TRANSCRIPT_MAX_CHARS = 4000;
const VIDEO_TRANSCRIBE_MODEL = "whisper-1";

type Viewer = {
  userId?: number | null;
  role?: string | null;
} | null | undefined;

type VideoReviewDecision = {
  status: "approved" | "rejected" | "manual_review";
  reason: string;
  detail: string;
  riskLevel: "low" | "medium" | "high";
  riskScore: number;
  decision: "auto_pass" | "manual_review" | "block";
  model: string;
  endpoint: string;
};

type ParsedVideoReviewJson = {
  risk_score?: number;
  risk_level?: string;
  decision?: string;
  reason?: string;
  detail?: string;
  categories?: Record<string, number>;
};

type VideoFrameData = {
  filePath: string;
  dataUrl: string;
};

type PreparedVideoReviewInput = {
  asset: {
    id: number;
    url: string;
    localPath: string;
    mimeType: string | null;
    attemptCount: number;
  };
  metadata: {
    mimeType: string;
    durationMs: number;
    width: number;
    height: number;
    hasAudio: boolean;
  };
  transcript: string;
  transcriptStatus: string;
  frames: VideoFrameData[];
  context: {
    targetKind: "topic" | "reply" | "unknown";
    targetTitle: string;
    boardName: string;
    contextText: string;
  };
};

export type ForumVideoModerationSummary = {
  enabled: boolean;
  totalCount: number;
  pendingCount: number;
  rejectedCount: number;
  approvedCount: number;
  manualReviewCount: number;
};

export type ForumVideoSweepSummary = {
  reviewEnabled: boolean;
  scannedTopics: number;
  scannedReplies: number;
  videoReferences: number;
  uniqueVideoUrls: number;
  createdAssets: number;
  requeuedAssets: number;
  alreadyTracked: number;
  skippedAssets: number;
  pendingAfterScan: number;
  moderationTriggered: boolean;
};

export type ForumVideoReviewAsset = {
  id: number;
  url: string;
  status: string;
  reason: string | null;
  detail: string | null;
  reviewModel: string | null;
  reviewEndpoint: string | null;
  reviewedAt: Date | null;
  lastError: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  transcriptStatus: string | null;
  manualReviewedAt: Date | null;
  manualReviewNote: string | null;
  manualReviewedBy: {
    id: number;
    nickname: string;
    username: string;
  } | null;
};

export type ForumVideoQueueRow = {
  id: number;
  url: string;
  status: string;
  reason: string | null;
  detail: string | null;
  reviewedAt: Date | null;
  lastError: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  transcriptStatus: string | null;
  createdAt: Date;
  targetKind: "topic" | "reply" | "unknown";
  targetId: number | null;
  targetLabel: string;
  targetUrl: string;
};

let pollerStarted = false;
let moderationDrainBudget = 0;
let moderationDrainPromise: Promise<number> | null = null;
let forumVideoSweepPromise: Promise<ForumVideoSweepSummary> | null = null;

export function startForumVideoModerationPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  const tick = () => {
    triggerForumVideoModerationDrain(getVideoReviewDispatchCapacity())
      .catch((error: unknown) => {
        console.warn("[video-review] moderation tick failed", error);
      });
  };
  setTimeout(tick, 9_000);
  setInterval(tick, VIDEO_REVIEW_POLL_INTERVAL_MS);
}

export function shouldRunVideoReview() {
  const config = getSiteConfig();
  return Boolean(
    config.videoReviewEnabled
    && config.videoReviewApiKey.trim()
    && config.videoReviewModel.trim()
    && config.videoReviewApiUrl.trim(),
  );
}

export async function registerForumVideoAsset(input: {
  url: string;
  localPath?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  createdById?: number | null;
}) {
  const normalizedUrl = normalizeForumVideoUrl(input.url);
  if (!normalizedUrl) return null;
  const localPath = normalizeLocalUploadPath(input.localPath) || resolveForumVideoLocalPath(normalizedUrl);
  if (!localPath) return null;
  const existing = await prisma.forumVideoAsset.findUnique({
    where: { url: normalizedUrl },
    select: { id: true, status: true, reviewModel: true, reviewEndpoint: true },
  });
  if (existing) {
    const shouldRequeue = shouldRunVideoReview()
      && (
        existing.status === "error"
        || (
          ["approved", "rejected"].includes(existing.status)
          && (existing.reviewModel === "bypass" || existing.reviewEndpoint === "disabled")
        )
      );
    return prisma.forumVideoAsset.update({
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
  const enabled = shouldRunVideoReview();
  return prisma.forumVideoAsset.create({
    data: {
      url: normalizedUrl,
      localPath,
      mimeType: input.mimeType || null,
      fileSize: input.fileSize ?? null,
      createdById: input.createdById ?? null,
      status: enabled ? "pending" : "approved",
      reviewedAt: enabled ? null : new Date(),
      reason: enabled ? null : "视频审核未启用",
      reviewModel: enabled ? null : "bypass",
      reviewEndpoint: enabled ? null : "disabled",
    },
  });
}

export async function ensureForumVideoAssetsForContent(content: string, createdById?: number | null) {
  const urls = extractForumVideoUrls(content);
  if (!urls.length) return [];
  const tasks = urls.map((url) => registerForumVideoAsset({ url, createdById: createdById ?? null }));
  return Promise.all(tasks);
}

export async function backfillForumVideoAssetsAndTriggerModeration() {
  if (!forumVideoSweepPromise) {
    forumVideoSweepPromise = performForumVideoSweep().finally(() => {
      forumVideoSweepPromise = null;
    });
  }
  return forumVideoSweepPromise;
}

export async function moderatePendingForumVideos(limit = getVideoReviewDispatchCapacity()) {
  if (!shouldRunVideoReview()) return { processed: 0 };
  const now = new Date();
  const take = Math.max(1, Math.floor(Number(limit) || getVideoReviewDispatchCapacity()));
  const list = await prisma.forumVideoAsset.findMany({
    where: {
      OR: [
        { status: "pending" },
        { status: "error", nextRetryAt: { lte: now } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
  });
  const concurrency = getVideoReviewConcurrency();
  for (let index = 0; index < list.length; index += concurrency) {
    const wave = list.slice(index, index + concurrency);
    const results = await Promise.allSettled(wave.map((asset) => moderateSingleForumVideo(asset)));
    const rejected = results.filter((item) => item.status === "rejected");
    if (rejected.length) {
      rejected.forEach((item) => {
        console.warn("[video-review] video moderation job failed", item.reason);
      });
    }
  }
  return { processed: list.length };
}

export async function summarizeForumVideoModerationForContent(content: string): Promise<ForumVideoModerationSummary> {
  const urls = extractForumVideoUrls(content);
  if (!urls.length) {
    return {
      enabled: shouldRunVideoReview(),
      totalCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
      approvedCount: 0,
      manualReviewCount: 0,
    };
  }
  const rows = await prisma.forumVideoAsset.findMany({
    where: { url: { in: urls } },
    select: { url: true, status: true, reason: true, lastError: true },
  });
  const rowMap = new Map(rows.map((row) => [row.url, row]));
  const missing = urls.filter((url) => !rowMap.has(url));
  if (missing.length) {
    const created = await Promise.all(missing.map((url) => registerForumVideoAsset({ url })));
    created.forEach((item, index) => {
      rowMap.set(missing[index], {
        url: missing[index],
        status: item?.status || (shouldRunVideoReview() ? "pending" : "approved"),
        reason: item?.reason || null,
        lastError: item?.lastError || null,
      });
    });
  }
  let pendingCount = 0;
  let rejectedCount = 0;
  let approvedCount = 0;
  let manualReviewCount = 0;
  for (const url of urls) {
    const normalized = normalizeForumVideoAssetState(rowMap.get(url));
    if (normalized.status === "approved") approvedCount += 1;
    else if (normalized.status === "rejected") rejectedCount += 1;
    else if (normalized.status === "manual_review") manualReviewCount += 1;
    else pendingCount += 1;
  }
  return {
    enabled: shouldRunVideoReview(),
    totalCount: urls.length,
    pendingCount,
    rejectedCount,
    approvedCount,
    manualReviewCount,
  };
}

export async function decorateTopicForViewerWithVideoModeration(topic: any, viewer?: Viewer) {
  const videoReview = await summarizeForumVideoModerationForContent(topic.content);
  return {
    ...topic,
    videoReview,
    content: await renderModeratedVideoContent(topic.content, viewer),
  };
}

export async function decorateReplyForViewerWithVideoModeration(reply: any, viewer?: Viewer) {
  const videoReview = await summarizeForumVideoModerationForContent(reply.content);
  return {
    ...reply,
    videoReview,
    content: await renderModeratedVideoContent(reply.content, viewer),
  };
}

export async function listForumVideoAssetsForContent(content: string): Promise<ForumVideoReviewAsset[]> {
  const urls = extractForumVideoUrls(content);
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
    durationMs: true,
    width: true,
    height: true,
    hasAudio: true,
    transcriptStatus: true,
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

  const initialRows = await prisma.forumVideoAsset.findMany({
    where: { url: { in: urls } },
    select,
  });
  const initialMap = new Map(initialRows.map((row) => [row.url, row]));
  const missing = urls.filter((url) => !initialMap.has(url));
  if (missing.length) {
    await Promise.all(missing.map((url) => registerForumVideoAsset({ url }))).catch(() => null);
  }
  const rows = missing.length
    ? await prisma.forumVideoAsset.findMany({ where: { url: { in: urls } }, select })
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
      durationMs: row!.durationMs,
      width: row!.width,
      height: row!.height,
      hasAudio: row!.hasAudio,
      transcriptStatus: row!.transcriptStatus,
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

export async function applyManualForumVideoReview(input: {
  assetId: number;
  reviewerId: number;
  approved: boolean;
  note?: string | null;
}) {
  const existing = await prisma.forumVideoAsset.findUnique({
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

  return prisma.forumVideoAsset.update({
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

export async function renderModeratedVideoContent(content: string, _viewer?: Viewer) {
  const normalizedContent = repairLegacyEscapedQqVideoBlocks(content);
  const matches = collectVideoMatches(normalizedContent);
  if (!matches.length) return normalizedContent;
  const localUrls = Array.from(new Set(matches.map((item) => normalizeForumVideoUrl(item.url)).filter(Boolean) as string[]));
  if (!localUrls.length) return normalizedContent;

  const rows = await prisma.forumVideoAsset.findMany({
    where: { url: { in: localUrls } },
    select: { url: true, status: true, reason: true, lastError: true },
  });
  const rowMap = new Map(rows.map((row) => [row.url, row]));
  const missing = localUrls.filter((url) => !rowMap.has(url));
  if (missing.length) {
    const created = await Promise.all(missing.map((url) => registerForumVideoAsset({ url })));
    missing.forEach((url, index) => {
      const row = created[index];
      rowMap.set(url, {
        url,
        status: row?.status || (shouldRunVideoReview() ? "pending" : "approved"),
        reason: row?.reason || null,
        lastError: row?.lastError || null,
      } as any);
    });
  }

  const visibleUrls = localUrls.filter((url) => {
    const normalized = normalizeForumVideoAssetState(rowMap.get(url));
    if (!shouldRunVideoReview() && normalized.status !== "rejected") return true;
    return normalized.status === "approved";
  });
  const publicUrlMap = new Map<string, string>();
  await Promise.all(visibleUrls.map(async (url) => {
    publicUrlMap.set(url, await resolveMediaPublicUrl(url));
  }));

  let rendered = "";
  let lastIndex = 0;
  for (const match of matches) {
    rendered += normalizedContent.slice(lastIndex, match.index);
    const normalizedUrl = normalizeForumVideoUrl(match.url);
    const row = normalizedUrl ? rowMap.get(normalizedUrl) : null;
    rendered += rewriteVideoToken(match, row, normalizedUrl ? publicUrlMap.get(normalizedUrl) : "");
    lastIndex = match.index + match.raw.length;
  }
  rendered += normalizedContent.slice(lastIndex);
  return rendered;
}

export async function listForumVideoQueue(params?: {
  status?: "pending" | "manual_review" | "rejected" | "approved" | "error";
  page?: number;
  size?: number;
}) {
  const page = Math.max(1, Number(params?.page || 1));
  const size = Math.min(100, Math.max(1, Number(params?.size || 20)));
  const where = params?.status ? { status: params.status } : {
    status: { in: ["pending", "manual_review", "error", "rejected"] },
  };
  const [list, total] = await Promise.all([
    prisma.forumVideoAsset.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * size,
      take: size,
      select: {
        id: true,
        url: true,
        status: true,
        reason: true,
        detail: true,
        reviewedAt: true,
        lastError: true,
        durationMs: true,
        width: true,
        height: true,
        hasAudio: true,
        transcriptStatus: true,
        createdAt: true,
      },
    }),
    prisma.forumVideoAsset.count({ where }),
  ]);

  const enriched = await Promise.all(list.map(async (row) => {
    const target = await findVideoReviewTargetByUrl(row.url);
    return {
      id: row.id,
      url: row.url,
      status: row.status,
      reason: row.reason,
      detail: row.detail,
      reviewedAt: row.reviewedAt,
      lastError: row.lastError,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      hasAudio: row.hasAudio,
      transcriptStatus: row.transcriptStatus,
      createdAt: row.createdAt,
      targetKind: target.targetKind,
      targetId: target.targetId,
      targetLabel: target.targetLabel,
      targetUrl: target.targetUrl,
    } satisfies ForumVideoQueueRow;
  }));
  return { page, size, total, list: enriched };
}

async function moderateSingleForumVideo(asset: {
  id: number;
  url: string;
  localPath: string;
  mimeType: string | null;
  attemptCount: number;
}) {
  try {
    const prepared = await prepareVideoReviewInput(asset);
    const decision = await requestVideoReview(prepared);
    await applyVideoReviewDecision(prepared, decision);
  } catch (error: any) {
    await markVideoReviewError(asset, error);
  }
}

async function prepareVideoReviewInput(asset: {
  id: number;
  url: string;
  localPath: string;
  mimeType: string | null;
  attemptCount: number;
}): Promise<PreparedVideoReviewInput> {
  const now = new Date();
  await prisma.forumVideoAsset.update({
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
  const tempDir = path.resolve(process.cwd(), "runtime", "video-review", `${asset.id}-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  try {
    const file = await stat(localPath);
    if (!file.isFile()) throw new Error("视频文件不存在");
    if (!file.size || file.size > VIDEO_MAX_BYTES) {
      throw new Error(file.size ? "视频文件过大，暂不支持自动审核" : "视频文件为空");
    }

    const metadata = await probeVideoFile(localPath, asset.mimeType);
    const transcript = metadata.hasAudio ? await transcribeVideoAudio(localPath).catch(() => ({
      text: "",
      status: "error",
    })) : { text: "", status: "missing-audio" };
    const context = await findVideoReviewTargetByUrl(asset.url);
    if (!preparedFile.temporary && localPath !== asset.localPath) {
      await prisma.forumVideoAsset.update({
        where: { id: asset.id },
        data: { localPath },
      }).catch(() => null);
    }

    const framePaths = await extractVideoFrames(localPath, metadata.durationMs, tempDir);
    const frames = await buildFrameDataUrls(framePaths);
    if (!frames.length) throw new Error("视频抽帧失败，无法自动审核");
    return {
      asset: {
        ...asset,
        localPath,
      },
      metadata,
      transcript: transcript.text.slice(0, VIDEO_TRANSCRIPT_MAX_CHARS),
      transcriptStatus: transcript.status,
      frames,
      context: {
        targetKind: context.targetKind,
        targetTitle: context.targetLabel,
        boardName: context.boardName,
        contextText: context.contextText,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => null);
    if (preparedFile.temporary && preparedFile.localPath) {
      await rm(preparedFile.localPath, { force: true }).catch(() => null);
    }
  }
}

async function applyVideoReviewDecision(input: PreparedVideoReviewInput, decision: VideoReviewDecision) {
  await prisma.forumVideoAsset.update({
    where: { id: input.asset.id },
    data: {
      status: decision.status,
      reason: decision.reason,
      detail: buildVideoDecisionDetail({
        detail: decision.detail,
        frameCount: input.frames.length,
        transcriptStatus: input.transcriptStatus,
      }),
      reviewModel: decision.model,
      reviewEndpoint: decision.endpoint,
      reviewedAt: new Date(),
      nextRetryAt: null,
      lastError: null,
      mimeType: input.metadata.mimeType,
      durationMs: input.metadata.durationMs,
      width: input.metadata.width,
      height: input.metadata.height,
      hasAudio: input.metadata.hasAudio,
      transcript: input.transcript || null,
      transcriptStatus: input.transcriptStatus || null,
    },
  });
}

async function requestVideoReview(input: PreparedVideoReviewInput): Promise<VideoReviewDecision> {
  const config = getSiteConfig();
  const endpoint = normalizeAiJsonApiUrl(config.videoReviewApiUrl, "https://api.openai.com/v1/chat/completions");
  const requestSummary = buildVideoReviewTextPrompt(input).slice(0, 4000);
  const candidates = resolveModelCandidates(config.videoReviewModel, config.videoReviewFallbackModels);
  const promptCacheKey = buildVideoReviewPromptCacheKey({
    configHash: buildVideoReviewConfigHash(config),
    frameCount: input.frames.length,
  });
  let lastError: Error | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const started = await startAiReviewLog({
      kind: "video",
      targetLabel: path.basename(input.asset.localPath),
      targetUrl: input.asset.url,
      provider: "video-review",
      model,
      endpoint,
      requestSummary,
    });
    const logId = started?.id ?? null;
    const requestResult = await sendAiJsonRequest({
      endpoint,
      apiKey: config.videoReviewApiKey,
      model,
      temperature: 0.1,
      promptCacheKey,
      enablePromptCacheRetention: true,
      messages: [
        { role: "system", content: config.videoReviewSystemPrompt || DEFAULT_VIDEO_REVIEW_PROMPTS.system },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildVideoReviewTextPrompt(input),
            },
            ...input.frames.map((frame) => ({
              type: "image_url" as const,
              image_url: {
                url: frame.dataUrl,
                detail: "low" as const,
              },
            })),
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
          status: "rejected" as const,
          reason: "视频未通过平台内容安全检查",
          detail: buildVideoReviewSummaryDetail({
            riskScore: 100,
            riskLevel: "high",
            decision: "block",
            categories: { provider_policy: 100 },
            detail: providerBlock.message || "上游审核接口直接拦截了该视频请求",
            providerErrorCode: providerBlock.code,
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
        lastError = new Error(`视频审核模型 ${model} 当前不可用，已自动切换备选模型`);
        continue;
      }
      throw new Error(`视频审核请求失败：${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
    }
    const json: any = await response.json();
    const content = extractAiJsonTextResponse(json, requestResult.mode);
    await finishAiReviewLogSuccess(logId, content);
    return buildVideoReviewDecision(parseVideoReviewJson(content), config.videoReviewThreshold, model, endpoint);
  }
  throw lastError || new Error("视频审核请求失败");
}

async function transcribeVideoAudio(filePath: string) {
  const config = getSiteConfig();
  const endpoint = normalizeTranscriptionsUrl(config.videoReviewApiUrl);
  const tempDir = path.resolve(process.cwd(), "runtime", "video-review-audio");
  await mkdir(tempDir, { recursive: true });
  const audioPath = path.join(tempDir, `${path.basename(filePath)}-${Date.now()}.wav`);
  try {
    await execFile("ffmpeg", [
      "-y",
      "-i",
      filePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-acodec",
      "pcm_s16le",
      audioPath,
    ]);
    const audioBuffer = await readFile(audioPath);
    if (!audioBuffer.length) return { text: "", status: "empty" };
    const form = new FormData();
    form.append("model", VIDEO_TRANSCRIBE_MODEL);
    form.append("response_format", "json");
    form.append("file", new Blob([audioBuffer], { type: "audio/wav" }), "video-audio.wav");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.videoReviewApiKey}`,
      },
      body: form,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`音频转写失败：${response.status}${text ? ` ${text.slice(0, 160)}` : ""}`);
    }
    const json: any = await response.json();
    const text = String(json?.text || "").trim();
    return {
      text,
      status: text ? "ok" : "empty",
    };
  } finally {
    await rm(audioPath, { force: true }).catch(() => null);
  }
}

async function probeVideoFile(filePath: string, inputMime: string | null | undefined) {
  const { stdout } = await execFile("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  const parsed = JSON.parse(String(stdout || "{}")) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
    format?: { duration?: string };
  };
  const videoStream = (parsed.streams || []).find((item) => item.codec_type === "video");
  const audioStream = (parsed.streams || []).find((item) => item.codec_type === "audio");
  const durationSeconds = Number(videoStream?.duration || parsed.format?.duration || 0);
  return {
    mimeType: normalizeVideoMimeType(inputMime, filePath),
    durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : 0,
    width: Number(videoStream?.width || 0),
    height: Number(videoStream?.height || 0),
    hasAudio: Boolean(audioStream),
  };
}

async function extractVideoFrames(filePath: string, durationMs: number, tempDir: string) {
  const timestamps = selectFrameTimestamps(durationMs);
  const framePaths: string[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const framePath = path.join(tempDir, `frame-${index + 1}.jpg`);
    await execFile("ffmpeg", [
      "-y",
      "-ss",
      timestamps[index].toFixed(3),
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      framePath,
    ]);
    framePaths.push(framePath);
  }
  return framePaths;
}

async function buildFrameDataUrls(framePaths: string[]) {
  const frames: VideoFrameData[] = [];
  let totalBytes = 0;
  for (const filePath of framePaths) {
    const buffer = await readFile(filePath).catch(() => null);
    if (!buffer?.length) continue;
    totalBytes += buffer.length;
    if (totalBytes > VIDEO_INLINE_FRAME_MAX_BYTES && frames.length) break;
    frames.push({
      filePath,
      dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
    });
  }
  return frames;
}

function selectFrameTimestamps(durationMs: number) {
  const durationSec = Math.max(1, durationMs / 1000 || 1);
  const count: number = durationSec >= 90 ? VIDEO_FRAME_MAX_COUNT : durationSec >= 30 ? 5 : 3;
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const ratio = (index + 1) / (count + 1);
    out.push(Math.max(0, Number((durationSec * ratio).toFixed(3))));
  }
  return Array.from(new Set(out));
}

async function findVideoReviewTargetByUrl(url: string) {
  const topic = await prisma.topic.findFirst({
    where: { content: { contains: url } },
    select: {
      id: true,
      title: true,
      content: true,
      board: { select: { name: true } },
    },
  });
  if (topic) {
    return {
      targetKind: "topic" as const,
      targetId: topic.id,
      targetLabel: topic.title || "帖子视频",
      targetUrl: `/forum/topic/${topic.id}`,
      boardName: topic.board?.name || "",
      contextText: trimContextText(topic.content),
    };
  }
  const reply = await prisma.reply.findFirst({
    where: { content: { contains: url } },
    select: {
      id: true,
      topicId: true,
      content: true,
      topic: { select: { title: true, board: { select: { name: true } } } },
    },
  });
  if (reply) {
    return {
      targetKind: "reply" as const,
      targetId: reply.id,
      targetLabel: reply.topic?.title || `回复 #${reply.id}`,
      targetUrl: `/forum/topic/${reply.topicId}#reply-${reply.id}`,
      boardName: reply.topic?.board?.name || "",
      contextText: trimContextText(reply.content),
    };
  }
  return {
    targetKind: "unknown" as const,
    targetId: null,
    targetLabel: path.basename(url),
    targetUrl: "",
    boardName: "",
    contextText: "",
  };
}

function buildVideoReviewTextPrompt(input: PreparedVideoReviewInput) {
  const config = getSiteConfig();
  return renderPromptTemplate(config.videoReviewUserPrompt || DEFAULT_VIDEO_REVIEW_PROMPTS.user, {
    videoUrl: input.asset.url,
    mimeType: input.metadata.mimeType,
    fileName: path.basename(input.asset.localPath),
    durationSeconds: (input.metadata.durationMs / 1000).toFixed(1),
    resolution: input.metadata.width && input.metadata.height ? `${input.metadata.width}x${input.metadata.height}` : "未知",
    hasAudio: input.metadata.hasAudio ? "是" : "否",
    targetKind: input.context.targetKind,
    boardName: input.context.boardName || "未知",
    targetTitle: input.context.targetTitle || "无",
    contextText: input.context.contextText || "无",
    transcript: input.transcript || "无可用转写",
  });
}

function buildVideoReviewConfigHash(config: ReturnType<typeof getSiteConfig>) {
  return hashString([
    config.videoReviewApiUrl,
    config.videoReviewModel,
    config.videoReviewFallbackModels,
    config.videoReviewThreshold,
    config.videoReviewSystemPrompt || DEFAULT_VIDEO_REVIEW_PROMPTS.system,
    config.videoReviewUserPrompt || DEFAULT_VIDEO_REVIEW_PROMPTS.user,
  ].join("\n"));
}

function buildVideoReviewPromptCacheKey(input: {
  configHash: string;
  frameCount: number;
}) {
  return `video-review:${hashString(`${input.configHash}\n${input.frameCount}`)}`;
}

function hashString(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

function buildVideoReviewDecision(
  parsed: ParsedVideoReviewJson,
  threshold: number,
  model: string,
  endpoint: string,
): VideoReviewDecision {
  const riskScore = clampRiskScore(parsed.risk_score);
  const riskLevel = normalizeRiskLevel(parsed.risk_level, riskScore);
  const decision = normalizeVideoDecision(parsed.decision, riskScore, threshold);
  return {
    status: decision === "auto_pass" ? "approved" : decision === "block" ? "rejected" : "manual_review",
    reason: String(parsed.reason || fallbackVideoReason(riskLevel, decision)).slice(0, 120),
    detail: buildVideoReviewSummaryDetail({
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

async function performForumVideoSweep(): Promise<ForumVideoSweepSummary> {
  let scannedTopics = 0;
  let scannedReplies = 0;
  let videoReferences = 0;
  const uniqueUrls = new Set<string>();

  let lastTopicId = 0;
  for (;;) {
    const rows = await prisma.topic.findMany({
      where: { id: { gt: lastTopicId } },
      orderBy: { id: "asc" },
      take: VIDEO_REVIEW_SWEEP_BATCH_SIZE,
      select: { id: true, content: true },
    });
    if (!rows.length) break;
    scannedTopics += rows.length;
    for (const row of rows) {
      const urls = extractForumVideoUrls(row.content);
      videoReferences += urls.length;
      urls.forEach((url) => uniqueUrls.add(url));
    }
    lastTopicId = rows[rows.length - 1].id;
  }

  let lastReplyId = 0;
  for (;;) {
    const rows = await prisma.reply.findMany({
      where: { id: { gt: lastReplyId } },
      orderBy: { id: "asc" },
      take: VIDEO_REVIEW_SWEEP_BATCH_SIZE,
      select: { id: true, content: true },
    });
    if (!rows.length) break;
    scannedReplies += rows.length;
    for (const row of rows) {
      const urls = extractForumVideoUrls(row.content);
      videoReferences += urls.length;
      urls.forEach((url) => uniqueUrls.add(url));
    }
    lastReplyId = rows[rows.length - 1].id;
  }

  const reviewEnabled = shouldRunVideoReview();
  const urls = Array.from(uniqueUrls);
  let createdAssets = 0;
  let requeuedAssets = 0;
  let alreadyTracked = 0;
  let skippedAssets = 0;

  for (let index = 0; index < urls.length; index += VIDEO_REVIEW_SWEEP_BATCH_SIZE) {
    const chunk = urls.slice(index, index + VIDEO_REVIEW_SWEEP_BATCH_SIZE);
    const existingRows = await prisma.forumVideoAsset.findMany({
      where: { url: { in: chunk } },
      select: { url: true, status: true, reviewModel: true, reviewEndpoint: true },
    });
    const existingMap = new Map(existingRows.map((row) => [row.url, row]));
    const results = await Promise.all(chunk.map((url) => registerForumVideoAsset({ url })));
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
        && (
          previous.status === "error"
          || (
            ["approved", "rejected"].includes(previous.status)
            && (previous.reviewModel === "bypass" || previous.reviewEndpoint === "disabled")
          )
        )
        && row.status === "pending";
      if (requeued) requeuedAssets += 1;
      else alreadyTracked += 1;
    });
  }

  const pendingAfterScan = reviewEnabled
    ? await prisma.forumVideoAsset.count({
        where: {
          OR: [
            { status: "pending" },
            { status: "error" },
          ],
        },
      })
    : 0;
  if (reviewEnabled && pendingAfterScan > 0) {
    triggerForumVideoModerationDrain(Math.min(pendingAfterScan, getVideoReviewDispatchCapacity())).catch(() => null);
  }
  return {
    reviewEnabled,
    scannedTopics,
    scannedReplies,
    videoReferences,
    uniqueVideoUrls: urls.length,
    createdAssets,
    requeuedAssets,
    alreadyTracked,
    skippedAssets,
    pendingAfterScan,
    moderationTriggered: reviewEnabled && pendingAfterScan > 0,
  };
}

function triggerForumVideoModerationDrain(limit: number) {
  moderationDrainBudget = Math.max(moderationDrainBudget, Math.floor(limit) || 0);
  if (!moderationDrainPromise) {
    moderationDrainPromise = drainForumVideoModerationQueue().finally(() => {
      moderationDrainPromise = null;
    });
  }
  return moderationDrainPromise;
}

async function drainForumVideoModerationQueue() {
  const locked = await runWithDistributedLock("forum-video-review:drain", 180_000, async () => {
    let processed = 0;
    while (moderationDrainBudget > 0) {
      const batchLimit = moderationDrainBudget;
      moderationDrainBudget = 0;
      const result = await moderatePendingForumVideos(batchLimit);
      processed += result.processed;
      if (result.processed < batchLimit) {
        moderationDrainBudget = 0;
        break;
      }
    }
    return processed;
  });
  return locked.result ?? 0;
}

function getVideoReviewConcurrency() {
  const config = getSiteConfig();
  const base = Math.max(1, Math.floor(Number(config.videoReviewConcurrency) || 1));
  return Math.min(2, base);
}

function getVideoReviewDispatchCapacity() {
  return getVideoReviewConcurrency();
}

function rewriteVideoToken(
  match: { raw: string; url: string },
  row?: { status?: string | null; reason?: string | null; lastError?: string | null } | null,
  publicUrl?: string,
) {
  const normalized = normalizeForumVideoAssetState(row);
  if (!shouldRunVideoReview() && normalized.status !== "rejected") {
    return rewriteVisibleVideoToken(match, publicUrl);
  }
  if (normalized.status === "approved") {
    return rewriteVisibleVideoToken(match, publicUrl);
  }
  if (normalized.status === "manual_review") {
    return buildVideoReviewPlaceholder("manual_review", normalized.reason || "视频待人工审核");
  }
  if (normalized.status === "error") {
    return buildVideoReviewPlaceholder("error", normalized.reason || "视频审核异常");
  }
  if (normalized.status === "rejected") {
    return buildVideoReviewPlaceholder("rejected", normalized.reason || "未通过视频审核");
  }
  return buildVideoReviewPlaceholder("pending");
}

function rewriteVisibleVideoToken(match: { raw: string; url: string }, publicUrl?: string) {
  const target = String(publicUrl || "").trim();
  if (!target || target === match.url) return match.raw;
  return match.raw.split(match.url).join(escapeHtmlAttribute(target));
}

function collectVideoMatches(content: string) {
  const items: Array<{ raw: string; url: string; index: number }> = [];
  for (const match of content.matchAll(VIDEO_BLOCK_RE)) {
    items.push({
      raw: match[0],
      url: match[1] || match[2] || match[3] || "",
      index: match.index ?? 0,
    });
  }
  return items.sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);
}

function extractForumVideoUrls(content: string) {
  const normalizedContent = repairLegacyEscapedQqVideoBlocks(content);
  return Array.from(new Set(
    collectVideoMatches(normalizedContent)
      .map((item) => normalizeForumVideoUrl(item.url))
      .filter(Boolean) as string[],
  ));
}

function repairLegacyEscapedQqVideoBlocks(content: string) {
  const raw = String(content || "");
  if (!raw.includes("&lt;div class=&quot;qq-video-card&quot;&gt;")) return raw;
  return raw.replace(LEGACY_ESCAPED_QQ_VIDEO_BLOCK_RE, (block, encoded) => {
    const decoded = decodeLegacyEscapedQqVideoHtml(String(encoded || ""))
      .replace(/<br\s*\/?>/gi, "\n")
      .trim();
    return decoded || block;
  });
}

function decodeLegacyEscapedQqVideoHtml(content: string) {
  return String(content || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeForumVideoUrl(input: string | null | undefined) {
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

function resolveForumVideoLocalPath(url: string) {
  const normalized = normalizeForumVideoUrl(url);
  if (!normalized.startsWith("/uploads/")) return "";
  return resolveMediaLocalPathFromUploadUrl(normalized);
}

function normalizeLocalUploadPath(input: string | null | undefined) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return path.resolve(raw);
}

function normalizeForumVideoAssetState(row?: { status?: string | null; reason?: string | null; lastError?: string | null } | null) {
  const status = String(row?.status || "").trim().toLowerCase();
  if (status === "approved") {
    return { status: "approved" as const, reason: row?.reason || null };
  }
  if (status === "rejected") {
    return { status: "rejected" as const, reason: row?.reason || "未通过视频审核" };
  }
  if (status === "manual_review") {
    return { status: "manual_review" as const, reason: row?.reason || "视频待人工审核" };
  }
  if (status === "error") {
    return { status: "error" as const, reason: row?.lastError || row?.reason || "视频审核异常" };
  }
  return { status: "pending" as const, reason: row?.reason || null };
}

function buildVideoReviewPlaceholder(status: "pending" | "rejected" | "manual_review" | "error", reason?: string | null) {
  if (status === "rejected") {
    return `<span class="video-review-placeholder video-review-placeholder-rejected" data-video-review-state="rejected">[视频未通过审核，已隐藏${reason ? `：${escapeHtml(reason)}` : ""}]</span>`;
  }
  if (status === "manual_review") {
    return `<span class="video-review-placeholder video-review-placeholder-manual" data-video-review-state="manual_review">[视频待人工审核${reason ? `：${escapeHtml(reason)}` : ""}]</span>`;
  }
  if (status === "error") {
    return `<span class="video-review-placeholder video-review-placeholder-error" data-video-review-state="error">[视频审核异常，暂不可查看${reason ? `：${escapeHtml(reason)}` : ""}]</span>`;
  }
  return '<span class="video-review-placeholder video-review-placeholder-pending" data-video-review-state="pending">[视频审核中，暂时不可查看]</span>';
}

function trimContextText(content: string) {
  return String(content || "")
    .replace(/<video[\s\S]*?<\/video>/gi, " [视频] ")
    .replace(/<img\b[^>]*>/gi, " [图片] ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
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

function normalizeTranscriptionsUrl(input: string) {
  return normalizeAiJsonApiUrl(input, "https://api.openai.com/v1/chat/completions")
    .replace(/\/(?:chat\/completions|responses)$/i, "/audio/transcriptions");
}

function parseVideoReviewJson(content: string): ParsedVideoReviewJson {
  if (!content || typeof content !== "string") throw new Error("视频审核返回为空");
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // ignore
      }
    }
    throw new Error("视频审核返回格式异常");
  }
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

function normalizeVideoMimeType(inputMime: string | null | undefined, filePath: string) {
  const normalized = String(inputMime || "").trim().toLowerCase();
  if (normalized.startsWith("video/")) return normalized;
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  const mimeMap: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
  };
  return mimeMap[ext] || "video/mp4";
}

function clampRiskScore(value: unknown) {
  const score = Number(value);
  if (Number.isFinite(score)) return Math.max(0, Math.min(100, Math.round(score)));
  return 50;
}

function normalizeRiskLevel(value: unknown, score: number): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  if (score >= 70) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function normalizeVideoDecision(
  rawDecision: unknown,
  score: number,
  threshold: number,
): "auto_pass" | "manual_review" | "block" {
  if (score < threshold) return "auto_pass";
  if (rawDecision === "block") return "block";
  if (rawDecision === "manual_review") return "manual_review";
  if (rawDecision === "auto_pass") return "manual_review";
  if (score >= Math.max(threshold + 24, 70)) return "block";
  return "manual_review";
}

function fallbackVideoReason(
  riskLevel: "low" | "medium" | "high",
  decision: "auto_pass" | "manual_review" | "block",
) {
  if (decision === "auto_pass") return "视频审核通过";
  if (decision === "manual_review") return "视频需要人工复核";
  return riskLevel === "high" ? "视频风险较高，不适合公开展示" : "视频未通过审核";
}

function buildVideoReviewSummaryDetail(input: {
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  decision: "auto_pass" | "manual_review" | "block";
  categories?: Record<string, number>;
  detail?: string;
  modelDecision?: string;
  providerErrorCode?: string;
}) {
  const topCategories = Object.entries(input.categories || {})
    .map(([name, value]) => [name, Number(value)] as const)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => `${name}:${Math.round(value)}`);
  return [
    `风险分：${input.riskScore}`,
    `风险等级：${input.riskLevel}`,
    `审核决策：${input.decision}`,
    input.modelDecision ? `模型原始决策：${input.modelDecision}` : "",
    input.providerErrorCode ? `平台拦截码：${input.providerErrorCode}` : "",
    topCategories.length ? `风险分类：${topCategories.join(" / ")}` : "",
    input.detail ? `补充说明：${String(input.detail).slice(0, 1000)}` : "",
  ].filter(Boolean).join("\n");
}

function buildVideoDecisionDetail(input: {
  detail: string;
  frameCount: number;
  transcriptStatus: string;
}) {
  return [
    input.detail,
    `关键帧数：${input.frameCount}`,
    `转写状态：${input.transcriptStatus || "none"}`,
  ].filter(Boolean).join("\n");
}

async function markVideoReviewError(asset: { id: number; attemptCount: number }, error: unknown) {
  const delayMinutes = Math.min(90, Math.max(5, asset.attemptCount * 8 || 5));
  await prisma.forumVideoAsset.update({
    where: { id: asset.id },
    data: {
      status: "error",
      lastError: String((error as any)?.message || error || "视频审核失败").slice(0, 500),
      nextRetryAt: new Date(Date.now() + delayMinutes * 60 * 1000),
    },
  });
}
