import type { Request, Response, NextFunction } from "express";
import { Errors } from "../utils/response";

/** 仅 admin 可访问 */
export function adminOnly(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(Errors.unauthorized());
  if (req.user.role !== "admin") return next(Errors.forbidden("仅管理员可操作"));
  next();
}

/** mod 或 admin */
export function modOrAbove(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(Errors.unauthorized());
  if (req.user.role !== "admin" && req.user.role !== "mod") {
    return next(Errors.forbidden("仅论坛管理员 / 超级管理员可操作"));
  }
  next();
}
