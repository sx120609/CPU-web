import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { buildRedisKey, incrementRedisKeyWithTtl } from "../services/redis";

const localCounters = new Map<string, { count: number; expiresAt: number }>();

function requestKey(req: Request, namespace: string, subject?: string) {
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase().slice(0, 128) : "";
  const digest = crypto.createHash("sha256").update(subject ? `subject\0${subject}` : `${ip}\0${username}`).digest("hex");
  return buildRedisKey("security", "rate-limit", namespace, digest);
}

async function increment(key: string, windowMs: number) {
  const shared = await incrementRedisKeyWithTtl(key, windowMs);
  if (shared !== null) return shared;
  const now = Date.now();
  const current = localCounters.get(key);
  if (!current || current.expiresAt <= now) {
    localCounters.set(key, { count: 1, expiresAt: now + windowMs });
    return 1;
  }
  current.count += 1;
  return current.count;
}

/**
 * 默认按 IP（登录接口再加用户名）计数。校园网里很多人共用一个出口 IP，已登录的接口
 * 传 `subject` 改成按账号计数，免得一个人把整栋楼的额度用完。
 */
export function securityRateLimit(
  namespace: string,
  limit: number,
  windowMs: number,
  subject?: (req: Request) => string | number | undefined,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const who = subject?.(req);
      const count = await increment(requestKey(req, namespace, who === undefined ? undefined : String(who)), windowMs);
      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
      if (count > limit) {
        res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({ code: 4029, data: null, message: "尝试次数过多，请稍后再试" });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
