import { z } from "zod";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { normalizeNicknameSubmission } from "./nicknameReview";
import { deleteManagedUserAvatar, storeUserAvatarDataUrl } from "./userAvatarStorage";
import { invalidateForumCaches } from "./cacheInvalidation";
import { runWithDistributedLock } from "./cache";
import { reviewProfileTextContent } from "./topicAiReview";
import { reviewProfileAvatar } from "./imageModeration";

export const profileSubmissionSchema = z.object({
  nickname: z.string().optional(),
  avatar: z.string().max(8 * 1024 * 1024).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  college: z.string().trim().max(80).nullable().optional(),
  enrollYear: z.number().int().min(1900).max(2100).nullable().optional(),
});

export async function submitProfileReview(userId: number, raw: Record<string, unknown>) {
  const parsed = profileSubmissionSchema.safeParse(raw);
  if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message || "资料格式不正确");
  if (!Object.keys(parsed.data).length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || ["deleting", "deleted"].includes(user.status)) throw Errors.unauthorized();
  const pending = user.pendingProfile ? JSON.parse(user.pendingProfile) : {};
  const update = { ...pending, ...parsed.data };
  if (parsed.data.nickname !== undefined) update.nickname = normalizeNicknameSubmission(parsed.data.nickname);
  if (parsed.data.avatar) {
    if (parsed.data.avatar.startsWith("data:image/")) update.avatar = await storeUserAvatarDataUrl(userId, parsed.data.avatar, true);
    else if (parsed.data.avatar !== user.avatar && parsed.data.avatar !== pending.avatar) throw Errors.badRequest("请上传新的头像图片，不能直接提交外部图片地址");
  }
  const changed = Object.entries(update).some(([key, value]) => (user as any)[key] !== value);
  if (!changed) return false;
  const snapshot = JSON.stringify(update);
  if (user.pendingProfile === snapshot && ["pending", "checking"].includes(user.profileReviewStatus)) return false;
  const result = await prisma.user.updateMany({ where: { id: userId, status: { notIn: ["deleting", "deleted"] }, updatedAt: user.updatedAt }, data: {
    pendingProfile: snapshot, profileReviewStatus: "checking", profileReviewReason: "资料正在 AI 审核，通过后自动公开生效",
    ...(update.nickname !== undefined ? { pendingNickname: update.nickname, nicknameReviewStatus: "manual_pending", nicknameReviewReason: "昵称随资料一起进行 AI 审核", nicknameReviewRequestedAt: new Date() } : {}),
  } });
  if (!result.count) throw Errors.conflict("资料已发生变化，请刷新后重新提交");
  if (pending.avatar && pending.avatar !== update.avatar && pending.avatar !== user.avatar) await deleteManagedUserAvatar(pending.avatar).catch(() => false);
  return true;
}

export async function decideProfileReview(userId: number, reviewerId: number | null, snapshot: string, approve: boolean, note: string, expectedUpdatedAt?: Date) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !["pending", "checking"].includes(user.profileReviewStatus) || user.pendingProfile !== snapshot || ["deleting", "deleted"].includes(user.status)) throw Errors.conflict("资料已变更，请重新读取审核队列");
  const data = profileSubmissionSchema.parse(JSON.parse(snapshot));
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: userId, pendingProfile: snapshot, profileReviewStatus: { in: ["pending", "checking"] }, updatedAt: expectedUpdatedAt ?? user.updatedAt, status: { notIn: ["deleting", "deleted"] } }, data: {
      ...(approve ? data : {}), pendingProfile: null, profileReviewStatus: approve ? "approved" : "rejected", profileReviewReason: note || (approve ? "资料审核通过" : "资料未通过审核，请按社区规则修改后重试"),
      ...(data.nickname !== undefined ? { pendingNickname: null, nicknameReviewStatus: approve ? "approved" : "rejected", nicknameReviewReason: note, nicknameReviewedAt: new Date() } : {}),
    } });
    if (!updated.count) throw Errors.conflict("该资料已被处理");
    if (data.avatar) await tx.forumImageAsset.updateMany({ where: { url: data.avatar, createdById: userId, status: { in: ["manual_profile_pending", "rejected"] } }, data: {
      status: approve ? "approved" : "rejected", reason: note, reviewedAt: new Date(),
      ...(reviewerId !== null ? { manualReviewedById: reviewerId, manualReviewedAt: new Date(), manualReviewNote: note, reviewModel: "manual-profile" } : { reviewModel: "ai-profile" }),
    } });
    await tx.notification.create({ data: { userId, category: "profile-review", title: approve ? "资料已通过审核" : "资料未通过审核", content: note || (approve ? "你的资料已公开生效。" : "请修改资料后重新提交。"), link: "/profile", source: reviewerId === null ? "AI 审核" : "人工审核", payload: JSON.stringify({ reviewerId, approved: approve }) } });
    await tx.notification.updateMany({ where: { category: "profile-review", title: "有用户资料等待审核", payload: JSON.stringify({ userId }), readAt: null }, data: { readAt: new Date() } });
    return updated;
  });
  if (data.avatar && ((approve && user.avatar !== data.avatar) || (!approve && data.avatar !== user.avatar))) {
    await deleteManagedUserAvatar(approve ? user.avatar : data.avatar).catch(() => false);
  }
  await invalidateForumCaches();
  return result;
}

let profilePollerStarted = false;

export function startProfileReviewPoller() {
  if (profilePollerStarted) return;
  profilePollerStarted = true;
  const tick = () => void recoverPendingProfileReviews().catch((error) => console.warn("[profile-review] scan failed", error));
  setTimeout(tick, 5_000).unref?.();
  setInterval(tick, 5_000).unref?.();
}

export async function recoverPendingProfileReviews(now = Date.now()) {
  return runWithDistributedLock("profile-review:drain", 120_000, async () => {
    const users = await prisma.user.findMany({
      where: {
        profileReviewStatus: { in: ["pending", "checking"] }, pendingProfile: { not: null },
        status: { notIn: ["deleting", "deleted"] }, updatedAt: { lte: new Date(now - 60_000) },
      },
      orderBy: { updatedAt: "asc" }, take: 2,
      // 只取审核需要的字段，避免每 5 秒读取整行用户资料。
      select: { id: true, pendingProfile: true, updatedAt: true, avatar: true },
    });
    await Promise.all(users.map((user) => processProfileReview(user)));
  });
}

export async function processProfileReview(
  user: { id: number; pendingProfile: string | null; updatedAt: Date; avatar: string | null },
  reviewers = { text: reviewProfileTextContent, avatar: reviewProfileAvatar },
) {
  if (!user.pendingProfile) return;
  try {
    const data = profileSubmissionSchema.parse(JSON.parse(user.pendingProfile));
    const { avatar, ...profile } = data;
    const text = await reviewers.text({ profile, createdById: user.id });
    if (!["auto_passed", "blocked_ai"].includes(text.status)) throw new Error("资料审核未返回有效结论");
    let approved = text.status === "auto_passed";
    let reason = text.reason;
    if (approved && avatar && avatar !== user.avatar) {
      const image = await reviewers.avatar(avatar, user.id);
      approved = image.approved;
      if (!approved) reason = `头像：${image.reason}`;
    }
    await decideProfileReview(user.id, null, user.pendingProfile, approved, approved ? "资料已通过 AI 审核并公开生效" : reason, user.updatedAt);
  } catch (error) {
    // 对同一快照退避重试；过期结果不能覆盖用户新提交或人工处理的结果。
    await prisma.user.updateMany({ where: {
      id: user.id, pendingProfile: user.pendingProfile, updatedAt: user.updatedAt,
      profileReviewStatus: { in: ["pending", "checking"] }, status: { notIn: ["deleting", "deleted"] },
    }, data: { profileReviewStatus: "checking", profileReviewReason: "AI 审核暂未完成，系统会自动重试，当前公开资料保持不变", updatedAt: new Date() } });
    console.warn(`[profile-review] user ${user.id} deferred`, error instanceof Error ? error.message : error);
  }
}
