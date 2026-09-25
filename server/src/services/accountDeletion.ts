import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { encryptJwxtSensitiveJson, decryptJwxtSensitiveJson } from "./jwxtSessionCrypto";
import { collectAccountSessions, credentialHash, deleteAccountSessions } from "./accountDeletionSessions";
import { deleteMediaAsset } from "./mediaStorage";
import { invalidateForumCaches } from "./cacheInvalidation";
import { refreshBoardTopicCounts, refreshTopicReplyStats } from "./forumStats";
import { voiceHubProxyConfig } from "./voiceHubProxy";
import { purgeAccountMediaCaches } from "./accountDeletionCdn";

export const ACCOUNT_DELETION_CONFIRMATION = "删除我的账户";
type DeletionPayload = { username: string; tokens: string[]; sessionKeys: string[]; mediaPaths: string[]; receipt: string };
function receiptHash(receipt: string) { return createHash("sha256").update(receipt).digest("hex"); }
function encryptPayload(userId: number, payload: DeletionPayload) { return encryptJwxtSensitiveJson("account-deletion", String(userId), payload); }
function decodePayload(job: { userId: number; encryptedPayload: string | null }) {
  if (!job.encryptedPayload) throw new Error("Deletion payload missing");
  return decryptJwxtSensitiveJson<DeletionPayload>("account-deletion", String(job.userId), job.encryptedPayload).value;
}

export async function requestAccountDeletion(userId: number, currentJwxtToken?: string, clientReceipt?: string) {
  if (clientReceipt && !/^[A-Za-z0-9_-]{43}$/.test(clientReceipt)) throw Errors.badRequest("删除回执格式不正确");
  const existing = await prisma.accountDeletionJob.findUnique({ where: { userId } });
  if (existing) throw Errors.conflict("账户已提交删除，请使用保存的删除回执查看进度");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || ["deleting", "deleted"].includes(user.status)) throw Errors.unauthorized();
  const sessions = await collectAccountSessions(userId, currentJwxtToken);
  const receipt = clientReceipt || randomBytes(32).toString("base64url");
  const job = await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({ where: { id: userId, status: { notIn: ["deleting", "deleted"] } }, data: { status: "deleting", aiConsentVersion: null, aiConsentAgreedAt: null } });
    if (!changed.count) throw Errors.conflict("账户已提交删除");
    await tx.scheduleWidgetToken.updateMany({ where: { userId }, data: { revokedAt: new Date(), cachedPayload: null, cachedAt: null } });
    await tx.oAuthAccessToken.deleteMany({ where: { userId } });
    await tx.oAuthAuthorizationCode.deleteMany({ where: { userId } });
    if (sessions.tokens.length) await tx.accountRevokedCredential.createMany({ data: sessions.tokens.map((token) => ({ tokenHash: credentialHash(token) })), skipDuplicates: true });
    return tx.accountDeletionJob.create({ data: { userId, receiptHash: receiptHash(receipt), encryptedPayload: encryptPayload(userId, { ...sessions, username: user.username, mediaPaths: [], receipt }) } });
  });
  return { id: job.id, receipt, status: job.status, createdAt: job.createdAt };
}

export async function getDeletionReceipt(receipt: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(receipt)) throw Errors.notFound("删除回执不存在");
  const job = await prisma.accountDeletionJob.findUnique({ where: { receiptHash: receiptHash(receipt) } });
  if (!job) throw Errors.notFound("删除回执不存在");
  return job;
}

export function publicDeletionStatus(job: { id: string; status: string; phase: string; createdAt: Date; completedAt: Date | null }) {
  return { id: job.id, status: job.status, createdAt: job.createdAt, completedAt: job.completedAt, message: job.status === "completed" ? "账户及关联在线个人数据已删除或去标识化，原账户无法恢复。" : job.status === "retry" ? "账户已停止访问；部分清理尚未完成，系统正在自动重试。无需重新提交。" : "账户已停止访问，正在清理关联数据。请保留此回执查看最终结果。" };
}

export async function verifyDeletionForVoiceHub(receipt: string, id: string) {
  const job = await getDeletionReceipt(receipt);
  if (job.id !== id || job.status === "completed") throw Errors.notFound();
  const payload = decodePayload(job);
  return { userId: job.userId, username: payload.username, jobId: job.id };
}

export function managedDeletionPath(value: unknown, ownerId?: number) {
  if (typeof value !== "string") return null;
  const raw = value.split("?")[0].split("#")[0];
  const path = raw.startsWith("/uploads/") ? raw.slice(9) : raw;
  if (!path || path.includes(":") || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  if (!/^(avatars|forum|images|videos|file-collect|filestore|assistant-generated|lost-found|market|verification)\//.test(path)) return null;
  if (ownerId !== undefined && path.startsWith("avatars/") && !path.startsWith(`avatars/${ownerId}/`)) return null;
  return path;
}

async function eraseAccountData(tx: Prisma.TransactionClient, userId: number, payload: DeletionPayload) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) return payload;
  const files = await tx.fileCollectFile.findMany({ where: { submission: { OR: [{ submitterId: userId }, { task: { createdById: userId } }, ...(user.studentSso ? [{ identity: payload.username }] : [])] } }, select: { path: true } });
  const [images, videos, topics, replies, qqBindings, wechat, lostImages, marketImages, generatedImages, directConversations] = await Promise.all([
    tx.forumImageAsset.findMany({ where: { createdById: userId }, select: { url: true } }),
    tx.forumVideoAsset.findMany({ where: { createdById: userId }, select: { url: true } }),
    tx.topic.findMany({ where: { authorId: userId }, select: { id: true, boardId: true } }),
    tx.reply.findMany({ where: { authorId: userId }, select: { topicId: true } }),
    tx.qqBotBinding.findMany({ where: { userId }, select: { qqId: true } }),
    tx.wechatBinding.findUnique({ where: { userId }, select: { openId: true } }),
    tx.lostFoundImage.findMany({ where: { item: { publisherId: userId } }, select: { url: true } }),
    tx.marketImage.findMany({ where: { item: { sellerId: userId } }, select: { url: true } }),
    tx.aiReviewLog.findMany({ where: { createdById: userId, targetLabel: "拾间AI 生图", status: "success" }, select: { responseSummary: true } }),
    tx.directConversation.findMany({ where: { OR: [{ participantLowId: userId }, { participantHighId: userId }] }, select: { id: true } }),
  ]);
  const pending = user.pendingProfile ? JSON.parse(user.pendingProfile) : {};
  const mediaPaths = new Set(payload.mediaPaths);
  for (const value of [user.avatar, pending.avatar, ...files.map((file) => file.path), ...images.map((file) => file.url), ...videos.map((file) => file.url), ...lostImages.map((file) => file.url), ...marketImages.map((file) => file.url)]) {
    const path = managedDeletionPath(value, userId); if (path) mediaPaths.add(path);
  }
  for (const generated of generatedImages) {
    const path = managedDeletionPath(generated.responseSummary);
    if (path?.startsWith("assistant-generated/")) mediaPaths.add(path);
  }
  await tx.topic.updateMany({ where: { authorId: userId }, data: { title: "内容已删除", content: "", metadata: "{}", hidden: true, locked: true, pinned: false, isAnonymous: false, anonymousAlias: null, aiReviewStatus: "deleted", aiReviewReason: null, aiReviewDetail: null, manualReviewNote: null, reportHiddenAt: null } });
  await tx.topicTag.deleteMany({ where: { topicId: { in: topics.map((row) => row.id) } } });
  await tx.reply.updateMany({ where: { authorId: userId }, data: { content: "", hidden: true, isAnonymous: false, anonymousAlias: null, aiReviewStatus: "deleted", aiReviewReason: null, aiReviewDetail: null, reportHiddenAt: null } });
  await tx.directConversation.deleteMany({ where: { OR: [{ participantLowId: userId }, { participantHighId: userId }] } });
  await tx.notification.deleteMany({ where: { category: "direct-message", link: { in: directConversations.map((row) => `/messages?tab=private&conversation=${row.id}`) } } });
  await tx.directMessageRemark.deleteMany({ where: { OR: [{ ownerId: userId }, { targetUserId: userId }] } });
  await tx.userBlock.deleteMany({ where: { OR: [{ ownerId: userId }, { targetId: userId }] } });
  await tx.forumReport.deleteMany({ where: { OR: [{ reporterId: userId }, { targetAuthorId: userId }] } });
  await tx.questionnaireResponse.deleteMany({ where: { respondentId: userId } });
  await tx.questionnaire.deleteMany({ where: { createdById: userId, isSystem: false } });
  await tx.questionnaire.updateMany({ where: { createdById: userId }, data: { createdById: null } });
  if (user.studentSso) await tx.gradeCheckRow.deleteMany({ where: { studentId: payload.username } });
  await tx.gradeCheckTable.deleteMany({ where: { createdById: userId } });
  await tx.fileCollectSubmission.deleteMany({ where: { OR: [{ submitterId: userId }, ...(user.studentSso ? [{ identity: payload.username }] : [])] } });
  await tx.fileCollectTask.deleteMany({ where: { createdById: userId } });
  await tx.fileCollectTemplate.deleteMany({ where: { createdById: userId } });
  await tx.lostFoundClaim.deleteMany({ where: { claimantId: userId } });
  await tx.lostFoundItem.deleteMany({ where: { publisherId: userId } });
  await tx.marketImage.deleteMany({ where: { item: { sellerId: userId } } });
  await tx.marketItem.updateMany({ where: { sellerId: userId }, data: { title: "内容已删除", description: "", digitalDeliveryEncrypted: null, status: "withdrawn", campus: "", location: "" } });
  await tx.marketConversation.deleteMany({ where: { OR: [{ buyerId: userId }, { sellerId: userId }] } });
  await tx.marketOffer.updateMany({ where: { buyerId: userId }, data: { message: "" } });
  await tx.marketReview.deleteMany({ where: { OR: [{ authorId: userId }, { targetUserId: userId }] } });
  await tx.marketReport.deleteMany({ where: { reporterId: userId } });
  await tx.marketOrder.updateMany({ where: { OR: [{ buyerId: userId }, { sellerId: userId }] }, data: { meetupLocation: "", note: "", digitalDeliveryEncrypted: null } });
  await tx.marketRefund.updateMany({ where: { requestedById: userId }, data: { reason: "账户删除后仅保留对账信息", handledNote: "" } });
  await tx.marketSettlement.updateMany({ where: { sellerId: userId }, data: { reference: "", note: "" } });
  await tx.marketPaymentLog.updateMany({ where: { order: { OR: [{ buyerId: userId }, { sellerId: userId }] } }, data: { rawPayload: "{}", result: "" } });
  await tx.sponsorOrder.updateMany({ where: { userId, status: "pending" }, data: { status: "closed", closedAt: new Date() } });
  await tx.sponsorOrder.updateMany({ where: { userId }, data: { message: "", displayMode: "hidden" } });
  await tx.sponsorPaymentLog.updateMany({ where: { order: { userId } }, data: { rawPayload: "{}", result: null } });
  await tx.wechatMessageLog.deleteMany({ where: { OR: [{ userId }, ...(wechat ? [{ openId: wechat.openId }] : [])] } });
  const qqIds = qqBindings.map((binding) => binding.qqId);
  await tx.qqBotMessageLog.deleteMany({ where: { OR: [{ userId }, { qqId: { in: qqIds } }] } });
  await tx.qqBotConversation.deleteMany({ where: { qqId: { in: qqIds } } });
  for (const [model, key] of [
    ["like", "userId"], ["forumReaction", "userId"], ["notification", "userId"], ["notificationRead", "userId"], ["messageSetting", "userId"],
    ["userCourse", "userId"], ["userScheduleEdit", "userId"], ["scheduleWidgetToken", "userId"], ["toolPermission", "userId"],
    ["qqBotBinding", "userId"], ["qqBotBindToken", "userId"], ["wechatBinding", "userId"], ["wechatBindToken", "userId"], ["wechatOauthState", "userId"],
    ["forumImageAsset", "createdById"], ["forumVideoAsset", "createdById"], ["aiReviewLog", "createdById"],
    ["campusAssistantConversation", "userId"], ["campusAssistantDailyUsage", "userId"], ["campusAssistantPointLedger", "userId"],
    ["courseBotQuota", "userId"], ["courseBotUsageLog", "userId"], ["adminDailyLogin", "userId"], ["marketFavorite", "userId"], ["marketPayoutProfile", "userId"],
    ["oAuthAuthorizationCode", "userId"], ["oAuthAccessToken", "userId"], ["userVerificationApplication", "userId"], ["yaodaFlightAttempt", "userId"], ["yaodaFlightAchievement", "userId"],
  ] as const) await (tx[model] as any).deleteMany({ where: { [key]: userId } });
  await tx.teacher.updateMany({ where: { createdById: userId }, data: { createdById: null } });
  await tx.iosClientInstall.updateMany({ where: { userId }, data: { userId: null } });
  await tx.user.update({ where: { id: userId }, data: {
    username: `deleted-${randomUUID()}`, passwordHash: randomBytes(48).toString("base64url"), nickname: "已删除用户", email: null, avatar: null, bio: null, college: null, enrollYear: null,
    role: "user", voiceHubRole: null, lostFoundRole: null, studentSso: false, status: "deleted", mutedUntil: null,
    pendingNickname: null, nicknameReviewStatus: "none", nicknameReviewReason: null, nicknameReviewDetail: null, nicknameReviewModel: null, nicknameReviewRequestedAt: null, nicknameReviewedAt: null,
    pendingProfile: null, profileReviewStatus: "none", profileReviewReason: null, aiConsentVersion: null, aiConsentAgreedAt: null,
    postCount: 0, replyCount: 0, reputation: 0, lastLoginAt: null, lastLoginClient: null, usedIosClient: false, usedAndroidClient: false, usedHarmonyClient: false, usedDesktopClient: false,
    topicSubmissionLocked: true, aiReviewWhitelisted: false, dataAuthAgreedAt: null, forumEnabled: false, forumEnabledAt: null, anonymousCredits: 0, anonymousWeekKey: null, anonymousCreditsFrozen: true,
    sponsorTotalCents: 0, isVip: false, vipLevel: 0, vipExpiresAt: null, profileTheme: null, profileFrame: null, verificationType: null, verificationLabel: null, verificationVerifiedAt: null, verificationExpiresAt: null, verificationApplicationId: null, assistantPoints: 0,
  } });
  await refreshBoardTopicCounts(topics.map((row) => row.boardId), tx);
  for (const topicId of new Set(replies.map((row) => row.topicId))) await refreshTopicReplyStats(topicId, tx);
  return { ...payload, mediaPaths: [...mediaPaths] };
}

async function eraseVoiceHub(jobId: string, receipt: string) {
  const response = await fetch(`${voiceHubProxyConfig.origin}/voicehub/api/internal/account-deletion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, receipt }), redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !(await response.json() as { deleted?: boolean }).deleted) throw new Error("VoiceHub account cleanup not confirmed");
}

type CleanupDependencies = { deleteMedia: typeof deleteMediaAsset; deleteSessions: typeof deleteAccountSessions; deleteVoiceHub: typeof eraseVoiceHub; purgeMedia?: (paths: string[]) => Promise<void> };
export async function processAccountDeletion(id: string, dependencies: CleanupDependencies = { deleteMedia: deleteMediaAsset, deleteSessions: deleteAccountSessions, deleteVoiceHub: eraseVoiceHub, purgeMedia: purgeAccountMediaCaches }) {
  let job = await prisma.accountDeletionJob.findUnique({ where: { id } });
  if (!job || job.status === "completed") return;
  const lease = await prisma.accountDeletionJob.updateMany({ where: { id, OR: [{ status: { in: ["pending", "retry"] } }, { status: "processing", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] }, data: { status: "processing", attempts: { increment: 1 } } });
  if (!lease.count) return;
  let cleanupStep = "data";
  try {
    let payload = decodePayload(job);
    if (job.phase === "data") {
      payload = await prisma.$transaction(async (tx) => {
        const cleaned = await eraseAccountData(tx, job!.userId, payload);
        await tx.accountDeletionJob.update({ where: { id }, data: { phase: "external", encryptedPayload: encryptPayload(job!.userId, cleaned) } });
        return cleaned;
      }, { timeout: 120_000 });
    }
    cleanupStep = "sessions";
    await dependencies.deleteSessions(payload.tokens, payload.sessionKeys);
    cleanupStep = "media";
    for (const path of payload.mediaPaths) {
      await dependencies.deleteMedia(path);
      await prisma.accountDeletionJob.update({ where: { id }, data: { updatedAt: new Date() } });
    }
    cleanupStep = "cdn";
    await dependencies.purgeMedia?.(payload.mediaPaths);
    cleanupStep = "voicehub";
    await dependencies.deleteVoiceHub(job.id, payload.receipt);
    cleanupStep = "cache";
    await invalidateForumCaches({ includeCourses: true });
    await prisma.accountDeletionJob.update({ where: { id }, data: { status: "completed", phase: "completed", encryptedPayload: null, lastError: null, completedAt: new Date() } });
  } catch {
    await prisma.accountDeletionJob.update({ where: { id }, data: { status: "retry", lastError: cleanupStep, nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** Math.min(job.attempts, 6)) * 60_000) } });
  }
}

let workerStarted = false;
export function startAccountDeletionWorker() {
  if (workerStarted) return;
  workerStarted = true;
  let running = false;
  const scan = async () => {
    if (running) return;
    running = true;
    try {
      const jobs = await prisma.accountDeletionJob.findMany({ where: { OR: [{ status: { in: ["pending", "retry"] }, nextAttemptAt: { lte: new Date() } }, { status: "processing", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] }, orderBy: { createdAt: "asc" }, take: 10 });
      for (const job of jobs) await processAccountDeletion(job.id);
    } catch { console.warn("[account-deletion] cleanup queue unavailable; retrying later"); }
    finally { running = false; }
  };
  setTimeout(() => void scan(), 0).unref();
  setInterval(() => void scan(), 15_000).unref();
}
