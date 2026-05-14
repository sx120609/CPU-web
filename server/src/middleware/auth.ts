import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";
import { Errors } from "../utils/response";

export function authRequired(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(Errors.unauthorized());
  }
  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(Errors.unauthorized("登录已过期，请重新登录"));
  }
}
