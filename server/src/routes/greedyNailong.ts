import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  earnedGreedyNailongAchievementCodes,
  greedyNailongAchievementProgress,
  validateGreedyNailongResult,
  GREEDY_NAILONG_ACHIEVEMENTS,
  GREEDY_NAILONG_MAX_ATTEMPT_MS,
  GREEDY_NAILONG_MAX_FOODS,
  GREEDY_NAILONG_MAX_LENGTH,
  GREEDY_NAILONG_MAX_SCORE,
  GREEDY_NAILONG_START_LENGTH,
} from "../services/greedyNailongPolicy";
import { publicFlightName } from "../services/yaodaFlightPolicy";
import { publicAvatarValue } from "../utils/publicAvatar";
import { withCache } from "../services/cache";

export const greedyNailongRouter = Router();

const finishAttemptSchema = z.object({
  score: z.number().int().min(0).max(GREEDY_NAILONG_MAX_SCORE),
  foods: z.number().int().min(0).max(GREEDY_NAILONG_MAX_FOODS),
  length: z.number().int().min(GREEDY_NAILONG_START_LENGTH).max(GREEDY_NAILONG_MAX_LENGTH),
  durationMs: z.number().int().min(0).max(GREEDY_NAILONG_MAX_ATTEMPT_MS),
});

async function loadLeaderboard(currentUserId?: number, newlyUnlockedCodes: string[] = []) {
  const aggregates = await prisma.greedyNailongAttempt.groupBy({
    by: ["userId"],
    where: { status: "completed", score: { not: null } },
    _max: { score: true, length: true, completedAt: true },
    _sum: { score: true, foods: true },
    _count: { _all: true },
  });
  const sorted = aggregates
    .map((row) => ({
      userId: row.userId,
      bestScore: row._max.score ?? 0,
      bestLength: row._max.length ?? 0,
      games: row._count._all,
      totalScore: row._sum.score ?? 0,
      totalFoods: row._sum.foods ?? 0,
      updatedAt: row._max.completedAt,
    }))
    .sort((left, right) => right.bestScore - left.bestScore || left.userId - right.userId);
  const users = sorted.length
    ? await prisma.user.findMany({
      where: { id: { in: sorted.map((row) => row.userId) }, status: { not: "banned" } },
      select: { id: true, nickname: true, avatar: true },
    })
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));
  const eligible = sorted.filter((row) => userById.has(row.userId));
  const [achievementCounts, unlockedAchievements] = await Promise.all([
    eligible.length
      ? prisma.greedyNailongAchievement.groupBy({
        by: ["userId"],
        where: { userId: { in: eligible.map((row) => row.userId) } },
        _count: { _all: true },
      })
      : Promise.resolve([]),
    currentUserId
      ? prisma.greedyNailongAchievement.findMany({
        where: { userId: currentUserId },
        select: { code: true, unlockedAt: true },
      })
      : Promise.resolve([]),
  ]);
  const achievementCountByUserId = new Map(achievementCounts.map((row) => [row.userId, row._count._all]));
  let lastScore: number | null = null;
  let lastRank = 0;
  const ranked = eligible.map((row, index) => {
    const user = userById.get(row.userId)!;
    if (row.bestScore !== lastScore) {
      lastRank = index + 1;
      lastScore = row.bestScore;
    }
    return {
      rank: lastRank,
      userId: row.userId,
      name: publicFlightName(user.nickname),
      avatar: publicAvatarValue(user),
      bestScore: row.bestScore,
      bestLength: row.bestLength,
      games: row.games,
      totalScore: row.totalScore,
      totalFoods: row.totalFoods,
      achievementCount: achievementCountByUserId.get(row.userId) ?? 0,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    };
  });
  const me = currentUserId ? ranked.find((row) => row.userId === currentUserId) ?? null : null;
  const unlockedByCode = new Map(unlockedAchievements.map((item) => [item.code, item.unlockedAt]));
  const achievementStats = {
    games: me?.games ?? 0,
    bestScore: me?.bestScore ?? 0,
    totalScore: me?.totalScore ?? 0,
    bestLength: me?.bestLength ?? 0,
    totalFoods: me?.totalFoods ?? 0,
  };
  return {
    leaderboard: ranked.slice(0, 30),
    me,
    totalPlayers: ranked.length,
    achievements: GREEDY_NAILONG_ACHIEVEMENTS.map((achievement) => {
      const unlockedAt = unlockedByCode.get(achievement.code);
      return {
        code: achievement.code,
        title: achievement.title,
        description: achievement.description,
        icon: achievement.icon,
        target: achievement.target,
        progress: unlockedAt ? achievement.target : greedyNailongAchievementProgress(achievement, achievementStats),
        unlocked: Boolean(unlockedAt),
        unlockedAt: unlockedAt?.toISOString() ?? null,
      };
    }),
    newlyUnlocked: GREEDY_NAILONG_ACHIEVEMENTS
      .filter((achievement) => newlyUnlockedCodes.includes(achievement.code))
      .map((achievement) => ({ code: achievement.code, title: achievement.title, icon: achievement.icon })),
  };
}

async function unlockAchievementsForUser(userId: number, unlockedAt: Date) {
  const stats = await prisma.greedyNailongAttempt.aggregate({
    where: { userId, status: "completed", score: { not: null } },
    _max: { score: true, length: true },
    _sum: { score: true, foods: true },
    _count: { _all: true },
  });
  const codes = earnedGreedyNailongAchievementCodes({
    games: stats._count._all,
    bestScore: stats._max.score ?? 0,
    totalScore: stats._sum.score ?? 0,
    bestLength: stats._max.length ?? 0,
    totalFoods: stats._sum.foods ?? 0,
  });
  const existingAchievements = codes.length
    ? await prisma.greedyNailongAchievement.findMany({
      where: { userId, code: { in: codes } },
      select: { code: true },
    })
    : [];
  const existingCodes = new Set(existingAchievements.map((achievement) => achievement.code));
  const newlyUnlockedCodes = codes.filter((code) => !existingCodes.has(code));
  if (newlyUnlockedCodes.length) {
    await prisma.greedyNailongAchievement.createMany({
      data: newlyUnlockedCodes.map((code) => ({ userId, code, unlockedAt })),
      skipDuplicates: true,
    });
  }
  return newlyUnlockedCodes;
}

greedyNailongRouter.get("/leaderboard", authOptional, async (req, res, next) => {
  try {
    // 匿名访客看到的是同一份榜单：短时缓存，避免每次请求都对全部成绩做聚合。
    const userId = req.user?.userId;
    ok(res, userId ? await loadLeaderboard(userId) : await withCache("game-leaderboard", ["greedy-nailong"], 15_000, () => loadLeaderboard()));
  } catch (error) {
    next(error);
  }
});

greedyNailongRouter.post("/attempts", authRequired, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const now = new Date();
    const attempt = await prisma.$transaction(async (tx) => {
      await tx.greedyNailongAttempt.updateMany({
        where: { userId, status: "active" },
        data: { status: "abandoned", completedAt: now },
      });
      return tx.greedyNailongAttempt.create({ data: { userId, startedAt: now } });
    });
    ok(res, { id: attempt.id, startedAt: attempt.startedAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

greedyNailongRouter.post("/attempts/:id/abandon", authRequired, async (req, res, next) => {
  try {
    const attemptId = Number(req.params.id);
    if (!Number.isInteger(attemptId) || attemptId <= 0) throw Errors.badRequest("对局记录无效");
    const updated = await prisma.greedyNailongAttempt.updateMany({
      where: { id: attemptId, userId: req.user!.userId, status: "active" },
      data: { status: "abandoned", completedAt: new Date() },
    });
    ok(res, { abandoned: updated.count === 1 });
  } catch (error) {
    next(error);
  }
});

greedyNailongRouter.post("/attempts/:id/finish", authRequired, validate(finishAttemptSchema), async (req, res, next) => {
  try {
    const attemptId = Number(req.params.id);
    if (!Number.isInteger(attemptId) || attemptId <= 0) throw Errors.badRequest("对局记录无效");
    const attempt = await prisma.greedyNailongAttempt.findFirst({
      where: { id: attemptId, userId: req.user!.userId },
    });
    if (!attempt) throw Errors.notFound("对局记录不存在");
    if (attempt.status !== "active") throw Errors.conflict("本局成绩已经处理");
    const input = req.body as z.infer<typeof finishAttemptSchema>;
    const completedAt = new Date();
    const validationError = validateGreedyNailongResult({
      ...input,
      serverElapsedMs: completedAt.getTime() - attempt.startedAt.getTime(),
    });
    if (validationError) {
      await prisma.greedyNailongAttempt.update({
        where: { id: attempt.id },
        data: { status: "rejected", completedAt },
      });
      throw Errors.badRequest(validationError);
    }
    const updated = await prisma.greedyNailongAttempt.updateMany({
      where: { id: attempt.id, userId: req.user!.userId, status: "active" },
      data: { status: "completed", score: input.score, foods: input.foods, length: input.length, durationMs: input.durationMs, completedAt },
    });
    if (updated.count !== 1) throw Errors.conflict("本局成绩已经处理");
    const newlyUnlockedCodes = await unlockAchievementsForUser(req.user!.userId, completedAt);
    ok(res, await loadLeaderboard(req.user!.userId, newlyUnlockedCodes), "成绩与成就已同步");
  } catch (error) {
    next(error);
  }
});
