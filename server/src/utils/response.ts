/**
 * 统一响应外壳：
 *   成功：{ code: 0, data, message: '' }
 *   失败：{ code: <非0>, data: null, message }
 */
import type { Response } from "express";

export function ok<T>(res: Response, data: T, message = "") {
  return res.json({ code: 0, data, message });
}

export function fail(res: Response, code = 1, message = "请求失败", status = 400) {
  return res.status(status).json({ code, data: null, message });
}

export class HttpError extends Error {
  constructor(public status: number, public code: number, message: string) {
    super(message);
  }
}

export const Errors = {
  unauthorized: (msg = "请先登录") => new HttpError(401, 4001, msg),
  forbidden: (msg = "无权访问") => new HttpError(403, 4003, msg),
  notFound: (msg = "资源不存在") => new HttpError(404, 4004, msg),
  badRequest: (msg = "请求参数错误") => new HttpError(400, 4000, msg),
  conflict: (msg = "冲突") => new HttpError(409, 4009, msg),
  server: (msg = "服务器内部错误") => new HttpError(500, 5000, msg),
};
