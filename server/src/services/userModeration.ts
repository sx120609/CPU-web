import dayjs from "dayjs";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";

const EXPIRED_MUTE_RELEASE_INTERVAL_MS = 60_000;
let expiredMuteReleasedAt = 0;
let expiredMuteRelease: Promise<void> | null = null;

// 全表释放过期禁言代价较高，且会在热门读路径上调用：每个进程每 60 秒最多真正执行一次，
// 并发调用共享同一次更新。禁言是否生效由 isMuteActive 按 mutedUntil 实时判断，不依赖这里的落库时机。
export function releaseExpiredMutes(): Promise<void> {
  if (expiredMuteRelease) return expiredMuteRelease;
  const now = Date.now();
  if (now >= expiredMuteReleasedAt && now - expiredMuteReleasedAt < EXPIRED_MUTE_RELEASE_INTERVAL_MS) return Promise.resolve();
  expiredMuteReleasedAt = now;
  expiredMuteRelease = prisma.user.updateMany({
    where: {
      status: "muted",
      mutedUntil: { not: null, lte: new Date() },
    },
    data: {
      status: "active",
      mutedUntil: null,
    },
  }).then(() => undefined, () => undefined).finally(() => {
    expiredMuteRelease = null;
  });
  return expiredMuteRelease;
}

export function isMuteActive(user: { status?: string | null; mutedUntil?: Date | string | null }, now = Date.now()) {
  if (user.status !== "muted") return false;
  if (!user.mutedUntil) return true;
  return new Date(user.mutedUntil).getTime() > now;
}

export function parseMutedUntil(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const mutedUntil = new Date(value);
  if (Number.isNaN(mutedUntil.getTime())) {
    throw Errors.badRequest("禁言截止时间格式不正确");
  }
  return mutedUntil;
}

export function buildMutedMessage(mutedUntil?: Date | string | null) {
  if (!mutedUntil) return "你当前已被禁言";
  return `你已被禁言，截止到 ${dayjs(mutedUntil).format("YYYY-MM-DD HH:mm")}`;
}

export async function ensureUserCanSpeak(userId: number) {
  await releaseExpiredMutes();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, mutedUntil: true },
  });
  if (!user) throw Errors.notFound("用户不存在");
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
  if (["deleting", "deleted"].includes(user.status)) throw Errors.unauthorized("账号已删除或正在删除");
  if (user.status === "muted") {
    if (isMuteActive(user)) throw Errors.forbidden(buildMutedMessage(user.mutedUntil));
    // 禁言已到期但批量释放还没轮到：立即按正常用户处理，并单独为该用户落库。
    await prisma.user.updateMany({
      where: { id: user.id, status: "muted", mutedUntil: { not: null, lte: new Date() } },
      data: { status: "active", mutedUntil: null },
    }).catch(() => {});
    return { ...user, status: "active", mutedUntil: null };
  }
  return user;
}
