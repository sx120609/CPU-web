import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authOptional, authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, HttpError, ok } from "../utils/response";
import {
  earnedYaodaFlightAchievementCodes,
  publicFlightName,
  validateYaodaFlightResult,
  yaodaFlightAchievementProgress,
  YAODA_FLIGHT_ACHIEVEMENTS,
  YAODA_FLIGHT_MAX_ATTEMPT_MS,
  YAODA_FLIGHT_MAX_SCORE,
} from "../services/yaodaFlightPolicy";

export const yaodaFlightRouter = Router();

const finishAttemptSchema = z.object({
  score: z.number().int().min(0).max(YAODA_FLIGHT_MAX_SCORE),
  durationMs: z.number().int().min(0).max(YAODA_FLIGHT_MAX_ATTEMPT_MS),
});

async function loadLeaderboard(currentUserId?: number, newlyUnlockedCodes: string[] = []) {
  const aggregates = await prisma.yaodaFlightAttempt.groupBy({
    by: ["userId"],
    where: { status: "completed", score: { not: null } },
    _max: { score: true, completedAt: true },
    _sum: { score: true },
    _count: { _all: true },
  });
  const sorted = aggregates
    .map((row) => ({
      userId: row.userId,
      bestScore: row._max.score ?? 0,
      games: row._count._all,
      totalScore: row._sum.score ?? 0,
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
      ? prisma.yaodaFlightAchievement.groupBy({
        by: ["userId"],
        where: { userId: { in: eligible.map((row) => row.userId) } },
        _count: { _all: true },
      })
      : Promise.resolve([]),
    currentUserId
      ? prisma.yaodaFlightAchievement.findMany({
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
      avatar: user.avatar,
      bestScore: row.bestScore,
      games: row.games,
      totalScore: row.totalScore,
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
  };
  return {
    leaderboard: ranked.slice(0, 30),
    me,
    totalPlayers: ranked.length,
    achievements: YAODA_FLIGHT_ACHIEVEMENTS.map((achievement) => {
      const unlockedAt = unlockedByCode.get(achievement.code);
      return {
        code: achievement.code,
        title: achievement.title,
        description: achievement.description,
        icon: achievement.icon,
        target: achievement.target,
        progress: unlockedAt ? achievement.target : yaodaFlightAchievementProgress(achievement, achievementStats),
        unlocked: Boolean(unlockedAt),
        unlockedAt: unlockedAt?.toISOString() ?? null,
      };
    }),
    newlyUnlocked: YAODA_FLIGHT_ACHIEVEMENTS
      .filter((achievement) => newlyUnlockedCodes.includes(achievement.code))
      .map((achievement) => ({ code: achievement.code, title: achievement.title, icon: achievement.icon })),
  };
}

yaodaFlightRouter.get("/leaderboard", authOptional, async (req, res, next) => {
  try {
    ok(res, await loadLeaderboard(req.user?.userId));
  } catch (error) {
    next(error);
  }
});

yaodaFlightRouter.post("/attempts", authRequired, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const recentCount = await prisma.yaodaFlightAttempt.count({
      where: { userId, startedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
    });
    if (recentCount >= 12) throw new HttpError(429, 4029, "开局过于频繁，请稍后再试");
    const now = new Date();
    const attempt = await prisma.$transaction(async (tx) => {
      await tx.yaodaFlightAttempt.updateMany({
        where: { userId, status: "active" },
        data: { status: "abandoned", completedAt: now },
      });
      return tx.yaodaFlightAttempt.create({ data: { userId, startedAt: now } });
    });
    ok(res, { id: attempt.id, startedAt: attempt.startedAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

yaodaFlightRouter.post("/attempts/:id/abandon", authRequired, async (req, res, next) => {
  try {
    const attemptId = Number(req.params.id);
    if (!Number.isInteger(attemptId) || attemptId <= 0) throw Errors.badRequest("飞行记录无效");
    const updated = await prisma.yaodaFlightAttempt.updateMany({
      where: { id: attemptId, userId: req.user!.userId, status: "active" },
      data: { status: "abandoned", completedAt: new Date() },
    });
    ok(res, { abandoned: updated.count === 1 });
  } catch (error) {
    next(error);
  }
});

yaodaFlightRouter.post("/attempts/:id/finish", authRequired, validate(finishAttemptSchema), async (req, res, next) => {
  try {
    const attemptId = Number(req.params.id);
    if (!Number.isInteger(attemptId) || attemptId <= 0) throw Errors.badRequest("飞行记录无效");
    const attempt = await prisma.yaodaFlightAttempt.findFirst({
      where: { id: attemptId, userId: req.user!.userId },
    });
    if (!attempt) throw Errors.notFound("飞行记录不存在");
    if (attempt.status !== "active") throw Errors.conflict("本局成绩已经处理");
    const input = req.body as z.infer<typeof finishAttemptSchema>;
    const completedAt = new Date();
    const validationError = validateYaodaFlightResult({
      ...input,
      serverElapsedMs: completedAt.getTime() - attempt.startedAt.getTime(),
    });
    if (validationError) {
      await prisma.yaodaFlightAttempt.update({
        where: { id: attempt.id },
        data: { status: "rejected", completedAt },
      });
      throw Errors.badRequest(validationError);
    }
    const updated = await prisma.yaodaFlightAttempt.updateMany({
      where: { id: attempt.id, userId: req.user!.userId, status: "active" },
      data: { status: "completed", score: input.score, durationMs: input.durationMs, completedAt },
    });
    if (updated.count !== 1) throw Errors.conflict("本局成绩已经处理");
    const stats = await prisma.yaodaFlightAttempt.aggregate({
      where: { userId: req.user!.userId, status: "completed", score: { not: null } },
      _max: { score: true },
      _sum: { score: true },
      _count: { _all: true },
    });
    const earnedCodes = earnedYaodaFlightAchievementCodes({
      games: stats._count._all,
      bestScore: stats._max.score ?? 0,
      totalScore: stats._sum.score ?? 0,
      currentScore: input.score,
    });
    const existingAchievements = await prisma.yaodaFlightAchievement.findMany({
      where: { userId: req.user!.userId, code: { in: earnedCodes } },
      select: { code: true },
    });
    const existingCodes = new Set(existingAchievements.map((achievement) => achievement.code));
    const newlyUnlockedCodes = earnedCodes.filter((code) => !existingCodes.has(code));
    if (newlyUnlockedCodes.length) {
      await prisma.yaodaFlightAchievement.createMany({
        data: newlyUnlockedCodes.map((code) => ({ userId: req.user!.userId, code, unlockedAt: completedAt })),
        skipDuplicates: true,
      });
    }
    ok(res, await loadLeaderboard(req.user!.userId, newlyUnlockedCodes), "成绩与成就已同步");
  } catch (error) {
    next(error);
  }
});
