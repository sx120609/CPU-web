import { config } from "../config";
import * as local from "./jwxtFacade";
import * as remote from "./jwxtRemote";

export const isRemoteMode = !!config.jwxtProxyUrl;

const impl = isRemoteMode ? remote : local;

if (isRemoteMode) {
  console.log(`[jwxt] 使用远端代理: ${config.jwxtProxyUrl}`);
}

export const beginLogin = impl.beginLogin;
export const submitLogin = impl.submitLogin;
export const logout = impl.logout;
export const getStatus = impl.getStatus;
export const sessionStats = impl.sessionStats;
export const getSchedule = impl.getSchedule;
export const getGrades = impl.getGrades;
export const getExams = impl.getExams;
export const getCalendar = impl.getCalendar;
export const getProgress = impl.getProgress;
export const getPyfa = impl.getPyfa;
export const getIApps = impl.getIApps;
export const debugSnapshot = impl.debugSnapshot;
