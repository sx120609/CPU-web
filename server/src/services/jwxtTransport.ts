import { config } from "../config";
import * as local from "./jwxtFacade";
import * as remote from "./jwxtRemote";
import * as loginPool from "./ssoLoginPool";

export const isRemoteMode = !!config.jwxtProxyUrl;

const impl = isRemoteMode ? remote : local;

if (isRemoteMode) {
  console.log(`[jwxt] 使用远端代理: ${config.jwxtProxyUrl}`);
}

/**
 * 登录池只接管 CAS begin/submit；课表、成绩、状态与注销仍由下方的
 * legacy impl（JWXT_PROXY_URL 或本机）执行。
 *
 * 对没有池前缀的 pendingId 继续走 legacy impl，以便滚动发布期间已经
 * 打开的旧登录页仍能完成提交。
 */
export const beginLogin = loginPool.isDedicatedSsoLoginPool
  ? loginPool.beginLogin
  : impl.beginLogin;

export function submitLogin(args: Parameters<typeof local.submitLogin>[0]) {
  if (!loginPool.isDedicatedSsoLoginPool || !loginPool.isPooledPendingId(args.pendingId)) {
    return impl.submitLogin(args);
  }
  return loginPool.submitLogin(args);
}
export const logout = impl.logout;
export const getStatus = impl.getStatus;
export const sessionStats = impl.sessionStats;
export const getSchedule = impl.getSchedule;
export const getGrades = impl.getGrades;
export const getMidtermGrades = impl.getMidtermGrades;
export const getExams = impl.getExams;
export const getCalendar = impl.getCalendar;
export const getProgress = impl.getProgress;
export const getPyfa = impl.getPyfa;
export const getIApps = impl.getIApps;
export const getGraduateSchedule = impl.getGraduateSchedule;
export const debugSnapshot = impl.debugSnapshot;
