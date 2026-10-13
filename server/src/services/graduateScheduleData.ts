import crypto from "node:crypto";
import { getCachedJson, setCachedJson, withCache } from "./cache";
import { normalizeGraduateSemesterLabel } from "./graduateScheduleService";
import * as transport from "./jwxtTransport";
import { buildRedisKey } from "./redis";

const GRADUATE_SCHEDULE_TTL_MS = 5 * 60_000;
// 研究生系统故障时可能照常返回学期列表，却给出一张没有课程的课表。这段时间内
// 继续提供上一次带课程的结果；超过后仍然为空，才认定课程确实被清空。
const LAST_GOOD_RETENTION_MS = 7 * 24 * 60 * 60_000;

export type GraduateScheduleQuery = { semester?: string; termcode?: string; refresh?: boolean };
type GraduateSchedule = Awaited<ReturnType<typeof transport.getGraduateSchedule>>;
export type GraduateScheduleSnapshot = GraduateSchedule & { stale?: boolean };
type Dependencies = Pick<typeof transport, "getGraduateSchedule"> & {
  cache: typeof withCache;
  readLastGood: (key: string) => Promise<GraduateSchedule | null>;
  writeLastGood: (key: string, value: GraduateSchedule, ttlMs: number) => Promise<void>;
};

function courseCount(result: GraduateSchedule | null | undefined) {
  return (result?.parsed?.cells ?? []).reduce((sum, cell) => sum + (cell?.courses?.length ?? 0), 0);
}

function isUnauthorized(error: unknown) {
  const failure = error as { status?: unknown; code?: unknown } | null | undefined;
  return Number(failure?.status || 0) === 401 || Number(failure?.code || 0) === 4001;
}

export function createGraduateScheduleDataService(dependencies: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    getGraduateSchedule: transport.getGraduateSchedule,
    cache: withCache,
    readLastGood: (key) => getCachedJson<GraduateSchedule>(key),
    writeLastGood: (key, value, ttlMs) => setCachedJson(key, value, ttlMs),
    ...dependencies,
  };
  // 与其他教务缓存相同的会话标识，注销账号时按它一并清除。
  const tokenKey = (token: string) => crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
  const lastGoodKey = (token: string, kind: string, value = "") => buildRedisKey(
    "cache-value",
    "jwxt-graduate-last-good",
    tokenKey(token),
    kind,
    value ? crypto.createHash("sha256").update(value).digest("hex").slice(0, 16) : "",
  );
  const requestKey = (token: string, semester: string, termcode: string) => {
    if (termcode) return lastGoodKey(token, "termcode", termcode);
    if (semester) return lastGoodKey(token, "semester", normalizeGraduateSemesterLabel(semester));
    return lastGoodKey(token, "default");
  };

  async function remember(token: string, key: string, result: GraduateSchedule) {
    const source = result.source as { semester?: string; termcode?: string } | undefined;
    const resolvedSemester = String(source?.semester || result.parsed.currentSemester || "").trim();
    const resolvedTermcode = String(source?.termcode || "").trim();
    const keys = new Set([key]);
    // 默认请求拿到的学期，之后被明确选中时也能回退到同一份结果。
    if (resolvedSemester) keys.add(requestKey(token, resolvedSemester, ""));
    if (resolvedTermcode) keys.add(requestKey(token, "", resolvedTermcode));
    await Promise.all([...keys].map((item) => deps.writeLastGood(item, result, LAST_GOOD_RETENTION_MS)));
  }

  async function load(token: string, semester: string, termcode: string): Promise<GraduateScheduleSnapshot> {
    const key = requestKey(token, semester, termcode);
    let fresh: GraduateSchedule | null = null;
    let failure: unknown = null;
    try {
      fresh = await deps.getGraduateSchedule(token, {
        semester: semester || undefined,
        termcode: termcode || undefined,
      });
    } catch (error) {
      // 会话失效要交给前端恢复登录，不能用旧课表掩盖。
      if (isUnauthorized(error)) throw error;
      failure = error;
    }
    if (fresh && courseCount(fresh) > 0) {
      await remember(token, key, fresh).catch(() => undefined);
      return fresh;
    }
    const lastGood = await deps.readLastGood(key).catch(() => null);
    if (lastGood && courseCount(lastGood) > 0) return { ...lastGood, stale: true };
    if (fresh) return fresh;
    throw failure;
  }

  async function read(token: string, query: GraduateScheduleQuery = {}) {
    const semester = String(query.semester || "").trim();
    const termcode = String(query.termcode || "").trim();
    return deps.cache(
      "jwxt-graduate-schedule",
      [tokenKey(token), semester || "_", termcode || "_"],
      GRADUATE_SCHEDULE_TTL_MS,
      async () => load(token, semester, termcode),
      { refresh: query.refresh },
    );
  }

  return { read };
}

export type GraduateScheduleDataService = ReturnType<typeof createGraduateScheduleDataService>;
export const graduateScheduleData = createGraduateScheduleDataService();
