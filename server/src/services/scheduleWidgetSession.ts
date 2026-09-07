import { prisma } from "../prisma";
import { config } from "../config";
import { getEphemeralValue, setEphemeralValue } from "./cache";
import { buildRedisKey } from "./redis";
import { decryptJwxtSensitiveJson, encryptJwxtSensitiveJson } from "./jwxtSessionCrypto";
import { getStatus } from "./jwxtTransport";
import { Errors } from "../utils/response";
import { scheduleWidgetCredentialRefreshData } from "./scheduleWidget";

type RememberedSession = { userId: number; username: string; token: string; confirmedAt: number };

export function createScheduleWidgetSessionService(readStatus: typeof getStatus = getStatus) {
  return {
    async latest(userId: number): Promise<RememberedSession | null> {
      const raw = await getEphemeralValue(buildRedisKey("jwxt", "user-session", String(userId)));
      if (!raw) return null;
      try {
        const { value } = decryptJwxtSensitiveJson<RememberedSession>("widget-user-session", String(userId), raw);
        return value?.userId === userId && typeof value.token === "string" && value.token.length > 0
          && typeof value.username === "string" && Number.isFinite(value.confirmedAt) ? value : null;
      } catch { return null; }
    },

    async recordLogin(userId: number, username: string, token: string) {
      if (!Number.isSafeInteger(userId) || userId <= 0 || !username || !token) throw Errors.badRequest("无效的教务会话关联");
      await setEphemeralValue(
        buildRedisKey("jwxt", "user-session", String(userId)),
        encryptJwxtSensitiveJson("widget-user-session", String(userId), { userId, username, token, confirmedAt: Date.now() }),
        config.jwxtSessionIdleMs,
      );
      return prisma.scheduleWidgetToken.updateMany({
        where: { userId, revokedAt: null, jwxtToken: { not: token } },
        data: scheduleWidgetCredentialRefreshData(token),
      });
    },

    async rememberAuthorizedSession(userId: number, token: string) {
      const [status, user] = await Promise.all([
        readStatus(token),
        prisma.user.findUnique({ where: { id: userId }, select: { username: true, studentSso: true } }),
      ]);
      if (!status?.active || !status.username) throw Errors.unauthorized("教务会话已失效，请重新授权");
      if (!user || (user.studentSso && user.username !== status.username)) throw Errors.forbidden("教务会话与当前账号不一致");
      return this.recordLogin(userId, status.username, token);
    },
  };
}

export const scheduleWidgetSessions = createScheduleWidgetSessionService();
