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
  userIds?: number[];
  allUsers?: boolean;
  points: number;
  reason: string;
  operatorId: number;
}) {
  const userIds = Array.from(new Set(input.userIds ?? []));
  const points = Math.max(0, Math.floor(Number(input.points) || 0));
  if (points <= 0) throw new Error("POINT_GRANT_INVALID");
  return prisma.$transaction(
    async (tx) => {
      const users = await tx.user.findMany({
        where: input.allUsers
          ? {
              role: { not: "bot" },
              status: { not: "banned" },
            }
          : { id: { in: userIds } },
        select: { id: true, username: true, nickname: true },
        orderBy: { id: "asc" },
      });
      if (!input.allUsers && users.length !== userIds.length) throw new Error("POINT_USERS_NOT_FOUND");
      if (!users.length) throw new Error("POINT_USERS_NOT_FOUND");

      const recipientIds = users.map((user) => user.id);
      await tx.user.updateMany({
        where: { id: { in: recipientIds } },
        data: { assistantPoints: { increment: points } },
      });
      const updatedUsers = await tx.user.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, assistantPoints: true },
      });
      const balanceByUserId = new Map(updatedUsers.map((user) => [user.id, user.assistantPoints]));
      await tx.campusAssistantPointLedger.createMany({
        data: users.map((user) => ({
          userId: user.id,
          delta: points,
          balanceAfter: balanceByUserId.get(user.id) ?? points,
          source: "admin_grant",
          reason: input.reason,
          operatorId: input.operatorId,
        })),
      });
      return users.map((user) => ({
        ...user,
        balance: balanceByUserId.get(user.id) ?? points,
      }));
    },
    { timeout: 60_000 },
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

export async function backfillSponsorAssistantPoints(pointsPerYuan: number) {
  const candidates = await prisma.sponsorOrder.findMany({
    where: {
      status: "paid",
      assistantPointsAwarded: 0,
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      userId: true,
      amountCents: true,
    },
  });
  const eligible = candidates
    .map((order) => ({
      ...order,
      points: calculateSponsorAssistantPoints(order.amountCents, pointsPerYuan),
    }))
    .filter((order) => order.points > 0);
  if (!eligible.length) {
    return {
      orderCount: 0,
      userCount: 0,
      totalPoints: 0,
      userAwards: [] as Array<{ userId: number; points: number; orderCount: number }>,
    };
  }

  return prisma.$transaction(
    async (tx) => {
      const claimed: typeof eligible = [];
      for (const order of eligible) {
        const result = await tx.sponsorOrder.updateMany({
          where: {
            id: order.id,
            status: "paid",
            assistantPointsAwarded: 0,
          },
          data: { assistantPointsAwarded: order.points },
        });
        if (result.count === 1) claimed.push(order);
      }

      const ordersByUser = new Map<number, typeof claimed>();
      for (const order of claimed) {
        const current = ordersByUser.get(order.userId) ?? [];
        current.push(order);
        ordersByUser.set(order.userId, current);
      }

      const userAwards: Array<{ userId: number; points: number; orderCount: number }> = [];
      for (const [userId, orders] of ordersByUser) {
        const totalPoints = orders.reduce((sum, order) => sum + order.points, 0);
        const user = await tx.user.update({
          where: { id: userId },
          data: { assistantPoints: { increment: totalPoints } },
          select: { assistantPoints: true },
        });
        let runningBalance = user.assistantPoints - totalPoints;
        await tx.campusAssistantPointLedger.createMany({
          data: orders.map((order) => {
            runningBalance += order.points;
            return {
              userId,
              delta: order.points,
              balanceAfter: runningBalance,
              source: "sponsor_reward",
              reason: "历史赞助点数补发",
              referenceType: "sponsor_order",
              referenceId: String(order.id),
            };
          }),
        });
        userAwards.push({ userId, points: totalPoints, orderCount: orders.length });
      }

      return {
        orderCount: claimed.length,
        userCount: userAwards.length,
        totalPoints: claimed.reduce((sum, order) => sum + order.points, 0),
        userAwards,
      };
    },
    { timeout: 120_000 },
  );
}

export async function spendAssistantPoint(userId: number, amount = 1) {
  const points = Math.max(0.5, Math.round((Number(amount) || 1) * 2) / 2);
  return prisma.$transaction(async (tx) => {
    const spent = await tx.user.updateMany({
      where: { id: userId, assistantPoints: { gte: points } },
      data: { assistantPoints: { decrement: points } },
    });
    if (spent.count !== 1) return null;

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { assistantPoints: true },
    });
    const ledger = await tx.campusAssistantPointLedger.create({
      data: {
        userId,
        delta: -points,
        balanceAfter: user.assistantPoints,
        source: "ai_usage",
        reason: "拾间 AI 调用",
      },
      select: { id: true },
    });
    return { transactionId: ledger.id, balance: user.assistantPoints, points };
  });
}

export async function refundAssistantPoint(userId: number, transactionId: number) {
  try {
    await prisma.$transaction(async (tx) => {
      const original = await tx.campusAssistantPointLedger.findFirst({
        where: { id: transactionId, userId, source: "ai_usage", delta: { lt: 0 } },
        select: { id: true, delta: true },
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
        data: { assistantPoints: { increment: Math.abs(original.delta) } },
        select: { assistantPoints: true },
      });
      await tx.campusAssistantPointLedger.create({
        data: {
          userId,
          delta: Math.abs(original.delta),
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
