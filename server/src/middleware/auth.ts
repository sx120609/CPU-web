import type { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { verifyToken } from "../utils/jwt";
import { Errors } from "../utils/response";

async function hydrateUserFromToken(token: string) {
  const payload = verifyToken(token);
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, username: true, role: true, status: true },
  });
  if (!user) throw Errors.unauthorized("账号不存在或已失效，请重新登录");
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
  return {
    ...payload,
    studentId: user.username,
    role: user.role,
  };
}

export async function authRequired(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(Errors.unauthorized());
  }
  const token = header.slice(7);
  try {
    req.user = await hydrateUserFromToken(token);
    next();
  } catch (error: any) {
    if (error?.status && error?.code) {
      next(error);
      return;
    }
    next(Errors.unauthorized("登录已过期，请重新登录"));
  }
}

export async function authOptional(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    req.user = undefined;
    return next();
  }
  const token = header.slice(7);
  try {
    req.user = await hydrateUserFromToken(token);
  } catch {
    req.user = undefined;
  }
  next();
}
