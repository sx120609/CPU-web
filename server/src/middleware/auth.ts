import type { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { verifyToken } from "../utils/jwt";
import { Errors } from "../utils/response";
import { isCookieAuthRequest, issueBrowserSession } from "../services/browserSession";

function requestAuthToken(req: Request) {
  if (req.browserSession?.siteToken) return req.browserSession.siteToken;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return "";
}

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

export async function authRequired(req: Request, res: Response, next: NextFunction) {
  const token = requestAuthToken(req);
  if (!token) {
    return next(Errors.unauthorized());
  }
  try {
    req.user = await hydrateUserFromToken(token);
    if (!req.browserSession && isCookieAuthRequest(req) && req.headers.authorization?.startsWith("Bearer ")) {
      const jwxtToken = String(req.headers["x-jwxt-token"] || "").trim();
      const session = await issueBrowserSession(res, { siteToken: token, ...(jwxtToken ? { jwxtToken } : {}) });
      req.browserSession = session;
    }
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
  const token = requestAuthToken(req);
  if (!token) {
    req.user = undefined;
    return next();
  }
  try {
    req.user = await hydrateUserFromToken(token);
  } catch {
    req.user = undefined;
  }
  next();
}
