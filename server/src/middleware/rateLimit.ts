import rateLimit from "express-rate-limit";

/** 认证类接口限流：15 分钟内最多 10 次 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, data: null, message: "请求过于频繁，请稍后再试" },
});

/** 教务登录限流：15 分钟内最多 10 次 */
export const jwxtLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, data: null, message: "教务登录请求过于频繁，请稍后再试" },
});
