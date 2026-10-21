import { config } from "../config";
import * as local from "./jwxtFacade";
import * as remote from "./jwxtRemote";
import * as agentRemote from "./jwxtAgentRemote";
import * as loginPool from "./ssoLoginPool";
import type { AgentEncryptedLoginCredentials } from "./jwxtAgentReplicaCrypto";
import { ConcurrencyGate, ConcurrencyGateFullError } from "../utils/loadShield";
import { Errors } from "../utils/response";

type Transport = typeof local;

function queryImpl(): Transport {
  if (agentRemote.isJwxtAgentQueryMode()) return agentRemote as unknown as Transport;
  if (config.jwxtProxyUrl) return remote as unknown as Transport;
  return local;
}

export function isRemoteMode() {
  return agentRemote.hasRemoteJwxtAgent() || Boolean(config.jwxtProxyUrl);
}

// 学校 SSO 是第三方系统，登录入口又必须对未登录访客开放：洪泛不能经由本站原样转发过去，
// 否则拖垮的是学校的认证服务，登录节点也可能被学校封禁。额度远高于选课高峰的正常并发，只截住洪泛。
const ssoLoginGate = new ConcurrencyGate(64, 256, 3000);

async function throughSsoLoginGate<T>(task: () => Promise<T>, signal?: AbortSignal) {
  try {
    return await ssoLoginGate.run(task, signal);
  } catch (error) {
    if (error instanceof ConcurrencyGateFullError) throw Errors.busy("当前登录人数较多，请稍后重试");
    throw error;
  }
}

export function beginLogin(signal?: AbortSignal): ReturnType<typeof local.beginLogin> {
  return throughSsoLoginGate(() => (loginPool.isDedicatedSsoLoginPool()
    ? loginPool.beginLogin(signal)
    : queryImpl().beginLogin()) as ReturnType<typeof local.beginLogin>, signal);
}

export function submitLogin(args: Parameters<typeof local.submitLogin>[0] | { pendingId: string; credentials: AgentEncryptedLoginCredentials }, signal?: AbortSignal) {
  return throughSsoLoginGate(async () => {
    if (loginPool.isPooledPendingId(args.pendingId)) return loginPool.submitLogin(args);
    if ("credentials" in args) {
      if (!agentRemote.isJwxtAgentQueryMode()) throw new Error("当前登录节点不支持加密登录凭据");
      return agentRemote.submitLogin(args);
    }
    return queryImpl().submitLogin(args);
  }, signal);
}

export function logout(token: string) { return queryImpl().logout(token); }
export function getStatus(token: string | undefined | null) { return queryImpl().getStatus(token); }
export function sessionStats() { return queryImpl().sessionStats(); }
export function getSchedule(token: string, args?: Parameters<typeof local.getSchedule>[1]) { return queryImpl().getSchedule(token, args); }
export function getGrades(token: string, args?: Parameters<typeof local.getGrades>[1]) { return queryImpl().getGrades(token, args); }
export function getMidtermGrades(token: string, args?: Parameters<typeof local.getMidtermGrades>[1]) { return queryImpl().getMidtermGrades(token, args); }
export function getExams(token: string, args?: Parameters<typeof local.getExams>[1]) { return queryImpl().getExams(token, args); }
export function getCalendar(token: string, args?: Parameters<typeof local.getCalendar>[1]) { return queryImpl().getCalendar(token, args); }
export function getProgress(token: string) { return queryImpl().getProgress(token); }
export function getPyfa(token: string) { return queryImpl().getPyfa(token); }
export function getRecords(token: string, args: Parameters<typeof local.getRecords>[1]) { return queryImpl().getRecords(token, args); }
export function getIApps(token: string) { return queryImpl().getIApps(token); }
export function getPortalNotices(token: string, args?: Parameters<typeof local.getPortalNotices>[1]) {
  return queryImpl().getPortalNotices(token, args);
}
export async function getIAppIcon(path: string) {
  if (agentRemote.hasRemoteJwxtAgent()) {
    try { return await agentRemote.getIAppIcon(path); }
    catch { /* 继续尝试旧代理或本机兜底 */ }
  }
  if (config.jwxtProxyUrl) {
    try { return await remote.getIAppIcon(path); }
    catch { /* 继续尝试本机兜底 */ }
  }
  return local.getIAppIcon(path);
}
export function getGraduateSchedule(token: string, args?: Parameters<typeof local.getGraduateSchedule>[1]) {
  return queryImpl().getGraduateSchedule(token, args);
}
export function debugSnapshot(token: string) { return queryImpl().debugSnapshot(token); }
