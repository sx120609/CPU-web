import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { prisma } from "../prisma";
import {
  consumeCampusAssistantQuota,
  getCampusAssistantQuotaStatus,
  refundCampusAssistantQuota,
  type CampusAssistantQuotaReservation,
} from "../services/campusAssistantQuota";
import { getSiteConfig, resolveAiServiceCandidatesForScene } from "../services/siteSettings";
import { requestAiJson } from "../services/topicAiReview";
import { Errors, ok } from "../utils/response";
import { authenticateIntegration } from "./shopIntegration";

export const noAiIntegrationRouter = Router();

// 去AI味（noai.cputime.cn）的改写请求走拾间 AI 对话线路，提示词由 No-AI 自己组织。
const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1).max(60_000),
  }).strict()).min(1).max(12),
  maxTokens: z.number().int().positive().max(16_000).optional(),
  userId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

noAiIntegrationRouter.post("/no-ai/chat", async (req, res, next) => {
  try {
    authenticateNoAi(req);
    const input = chatSchema.parse(req.body);
    if (input.userId) {
      const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { status: true } });
      if (!user || ["banned", "deleting", "deleted"].includes(user.status)) throw Errors.forbidden("账号不可用");
    }
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableFinished) controller.abort(); });
    const site = getSiteConfig();
    const result = await requestAiJson(input.messages, {
      model: site.assistantModel,
      // 拾间 AI 对话场景没有单独的备选模型，不能落到默认的审核备选模型上
      fallbackModels: "",
      providerConfigs: resolveAiServiceCandidatesForScene(site, "assistant"),
      maxTokens: input.maxTokens ?? 8000,
      maxTransientRetries: 1,
      upstreamTimeoutMs: 540_000,
      enablePromptCache: false,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]),
      logContext: { kind: "no-ai", createdById: input.userId ?? null, targetLabel: "去AI味改写" },
    });
    res.setHeader("Cache-Control", "no-store");
    ok(res, {
      content: typeof result.content === "string" ? result.content : JSON.stringify(result.content ?? ""),
      model: result.model,
    });
  } catch (error) { next(error); }
});

// 额度：一次改写任务按篇幅扣若干次拾间 AI 额度（日额度用完扣点数），任务失败时 No-AI 原样退回。
const userIdSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reservationSchema = z.object({
  source: z.enum(["daily", "points"]),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  transactionId: z.number().int().positive().optional(),
  pointCost: z.number().positive().optional(),
}).strict();
const consumeSchema = z.object({ userId: userIdSchema, units: z.number().int().min(1).max(8).default(1) }).strict();
const refundSchema = z.object({ userId: userIdSchema, reservations: z.array(reservationSchema).min(1).max(8) }).strict();

function authenticateNoAi(req: { header(name: string): string | undefined }) {
  authenticateIntegration(String(req.header("x-noai-integration-secret") || ""), config.noAiIntegrationSecret);
}

noAiIntegrationRouter.get("/no-ai/users/:userId/quota", async (req, res, next) => {
  try {
    authenticateNoAi(req);
    res.setHeader("Cache-Control", "no-store");
    ok(res, await getCampusAssistantQuotaStatus(userIdSchema.parse(req.params.userId)));
  } catch (error) { next(error); }
});

noAiIntegrationRouter.post("/no-ai/quota/consume", async (req, res, next) => {
  try {
    authenticateNoAi(req);
    const { userId, units } = consumeSchema.parse(req.body);
    const reservations: CampusAssistantQuotaReservation[] = [];
    try {
      let status;
      for (let i = 0; i < units; i++) {
        const result = await consumeCampusAssistantQuota(userId);
        reservations.push(result.reservation);
        status = result;
      }
      const { reservation: _last, ...quota } = status!;
      res.setHeader("Cache-Control", "no-store");
      ok(res, { reservations, quota });
    } catch (error) {
      // 不够扣时把已经扣掉的退回去，要么全扣要么不扣
      for (const item of reservations) await refundCampusAssistantQuota(userId, item).catch(() => {});
      throw error;
    }
  } catch (error) { next(error); }
});

noAiIntegrationRouter.post("/no-ai/quota/refund", async (req, res, next) => {
  try {
    authenticateNoAi(req);
    const { userId, reservations } = refundSchema.parse(req.body);
    for (const item of reservations) await refundCampusAssistantQuota(userId, item);
    ok(res, { refunded: reservations.length });
  } catch (error) { next(error); }
});
