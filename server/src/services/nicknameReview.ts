import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { invalidateForumCaches } from "./cacheInvalidation";
import { reviewNicknameContent } from "./topicAiReview";

const POLL_INTERVAL_MS = 5_000;
const POLL_BATCH_SIZE = 20;
const MAX_CONCURRENT_REVIEWS = 2;
const RETRY_DELAYS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000] as const;
const MAX_REVIEW_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const activeReviews = new Set<number>();
let pollerStarted = false;

export function normalizeNicknameSubmission(value: unknown) {
  if (typeof value !== "string") throw Errors.badRequest("昵称格式不正确");
  const nickname = value.trim().normalize("NFC");
  const length = Array.from(nickname).length;
  if (length < 2) throw Errors.badRequest("昵称至少 2 个字符");
  if (length > 20) throw Errors.badRequest("昵称最多 20 个字符");
  if (/[\p{Cc}\p{Cf}]/u.test(nickname)) {
    throw Errors.badRequest("昵称不能包含换行或不可见控制字符");
  }
  return nickname;
}
export function nicknameSetupRequired(input: {
  nickname?: string | null;
  pendingNickname?: string | null;
  nicknameReviewStatus?: string | null;
}) {
  if (String(input.nickname || "").trim()) return false;
  return !(input.nicknameReviewStatus === "checking" && String(input.pendingNickname || "").trim());
}

export function nicknameReviewAttempt(detail: string | null | undefined) {
  const matched = String(detail || "").match(/\[attempt:(\d+)\]/);
  return matched ? Math.max(0, Number(matched[1]) || 0) : 0;
}

export function nicknameReviewRetryDelayMs(attempt: number) {
  if (attempt <= 0) return 0;
  return RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
}

export function nicknameReviewRetryDue(
  detail: string | null | undefined,
  reviewedAt: Date | string | null | undefined,
  now = Date.now(),
) {
  if (!reviewedAt) return true;
  const reviewedAtMs = new Date(reviewedAt).getTime();
  if (!Number.isFinite(reviewedAtMs)) return true;
  return reviewedAtMs + nicknameReviewRetryDelayMs(nicknameReviewAttempt(detail)) <= now;
}

export function scheduleNicknameReview(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0 || activeReviews.has(userId) || activeReviews.size >= MAX_CONCURRENT_REVIEWS) return;
  activeReviews.add(userId);
  setTimeout(() => {
    void processNicknameReview(userId)
      .catch((error) => console.warn(`[nickname-review] user ${userId} processing failed`, error instanceof Error ? error.message : error))
      .finally(() => activeReviews.delete(userId));
  }, 0).unref?.();
}

export function startNicknameReviewPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  const scan = () => {
    void recoverPendingNicknameReviews().catch((error) => {
      console.warn("[nickname-review] pending scan failed", error instanceof Error ? error.message : error);
    });
  };
  setTimeout(scan, 0).unref?.();
  setInterval(scan, POLL_INTERVAL_MS).unref?.();
}

export async function recoverPendingNicknameReviews(now = Date.now()) {
  const rows = await prisma.user.findMany({
    where: {
      nicknameReviewStatus: "checking",
      pendingNickname: { not: null },
      nicknameReviewRequestedAt: { not: null },
      OR: [{ nicknameReviewedAt: null }, { nicknameReviewedAt: { lte: new Date(now - RETRY_DELAYS_MS[0]) } }],
    },
    orderBy: { nicknameReviewedAt: "asc" },
    take: POLL_BATCH_SIZE,
    select: { id: true, nicknameReviewDetail: true, nicknameReviewedAt: true },
  });
  rows
    .filter((row) => nicknameReviewRetryDue(row.nicknameReviewDetail, row.nicknameReviewedAt, now))
    .forEach((row) => scheduleNicknameReview(row.id));
}

async function processNicknameReview(userId: number) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      nicknameReviewStatus: "checking",
      pendingNickname: { not: null },
      nicknameReviewRequestedAt: { not: null },
    },
    select: {
      id: true,
      pendingNickname: true,
      nicknameReviewRequestedAt: true,
    },
  });
  if (!user?.pendingNickname || !user.nicknameReviewRequestedAt) return;

  const snapshot = {
    pendingNickname: user.pendingNickname,
    requestedAt: user.nicknameReviewRequestedAt,
  };
  try {
    const result = await reviewNicknameContent({ nickname: snapshot.pendingNickname, createdById: user.id });
    const approved = result.status === "auto_passed";
    const finalized = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: user.id,
          nicknameReviewStatus: "checking",
          pendingNickname: snapshot.pendingNickname,
          nicknameReviewRequestedAt: snapshot.requestedAt,
        },
        data: {
          ...(approved ? { nickname: snapshot.pendingNickname, pendingNickname: null } : {}),
          nicknameReviewStatus: approved ? "approved" : "rejected",
          nicknameReviewReason: result.reason,
          nicknameReviewDetail: result.detail,
          nicknameReviewModel: result.model,
          nicknameReviewedAt: new Date(),
        },
      });
      if (updated.count !== 1) return false;
      await tx.notification.create({
        data: {
          userId: user.id,
          category: "system",
          level: approved ? "normal" : "warning",
          title: approved ? "昵称已通过审核" : "昵称未通过审核",
          content: approved
            ? `昵称“${snapshot.pendingNickname}”已公开生效。`
            : `昵称“${snapshot.pendingNickname}”未通过审核：${result.reason}`,
          link: "/profile",
          source: "AI 审核",
          payload: JSON.stringify({
            type: approved ? "nickname-review-approved" : "nickname-review-rejected",
            nickname: snapshot.pendingNickname,
            reason: result.reason,
          }),
        },
      });
      return true;
    });
    if (finalized && approved) await invalidateForumCaches().catch(() => undefined);
  } catch (error) {
    await failNicknameReview(user.id, snapshot, error);
  }
}

async function failNicknameReview(
  userId: number,
  snapshot: { pendingNickname: string; requestedAt: Date },
  error: unknown,
) {
  const current = await prisma.user.findFirst({
    where: {
      id: userId,
      nicknameReviewStatus: "checking",
      pendingNickname: snapshot.pendingNickname,
      nicknameReviewRequestedAt: snapshot.requestedAt,
    },
    select: { nicknameReviewDetail: true },
  });
  if (!current) return;
  const attempt = nicknameReviewAttempt(current.nicknameReviewDetail) + 1;
  const finalFailure = attempt >= MAX_REVIEW_ATTEMPTS;
  const reason = /超时|timeout/iu.test(error instanceof Error ? error.message : String(error || ""))
    ? "AI 审核服务响应超时"
    : "AI 审核服务暂时不可用";
  const updated = await prisma.user.updateMany({
    where: {
      id: userId,
      nicknameReviewStatus: "checking",
      pendingNickname: snapshot.pendingNickname,
      nicknameReviewRequestedAt: snapshot.requestedAt,
    },
    data: {
      nicknameReviewStatus: finalFailure ? "review_failed" : "checking",
      nicknameReviewReason: finalFailure
        ? `${reason}；已自动重试 ${attempt} 次，可重新提交昵称。`
        : `${reason}；这不代表昵称违规，系统将自动重试（${attempt}/${MAX_REVIEW_ATTEMPTS}）`,
      nicknameReviewDetail: `[attempt:${attempt}] ${error instanceof Error ? `${error.name}: ${error.message}` : String(error || "unknown error")}`.slice(0, 4000),
      nicknameReviewedAt: new Date(),
    },
  }).catch(() => ({ count: 0 }));
  if (updated.count !== 1 || (attempt !== 1 && !finalFailure)) return;
  await prisma.notification.create({
    data: {
      userId,
      category: "system",
      level: "warning",
      title: finalFailure ? "昵称审核暂未完成" : "昵称审核正在自动重试",
      content: finalFailure
        ? "AI 审核服务持续不可用，这不代表昵称违规。请重新提交或稍后再试。"
        : "昵称已安全保存且尚未公开；AI 审核恢复后会自动继续。",
      link: "/profile",
      source: "AI 审核",
      payload: JSON.stringify({ type: finalFailure ? "nickname-review-failed" : "nickname-review-outage" }),
    },
  }).catch(() => undefined);
}
