import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/response";
import { ZodError } from "zod";
import { isDev } from "../config";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ code: err.code, data: null, message: err.message });
  }
  if (err instanceof ZodError) {
    const msg = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    return res.status(400).json({ code: 4000, data: null, message: "参数错误：" + msg });
  }
  if (isDev) {
    console.error("[error]", err);
  }
  const message = err instanceof Error ? err.message : "服务器内部错误";
  return res.status(500).json({ code: 5000, data: null, message });
}
