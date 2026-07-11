import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { buildRedisKey, incrementRedisKeyWithTtl } from "../services/redis";

const localCounters = new Map<string, { count: number; expiresAt: number }>();

function requestKey(req: Request, namespace: string) {
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase().slice(0, 128) : "";
  const digest = crypto.createHash("sha256").update(`${ip}\0${username}`).digest("hex");
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

export function securityRateLimit(namespace: string, limit: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await increment(requestKey(req, namespace), windowMs);
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
