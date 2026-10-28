import jwt from "jsonwebtoken";
import { config } from "../config";

export interface JwtPayload {
  userId: number;
  studentId: string;
  role: string;
  campus: string;
  voiceHubRole?: string | null;
  lostFoundRole?: string | null;
  blockedUserIds?: number[];
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

/** Whether a token was rejected for itself (bad signature, expired, malformed), not for a failure elsewhere. */
export function isTokenVerificationError(error: unknown) {
  return error instanceof jwt.JsonWebTokenError;
}

/** 仅供已经通过随机 HttpOnly 服务端会话定位到的 JWT 续签使用。 */
export function verifySessionTokenSignature(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret, { ignoreExpiration: true }) as JwtPayload;
}
