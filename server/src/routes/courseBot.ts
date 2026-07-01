import { Router } from "express";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import type { Request, Response, NextFunction } from "express";

export const courseBotRouter = Router();

/**
 * 刷课工具后端（视频免费 / AI 答题计费）
 *
 * 客户端流程：
 *   1. SSO 登录拿 JWT（复用 /auth/sso-*）
 *   2. GET  /course-bot/quota     查 AI 答题余额
 *   3. 视频刷课期间定时 POST /course-bot/heartbeat 校验登录态
 *   4. POST /course-bot/ai-answer AI 答题（扣额度）—— v2
 *
 * 所有接口挂 authRequired，req.user 由中间件注入。
 */

async function getOrCreateQuota(userId: number) {
  let q = await prisma.courseBotQuota.findUnique({ where: { userId } });
  if (!q) {
    q = await prisma.courseBotQuota.create({ data: { userId } });
  }
  return q;
}

/** 查 AI 答题额度（视频刷课免费，不查额度） */
courseBotRouter.get("/quota", async (req, res, next) => {
  try {
    const q = await getOrCreateQuota(req.user!.userId);
    ok(res, {
      aiBalance: q.aiBalance,
      totalConsumed: q.totalConsumed,
      totalGranted: q.totalGranted,
      videoFree: true,
    });
  } catch (e) { next(e); }
});

/**
 * 心跳：视频刷课期间客户端定时调用（建议 60-90s 一次）
 * 作用：校验 JWT 有效性 + 账号状态 + 下发运行配置
 * 视频免费，但登录态失效或账号被封必须立即停止
 */
courseBotRouter.post("/heartbeat", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, username: true, nickname: true, status: true },
    });
    if (!user) throw Errors.unauthorized("账号不存在或已失效");
    if (user.status === "banned") throw Errors.forbidden("账号已被封禁");

    const q = await getOrCreateQuota(user.id);
    ok(res, {
      alive: true,
      user: { id: user.id, username: user.username, nickname: user.nickname },
      quota: { aiBalance: q.aiBalance },
      config: {
        heartbeatIntervalMs: 75_000,
        videoSpeedMax: 2,
        aiAnswerEnabled: q.aiBalance > 0,
      },
    });
  } catch (e) { next(e); }
});

/**
 * AI 答题（v2 预留）：扣额度 → 调 LLM → 记 UsageLog（同时作为错题沉淀）
 * 先占位，接入 AI 时再实现扣费与调用逻辑
 */
courseBotRouter.post("/ai-answer", async (req, res, next) => {
  try {
    const q = await getOrCreateQuota(req.user!.userId);
    if (q.aiBalance <= 0) throw Errors.forbidden("AI 答题额度不足，请获取额度后再使用");
    throw Errors.badRequest("AI 答题功能即将上线，敬请期待");
  } catch (e) { next(e); }
});
