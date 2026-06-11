import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/response";
import { ZodError } from "zod";
import { isDev } from "../config";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const anyErr = err as { type?: string; status?: number; statusCode?: number; message?: string } | undefined;
  if (
    anyErr?.type === "entity.too.large" ||
    anyErr?.status === 413 ||
    anyErr?.statusCode === 413
  ) {
    return res.status(413).json({
      code: 4013,
      data: null,
      message: "上传内容过大，请压缩图片或更换更小的文件后重试",
    });
  }
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
  return res.status(500).json({ code: 5000, data: null, message: "服务器内部错误，请稍后再试" });
}
