import dayjs from "dayjs";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";

export async function releaseExpiredMutes() {
  await prisma.user.updateMany({
    where: {
      status: "muted",
      mutedUntil: { not: null, lte: new Date() },
    },
    data: {
      status: "active",
      mutedUntil: null,
    },
  }).catch(() => {});
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
  if (user.status === "muted") throw Errors.forbidden(buildMutedMessage(user.mutedUntil));
  return user;
}
