import rateLimit from "express-rate-limit";
import { isDev } from "../config";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 30,
  message: { code: 4029, data: null, message: "请求过于频繁，请稍后再试" },
  standardHeaders: true,
  legacyHeaders: false,
});
