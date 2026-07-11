import { config } from "../config";
import * as local from "./jwxtFacade";
import * as remote from "./jwxtRemote";
import * as agentRemote from "./jwxtAgentRemote";
import * as loginPool from "./ssoLoginPool";

type Transport = typeof local;

function queryImpl(): Transport {
  if (agentRemote.isJwxtAgentQueryMode()) return agentRemote as unknown as Transport;
  if (config.jwxtProxyUrl) return remote as unknown as Transport;
  return local;
}

export function isRemoteMode() {
  return agentRemote.hasRemoteJwxtAgent() || Boolean(config.jwxtProxyUrl);
}

export function beginLogin(): ReturnType<typeof local.beginLogin> {
  return loginPool.isDedicatedSsoLoginPool()
    ? loginPool.beginLogin()
    : queryImpl().beginLogin();
}

export function submitLogin(args: Parameters<typeof local.submitLogin>[0]) {
  if (loginPool.isPooledPendingId(args.pendingId)) return loginPool.submitLogin(args);
  return queryImpl().submitLogin(args);
}

export function logout(token: string) { return queryImpl().logout(token); }
export function getStatus(token: string | undefined | null) { return queryImpl().getStatus(token); }
export function sessionStats() { return queryImpl().sessionStats(); }
export function getSchedule(token: string, args?: Parameters<typeof local.getSchedule>[1]) { return queryImpl().getSchedule(token, args); }
export function getGrades(token: string, args?: Parameters<typeof local.getGrades>[1]) { return queryImpl().getGrades(token, args); }
export function getMidtermGrades(token: string, args?: Parameters<typeof local.getMidtermGrades>[1]) { return queryImpl().getMidtermGrades(token, args); }
export function getExams(token: string, args?: Parameters<typeof local.getExams>[1]) { return queryImpl().getExams(token, args); }
export function getCalendar(token: string) { return queryImpl().getCalendar(token); }
export function getProgress(token: string) { return queryImpl().getProgress(token); }
export function getPyfa(token: string) { return queryImpl().getPyfa(token); }
export function getIApps(token: string) { return queryImpl().getIApps(token); }
export function getGraduateSchedule(token: string, args?: Parameters<typeof local.getGraduateSchedule>[1]) {
  return queryImpl().getGraduateSchedule(token, args);
}
export function debugSnapshot(token: string) { return queryImpl().debugSnapshot(token); }
