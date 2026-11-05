import { config } from "../config";
import * as local from "./jwxtFacade";
import * as remote from "./jwxtRemote";
import * as agentRemote from "./jwxtAgentRemote";
import * as loginPool from "./ssoLoginPool";
import type { AgentEncryptedLoginCredentials } from "./jwxtAgentReplicaCrypto";
import { ConcurrencyGate, ConcurrencyGateFullError } from "../utils/loadShield";
import { Errors } from "../utils/response";
import { schoolDriverFor, schoolDriverForToken } from "../schools/drivers";
import { DEFAULT_SCHOOL_ID } from "../schools/registry";

type Transport = typeof local;

/** 教务令牌和登录 pendingId 的前缀说明它属于哪所学校的驱动（schools/drivers.ts）；药大的没有前缀。 */
export function schoolIdForJwxtToken(token: string | null | undefined) {
  return schoolDriverForToken(token)?.schoolId ?? DEFAULT_SCHOOL_ID;
}

function queryImpl(token?: string | null): Transport {
  const driver = schoolDriverForToken(token);
  if (driver) return driver.academic as Transport;
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

export function beginLogin(signal?: AbortSignal, schoolId: string = DEFAULT_SCHOOL_ID): ReturnType<typeof local.beginLogin> {
  const driver = schoolId === DEFAULT_SCHOOL_ID ? undefined : schoolDriverFor(schoolId);
  if (driver) return throughSsoLoginGate(() => driver.beginLogin(signal), signal) as ReturnType<typeof local.beginLogin>;
  return throughSsoLoginGate(() => (loginPool.isDedicatedSsoLoginPool()
    ? loginPool.beginLogin(signal)
    : queryImpl().beginLogin()) as ReturnType<typeof local.beginLogin>, signal);
}

export function submitLogin(args: Parameters<typeof local.submitLogin>[0] | { pendingId: string; credentials: AgentEncryptedLoginCredentials }, signal?: AbortSignal) {
  return throughSsoLoginGate(async () => {
    const driver = schoolDriverForToken(args.pendingId);
    if (driver) {
      if ("credentials" in args) throw Errors.badRequest("本校统一认证不支持加密登录凭据");
      return driver.submitLogin(args, signal);
    }
    if (loginPool.isPooledPendingId(args.pendingId)) return loginPool.submitLogin(args);
    if ("credentials" in args) {
      if (!agentRemote.isJwxtAgentQueryMode()) throw new Error("当前登录节点不支持加密登录凭据");
      return agentRemote.submitLogin(args);
    }
    return queryImpl().submitLogin(args);
  }, signal);
}

export function logout(token: string) { return queryImpl(token).logout(token); }
export function getStatus(token: string | undefined | null) { return queryImpl(token).getStatus(token); }
export function sessionStats() { return queryImpl().sessionStats(); }
export function getSchedule(token: string, args?: Parameters<typeof local.getSchedule>[1]) { return queryImpl(token).getSchedule(token, args); }
export function getGrades(token: string, args?: Parameters<typeof local.getGrades>[1]) { return queryImpl(token).getGrades(token, args); }
export function getMidtermGrades(token: string, args?: Parameters<typeof local.getMidtermGrades>[1]) { return queryImpl(token).getMidtermGrades(token, args); }
export function getExams(token: string, args?: Parameters<typeof local.getExams>[1]) { return queryImpl(token).getExams(token, args); }
export function getCalendar(token: string, args?: Parameters<typeof local.getCalendar>[1]) { return queryImpl(token).getCalendar(token, args); }
export function getProgress(token: string) { return queryImpl(token).getProgress(token); }
export function getPyfa(token: string) { return queryImpl(token).getPyfa(token); }
export function getRecords(token: string, args: Parameters<typeof local.getRecords>[1]) { return queryImpl(token).getRecords(token, args); }
export function getIApps(token: string) { return queryImpl(token).getIApps(token); }
export function getPortalNotices(token: string, args?: Parameters<typeof local.getPortalNotices>[1]) {
  return queryImpl(token).getPortalNotices(token, args);
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
  return queryImpl(token).getGraduateSchedule(token, args);
}
export function debugSnapshot(token: string) { return queryImpl(token).debugSnapshot(token); }

/** 学校统一认证在新设备上的扫码二次验证（南医有，药大没有）；哪所学校由 pendingId 的前缀定。 */
function mfaDriver(pendingId: string) {
  const mfa = schoolDriverForToken(pendingId)?.mfa;
  if (!mfa) throw Errors.badRequest("验证已过期，请重新登录");
  return mfa;
}

export function pollSchoolMfa(pendingId: string, signal?: AbortSignal) {
  return mfaDriver(pendingId).poll(pendingId, signal);
}

export function refreshSchoolMfaQr(pendingId: string, signal?: AbortSignal) {
  const mfa = mfaDriver(pendingId);
  return throughSsoLoginGate(() => mfa.refreshQr(pendingId, signal), signal);
}
