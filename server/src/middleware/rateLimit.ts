import rateLimit from "express-rate-limit";
import { isDev } from "../config";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 30,
  message: { code: 4029, data: null, message: "请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const topicCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 1000 : 5,
  message: { code: 4029, data: null, message: "发帖过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const replyCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 1000 : 10,
  message: { code: 4029, data: null, message: "回复过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const likeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 1000 : 30,
  message: { code: 4029, data: null, message: "操作过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});
