import type { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { signToken, verifySessionTokenSignature, verifyToken } from "../utils/jwt";
import { Errors } from "../utils/response";
import { isCookieAuthRequest, issueBrowserSession, updateBrowserSession } from "../services/browserSession";

function requestAuthToken(req: Request) {
  if (req.browserSession?.siteToken) return req.browserSession.siteToken;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return "";
}

async function hydrateUserFromToken(token: string, allowExpiredSessionToken = false) {
  const payload = allowExpiredSessionToken ? verifySessionTokenSignature(token) : verifyToken(token);
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      username: true,
      role: true,
      voiceHubRole: true,
      lostFoundRole: true,
      status: true,
    },
  });
  if (!user) throw Errors.unauthorized("账号不存在或已失效，请重新登录");
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
  return {
    ...payload,
    studentId: user.username,
    role: user.role,
    voiceHubRole: user.voiceHubRole,
    lostFoundRole: user.lostFoundRole,
  };
}

async function hydrateBrowserSessionUser(req: Request, res: Response, token: string) {
  try {
    return await hydrateUserFromToken(token);
  } catch (error) {
    if (!req.browserSession) throw error;
    const user = await hydrateUserFromToken(token, true);
    const renewedToken = signToken({
      userId: user.userId,
      studentId: user.studentId,
      role: user.role,
      campus: user.campus || "",
      voiceHubRole: user.voiceHubRole,
      lostFoundRole: user.lostFoundRole,
    });
    await updateBrowserSession(req, res, { siteToken: renewedToken });
    return user;
  }
}

export async function authRequired(req: Request, res: Response, next: NextFunction) {
  const token = requestAuthToken(req);
  if (!token) {
    return next(Errors.unauthorized());
  }
  try {
    req.user = await hydrateBrowserSessionUser(req, res, token);
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

export async function authOptional(req: Request, res: Response, next: NextFunction) {
  const token = requestAuthToken(req);
  if (!token) {
    req.user = undefined;
    return next();
  }
  try {
    req.user = await hydrateBrowserSessionUser(req, res, token);
  } catch {
    req.user = undefined;
  }
  next();
}
