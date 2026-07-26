import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";

type DatabaseClient = Prisma.TransactionClient | PrismaClient;

export type AssistantPointGrant = {
  userId: number;
  points: number;
  source: "admin_grant" | "sponsor_reward";
  reason: string;
  operatorId?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
};

export function calculateSponsorAssistantPoints(amountCents: number, pointsPerYuan: number) {
  const cents = Math.max(0, Math.floor(Number(amountCents) || 0));
  const rate = Math.max(0, Math.floor(Number(pointsPerYuan) || 0));
  return Math.floor((cents * rate) / 100);
}

export async function grantAssistantPoints(db: DatabaseClient, grant: AssistantPointGrant) {
  const points = Math.max(0, Math.floor(Number(grant.points) || 0));
  if (points <= 0) {
    const current = await db.user.findUnique({
      where: { id: grant.userId },
      select: { assistantPoints: true },
    });
    return { points: 0, balance: current?.assistantPoints ?? 0, ledgerId: null };
  }

  const user = await db.user.update({
    where: { id: grant.userId },
    data: { assistantPoints: { increment: points } },
    select: { assistantPoints: true },
  });
  const ledger = await db.campusAssistantPointLedger.create({
    data: {
      userId: grant.userId,
      delta: points,
      balanceAfter: user.assistantPoints,
      source: grant.source,
      reason: grant.reason,
      operatorId: grant.operatorId ?? null,
      referenceType: grant.referenceType ?? null,
      referenceId: grant.referenceId ?? null,
    },
    select: { id: true },
  });
  return { points, balance: user.assistantPoints, ledgerId: ledger.id };
}

export async function grantAssistantPointsBatch(input: {
  userIds: number[];
  points: number;
  reason: string;
  operatorId: number;
}) {
  const userIds = Array.from(new Set(input.userIds));
  return prisma.$transaction(
    async (tx) => {
      const users = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, nickname: true },
        orderBy: { id: "asc" },
      });
      if (users.length !== userIds.length) throw new Error("POINT_USERS_NOT_FOUND");
      const balances = [];
      for (const user of users) {
        const result = await grantAssistantPoints(tx, {
          userId: user.id,
          points: input.points,
          source: "admin_grant",
          reason: input.reason,
          operatorId: input.operatorId,
        });
        balances.push({ ...user, balance: result.balance });
      }
      return balances;
    },
    { timeout: 30_000 },
  );
}

export async function awardSponsorAssistantPoints(
  tx: Prisma.TransactionClient,
  input: {
    orderId: number;
    userId: number;
    amountCents: number;
    pointsPerYuan: number;
  },
) {
  const points = calculateSponsorAssistantPoints(input.amountCents, input.pointsPerYuan);
  if (points <= 0) return 0;

  const claimed = await tx.sponsorOrder.updateMany({
    where: { id: input.orderId, assistantPointsAwarded: 0 },
    data: { assistantPointsAwarded: points },
  });
  if (claimed.count !== 1) {
    const order = await tx.sponsorOrder.findUnique({
      where: { id: input.orderId },
      select: { assistantPointsAwarded: true },
    });
    return order?.assistantPointsAwarded ?? 0;
  }

  await grantAssistantPoints(tx, {
    userId: input.userId,
    points,
    source: "sponsor_reward",
    reason: "赞助奖励",
    referenceType: "sponsor_order",
    referenceId: String(input.orderId),
  });
  return points;
}

export async function spendAssistantPoint(userId: number) {
  return prisma.$transaction(async (tx) => {
    const spent = await tx.user.updateMany({
      where: { id: userId, assistantPoints: { gt: 0 } },
      data: { assistantPoints: { decrement: 1 } },
    });
    if (spent.count !== 1) return null;

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { assistantPoints: true },
    });
    const ledger = await tx.campusAssistantPointLedger.create({
      data: {
        userId,
        delta: -1,
        balanceAfter: user.assistantPoints,
        source: "ai_usage",
        reason: "拾间 AI 调用",
      },
      select: { id: true },
    });
    return { transactionId: ledger.id, balance: user.assistantPoints };
  });
}

export async function refundAssistantPoint(userId: number, transactionId: number) {
  try {
    await prisma.$transaction(async (tx) => {
      const original = await tx.campusAssistantPointLedger.findFirst({
        where: { id: transactionId, userId, source: "ai_usage", delta: -1 },
        select: { id: true },
      });
      if (!original) return;

      const existing = await tx.campusAssistantPointLedger.findFirst({
        where: {
          userId,
          source: "ai_refund",
          referenceType: "point_ledger",
          referenceId: String(transactionId),
        },
        select: { id: true },
      });
      if (existing) return;

      const user = await tx.user.update({
        where: { id: userId },
        data: { assistantPoints: { increment: 1 } },
        select: { assistantPoints: true },
      });
      await tx.campusAssistantPointLedger.create({
        data: {
          userId,
          delta: 1,
          balanceAfter: user.assistantPoints,
          source: "ai_refund",
          reason: "拾间 AI 调用失败返还",
          referenceType: "point_ledger",
          referenceId: String(transactionId),
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}
