import { Router } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import { config } from "../config";
import { authOptional } from "../middleware/auth";
import { prisma } from "../prisma";
import {
  consumeCampusAssistantQuota,
  getCampusAssistantQuotaStatus,
  refundCampusAssistantQuota,
  type CampusAssistantQuotaReservation,
} from "../services/campusAssistantQuota";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { buildUserTrustSnapshot } from "../services/userTrust";
import {
  buildLearningAssistantAiRequestBody,
  learningAssistantAiBodySchema,
  learningAssistantAiResponse,
  LEARNING_ASSISTANT_AI_INSTRUCTIONS,
  requestLearningAssistantAi,
  type LearningAssistantAiBody,
} from "../services/learningAssistantAi";
import { Errors, ok } from "../utils/response";

export const oauthRouter = Router();

const authorizationQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().url().max(2048),
  scope: z.string().max(200).default("openid profile ai"),
  state: z.string().min(1).max(2048),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
});

const tokenBodySchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(32).max(512),
  redirect_uri: z.string().url().max(2048),
  client_id: z.string().min(1).max(100),
  code_verifier: z.string().min(43).max(128),
});

const revokeBodySchema = z.object({
  token: z.string().min(32).max(512),
  client_id: z.string().min(1).max(100),
}).strict();

export const OAUTH_AI_INSTRUCTIONS = LEARNING_ASSISTANT_AI_INSTRUCTIONS;

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function clientIsValid(clientId: string, redirectUri: string) {
  if (clientId !== config.oauthClientId) return false;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  return config.oauthAllowedRedirectUris.some((allowed) => {
    try {
      const allowedUrl = new URL(allowed);
      if (allowedUrl.origin === url.origin) return true;
      return allowedUrl.protocol === "http:"
        && (allowedUrl.hostname === "127.0.0.1" || allowedUrl.hostname === "localhost")
        && url.protocol === "http:"
        && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    } catch {
      return false;
    }
  });
}

function redirectWithError(redirectUri: string, state: string, error: string) {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("state", state);
  return target.toString();
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(req: Request) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function loadAccessToken(req: Request) {
  const raw = bearerToken(req);
  if (!raw) throw Errors.unauthorized("缺少 OAuth2 access token");
  const token = await prisma.oAuthAccessToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!token || token.revokedAt || token.expiresAt <= new Date()) {
    throw Errors.unauthorized("OAuth2 access token 无效或已过期");
  }
  await prisma.oAuthAccessToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  if (token.user.status === "banned") throw Errors.forbidden("账号已被封禁");
  return token;
}

oauthRouter.get("/authorize", authOptional, async (req, res, next) => {
  try {
    const input = authorizationQuerySchema.parse(req.query);
    if (!clientIsValid(input.client_id, input.redirect_uri)) {
      throw Errors.badRequest("client_id 或 redirect_uri 无效");
    }
    const requestedScopes = new Set(input.scope.split(/\s+/).filter(Boolean));
    const allowedScopes = new Set(["openid", "profile", "ai"]);
    if ([...requestedScopes].some((scope) => !allowedScopes.has(scope))) {
      return res.redirect(redirectWithError(input.redirect_uri, input.state, "invalid_scope"));
    }
    if (!req.user) return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
    const code = randomBytes(48).toString("base64url");
    await prisma.oAuthAuthorizationCode.create({
      data: {
        codeHash: hashToken(code),
        clientId: input.client_id,
        redirectUri: input.redirect_uri,
        userId: req.user.userId,
        scope: [...requestedScopes].join(" "),
        codeChallenge: input.code_challenge,
        codeChallengeMethod: input.code_challenge_method,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const target = new URL(input.redirect_uri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", input.state);
    return res.redirect(target.toString());
  } catch (error) {
    next(error);
  }
});

oauthRouter.post("/token", async (req, res, next) => {
  try {
    const input = tokenBodySchema.parse(req.body);
    if (!clientIsValid(input.client_id, input.redirect_uri)) throw Errors.badRequest("客户端参数无效");
    const record = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashToken(String(input.code)) } });
    if (!record || record.usedAt || record.expiresAt <= new Date() || record.clientId !== input.client_id || record.redirectUri !== input.redirect_uri) {
      throw Errors.badRequest("authorization code 无效或已使用");
    }
    const expectedChallenge = createHash("sha256").update(input.code_verifier).digest("base64url");
    if (!constantTimeEqual(expectedChallenge, record.codeChallenge)) throw Errors.badRequest("PKCE 校验失败");
    const consumed = await prisma.oAuthAuthorizationCode.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw Errors.badRequest("authorization code 无效或已使用");
    const accessToken = randomBytes(48).toString("base64url");
    await prisma.oAuthAccessToken.create({
      data: {
        tokenHash: hashToken(accessToken),
        clientId: record.clientId,
        userId: record.userId,
        scope: record.scope,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 30 * 24 * 60 * 60,
      scope: record.scope,
    });
  } catch (error) {
    next(error);
  }
});

oauthRouter.post("/revoke", async (req, res, next) => {
  try {
    const input = revokeBodySchema.parse(req.body);
    if (input.client_id !== config.oauthClientId) throw Errors.badRequest("客户端参数无效");
    await prisma.oAuthAccessToken.updateMany({
      where: { tokenHash: hashToken(input.token), clientId: input.client_id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.status(200).json({});
  } catch (error) {
    next(error);
  }
});

oauthRouter.get("/userinfo", async (req, res, next) => {
  try {
    const token = await loadAccessToken(req);
    if (!token.scope.split(/\s+/).includes("profile")) throw Errors.forbidden("token 没有 profile scope");
    const quota = await getCampusAssistantQuotaStatus(token.userId);
    return ok(res, {
      sub: String(token.userId),
      user: {
        id: token.user.id,
        nickname: token.user.nickname,
        avatar: token.user.avatar,
        ...buildUserTrustSnapshot(token.user),
      },
      level: quota.level,
      levelName: quota.levelName,
      aiBalance: quota.totalRemaining,
      dailyQuota: quota.dailyQuota,
      usedToday: quota.used,
      dailyRemaining: quota.remaining,
      assistantPoints: quota.points,
    });
  } catch (error) {
    next(error);
  }
});

oauthRouter.post("/v1/responses", securityRateLimit("oauth-ai", 20, 60_000), async (req, res, next) => {
  let quotaReservation: CampusAssistantQuotaReservation | null = null;
  let userId = 0;
  let quotaRefunded = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let responseCompleted = false;
  try {
    const token = await loadAccessToken(req);
    userId = token.userId;
    if (!token.scope.split(/\s+/).includes("ai")) throw Errors.forbidden("token 没有 ai scope");
    const body = learningAssistantAiBodySchema.parse(req.body);
    const consumedQuota = await consumeCampusAssistantQuota(token.userId);
    quotaReservation = consumedQuota.reservation;
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 120_000);
    res.on("close", () => {
      if (!responseCompleted) controller.abort();
    });
    const aiResult = await requestLearningAssistantAi(body, token.clientId, controller.signal);
    res.status(aiResult.status);
    res.setHeader("Content-Type", aiResult.contentType);
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    if (!aiResult.ok) {
      await refundCampusAssistantQuota(token.userId, quotaReservation);
      quotaRefunded = true;
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
      responseCompleted = true;
      return res.send(aiResult.errorBody);
    }
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    const result = res.json(learningAssistantAiResponse(aiResult.outputText || ""));
    responseCompleted = true;
    return result;
  } catch (error) {
    if (timeout) clearTimeout(timeout);
    if (quotaReservation && !quotaRefunded && !responseCompleted) {
      await refundCampusAssistantQuota(userId, quotaReservation).catch(() => {});
    }
    next(error);
  }
});

export function buildOAuthAiRequestBody(body: LearningAssistantAiBody, model: string, endpoint: string) {
  return buildLearningAssistantAiRequestBody(body, model, endpoint);
}
