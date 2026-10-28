import type { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { isTokenVerificationError, signToken, verifySessionTokenSignature, verifyToken } from "../utils/jwt";
import { Errors } from "../utils/response";
import { isCookieAuthRequest, issueBrowserSession, updateBrowserSession } from "../services/browserSession";

const LOGIN_SERVICE_UNAVAILABLE = "登录服务暂时不可用，请稍后重试";

function requestAuthToken(req: Request) {
  if (req.browserSession?.siteToken) return req.browserSession.siteToken;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return "";
}

async function hydrateUserFromToken(token: string, allowExpiredSessionToken = false, allowBanned = false) {
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
      blocksOwned: { select: { targetId: true } },
    },
  });
  if (!user) throw Errors.unauthorized("账号不存在或已失效，请重新登录");
  if (["deleting", "deleted"].includes(user.status)) throw Errors.unauthorized("账户已申请删除，原有登录凭据已失效");
  if (user.status === "banned" && !allowBanned) throw Errors.forbidden("账号已被封禁");
  return {
    ...payload,
    studentId: user.username,
    role: user.role,
    voiceHubRole: user.voiceHubRole,
    lostFoundRole: user.lostFoundRole,
    blockedUserIds: user.blocksOwned?.map((block) => block.targetId) || [],
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

/**
 * Only a credential that is itself invalid ends the sign-in (401). When the session store or the
 * database fails, the answer is 503: a 401 makes every client sign the user out, drop the 教务
 * authorization with it and clear the cached timetable, all for an outage on our side.
 */
export async function authRequired(req: Request, res: Response, next: NextFunction) {
  const token = requestAuthToken(req);
  if (!token) {
    return next(req.browserSessionUnavailable ? Errors.unavailable(LOGIN_SERVICE_UNAVAILABLE) : Errors.unauthorized());
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
    next(isTokenVerificationError(error) ? Errors.unauthorized("登录已过期，请重新登录") : Errors.unavailable(LOGIN_SERVICE_UNAVAILABLE));
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

export async function authForAccountDeletion(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = requestAuthToken(req);
    if (!token) throw Errors.unauthorized();
    req.user = await hydrateUserFromToken(token, Boolean(req.browserSession), true);
    next();
  } catch (error) { next(error); }
}
