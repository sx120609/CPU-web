import crypto from "node:crypto";
import {
  beginLogin,
  submitLogin,
  submitLoginForHandoff,
  consumeLoginHandoff,
  logout as clientLogout,
  getSession,
  sessionStats as clientSessionStats,
  jwxtFetchHtml,
  jwxtFetchModernHtml,
  jwxtPostForm,
  fetchIServiceApps,
  fetchIServiceIcon,
  jwxtDebugSnapshot,
  exportSessionSnapshot,
  importSessionSnapshot,
} from "./jwxtClient";
import { getGraduateSchedule as getGraduateScheduleLive } from "./graduateScheduleService";
import {
  parseCalendar,
  parseExams,
  parseGradeBreakdown,
  parseGrades,
  parseMidtermGrades,
  parseProgress,
  parsePyfa,
  parseSchedule,
  type GradeBreakdown,
  type GradesResult,
} from "./jwxtParser";
import { isRecognizableUndergraduateSchedule } from "./academicIdentityDetection";
import { Errors } from "../utils/response";
import { loadModernScheduleCalendar } from "./scheduleCalendarSource";

export type JwxtDataSource = "modern" | "legacy";

const MODERN_GRADES_CACHE_TTL_MS = 30 * 60_000;
const MODERN_GRADES_CACHE_MAX_ENTRIES = 128;
const MODERN_GRADE_DETAIL_CONCURRENCY = 8;
const modernGradesCache = new Map<string, { expiresAt: number; promise: Promise<GradesResult> }>();

function isUnauthorizedUpstreamError(error: unknown) {
  const candidate = error as { status?: unknown; code?: unknown } | null | undefined;
  return Number(candidate?.status || 0) === 401 || Number(candidate?.code || 0) === 4001;
}

export async function modernFirst<T extends object>(modern: () => Promise<T>, legacy: () => Promise<T>) {
  try {
    return { ...await modern(), source: "modern" as const };
  } catch (modernError) {
    if (isUnauthorizedUpstreamError(modernError)) throw modernError;
    try {
      return { ...await legacy(), source: "legacy" as const };
    } catch {
      throw modernError;
    }
  }
}

function modernGradesCachePrefix(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function modernGradesCacheKey(token: string, semester: string) {
  return `${modernGradesCachePrefix(token)}:${semester || "_"}`;
}

function pruneModernGradesCache() {
  const now = Date.now();
  for (const [key, entry] of modernGradesCache) {
    if (entry.expiresAt <= now) modernGradesCache.delete(key);
  }
  while (modernGradesCache.size >= MODERN_GRADES_CACHE_MAX_ENTRIES) {
    const oldest = modernGradesCache.keys().next().value;
    if (!oldest) break;
    modernGradesCache.delete(oldest);
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function modernGradeDetailPath(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as Record<string, unknown>;
  const params = new URLSearchParams();
  for (const key of ["xs0101id", "jx0404id", "cj0708id"] as const) {
    const text = String(row[key] ?? "").trim();
    if (!text) return "";
    params.set(key, text);
  }
  const total = String(row.zcjstr ?? row.zcj ?? "").trim();
  if (!total) return "";
  params.set("zcj", total);
  return `/jsxsd/kscj/pscj_list.do?${params.toString()}`;
}

async function enrichModernGradeBreakdowns(token: string, listText: string) {
  let envelope: Record<string, unknown> & { data: unknown[] };
  try {
    const parsed = JSON.parse(listText) as Record<string, unknown> & { data?: unknown[] };
    if (!Array.isArray(parsed.data)) return listText;
    envelope = { ...parsed, data: parsed.data };
  } catch {
    return listText;
  }

  // Detail IDs come only from the authenticated student's own grade list and never leave the server.
  const paths = Array.from(new Set(envelope.data.map(modernGradeDetailPath).filter(Boolean)));
  let failureCount = 0;
  const details = await mapWithConcurrency(paths, MODERN_GRADE_DETAIL_CONCURRENCY, async (path) => {
    try {
      const html = await jwxtFetchModernHtml(token, path, { persistSession: false });
      return [path, parseGradeBreakdown(html)] as const;
    } catch (error) {
      if (isUnauthorizedUpstreamError(error)) throw error;
      failureCount += 1;
      return [path, null] as const;
    }
  });
  if (failureCount) {
    console.warn(`[jwxt] ${failureCount}/${paths.length} grade breakdown request(s) failed; totals were preserved`);
  }

  const byPath = new Map<string, GradeBreakdown | null>(details);
  return JSON.stringify({
    ...envelope,
    data: envelope.data.map((value) => {
      const detail = byPath.get(modernGradeDetailPath(value));
      return detail && value && typeof value === "object" && !Array.isArray(value)
        ? { ...value, ...detail }
        : value;
    }),
  });
}

async function loadModernGrades(token: string, semester: string) {
  const [queryHtml, listText] = await Promise.all([
    jwxtFetchModernHtml(token, "/jsxsd/kscj/cjcx_frm"),
    fetchModernPagedList(token, "/jsxsd/kscj/cjcx_list", {
      kksj: semester,
      kcxz: "",
      kcsx: "",
      kcmc: "",
      xsfs: "all",
      sfxsbcxq: "1",
    }),
  ]);
  const semesters = parseGrades(queryHtml).semesters;
  const parsed = parseGrades(await enrichModernGradeBreakdowns(token, listText));
  return parsed.semesters.length ? parsed : { ...parsed, semesters };
}

function getCachedModernGrades(token: string, semester: string) {
  const key = modernGradesCacheKey(token, semester);
  const cached = modernGradesCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  pruneModernGradesCache();
  const promise = loadModernGrades(token, semester);
  modernGradesCache.set(key, { expiresAt: Date.now() + MODERN_GRADES_CACHE_TTL_MS, promise });
  void promise.catch(() => {
    if (modernGradesCache.get(key)?.promise === promise) modernGradesCache.delete(key);
  });
  return promise;
}

async function fetchModernPagedList(
  token: string,
  path: string,
  params: Record<string, string>,
  pageSize = 500,
) {
  const fetchPage = async (pageNum: number) => {
    const query = new URLSearchParams({ pageNum: String(pageNum), pageSize: String(pageSize), ...params });
    return jwxtFetchModernHtml(token, `${path}?${query.toString()}`);
  };
  const firstText = await fetchPage(1);
  const first = JSON.parse(firstText) as { count?: number; data?: unknown[] } & Record<string, unknown>;
  if (!Array.isArray(first.data)) return firstText;
  const count = Math.max(0, Number(first.count) || first.data.length);
  const pages = Math.ceil(count / pageSize);
  for (let page = 2; page <= pages; page++) {
    const next = JSON.parse(await fetchPage(page)) as { data?: unknown[] };
    if (Array.isArray(next.data)) first.data.push(...next.data);
  }
  return JSON.stringify(first);
}

export { beginLogin, submitLogin, submitLoginForHandoff, consumeLoginHandoff, exportSessionSnapshot, importSessionSnapshot };
export type { LoginSessionHandoff, LoginHandoffAttempt, JwxtSessionSnapshot } from "./jwxtClient";

export async function logout(token: string) {
  const prefix = `${modernGradesCachePrefix(token)}:`;
  for (const key of modernGradesCache.keys()) {
    if (key.startsWith(prefix)) modernGradesCache.delete(key);
  }
  return clientLogout(token);
}

export async function sessionStats() {
  return clientSessionStats();
}

export async function getStatus(token: string | undefined | null) {
  const session = await getSession(token);
  return session ? { active: true, since: session.createdAt, username: session.username } : { active: false };
}

export function parseRecognizedSchedule(html: string) {
  const parsed = parseSchedule(html);
  if (!isRecognizableUndergraduateSchedule(parsed)) {
    throw Errors.badGateway("学校教务暂时没有返回可识别的课表页面");
  }
  return parsed;
}

export async function getSchedule(token: string, args: { semester?: string; week?: string } = {}) {
  const semester = args.semester ?? "";
  const week = args.week ?? "";
  const qs = new URLSearchParams({ viweType: "0" });
  if (semester) qs.set("xnxq01id", semester);
  if (week) qs.set("zc", week);
  const path = `/jsxsd/xskb/xskb_list.do?${qs.toString()}`;
  return modernFirst(
    async () => parseRecognizedSchedule(await jwxtFetchModernHtml(token, path)),
    async () => parseRecognizedSchedule(await jwxtFetchHtml(token, `/zgykdx/xskb/xskb_list.do?${qs.toString()}`)),
  );
}

export async function getGrades(token: string, args: { semester?: string } = {}) {
  return modernFirst(() => getCachedModernGrades(token, args.semester ?? ""), async () => {
    let semesters = [] as ReturnType<typeof parseGrades>["semesters"];
    try {
      semesters = parseGrades(
        await jwxtFetchHtml(token, "/zgykdx/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_CJGL"),
      ).semesters;
    } catch (error) {
      if (isUnauthorizedUpstreamError(error)) throw error;
    }
    const parsed = parseGrades(await jwxtPostForm(token, "/zgykdx/kscj/cjcx_list", {
      kksj: args.semester ?? "",
      kcxz: "",
      kcmc: "",
    }));
    return parsed.semesters.length ? parsed : { ...parsed, semesters };
  });
}

export async function getMidtermGrades(token: string, args: { semester?: string } = {}) {
  return modernFirst(() => getCachedModernGrades(token, args.semester ?? ""), async () => {
    let semesters = [] as ReturnType<typeof parseGrades>["semesters"];
    try {
      semesters = parseGrades(
        await jwxtFetchHtml(token, "/zgykdx/kscj/qzcjcx_query?Ves632DSdyV=NEW_XSD_CJGL")
      ).semesters;
    } catch (error) {
      if (isUnauthorizedUpstreamError(error)) throw error;
    }

    const parsed = parseMidtermGrades(await jwxtPostForm(token, "/zgykdx/kscj/qzcjcx_list", {
      kksj: args.semester ?? "",
      kcxz: "",
      kcmc: "",
      xsfs: "all",
    }));
    return parsed.semesters.length ? parsed : { ...parsed, semesters };
  });
}

export async function getExams(token: string, args: { semester?: string; type?: string } = {}) {
  return modernFirst(async () => {
    const queryHtml = await jwxtFetchModernHtml(token, "/jsxsd/xsks/xsksap_query");
    const semesters = parseExams(queryHtml).semesters;
    const semester = args.semester || semesters.find((item) => item.current)?.value || semesters[0]?.value || "";
    if (!semester) return { semesters, list: [], needSemester: true };
    const parsed = parseExams(await fetchModernPagedList(token, "/jsxsd/xsks/xsksap_list", {
      xnxqid: semester,
      xqlb: args.type ?? "",
    }));
    return { ...parsed, semesters: parsed.semesters.length ? parsed.semesters : semesters, currentSemester: semester };
  }, async () => {
    let semester = args.semester ?? "";
    const type = args.type ?? "";
    let semesters: ReturnType<typeof parseExams>["semesters"] = [];

    if (!semester) {
      try {
        const queryHtml = await jwxtFetchHtml(token, "/zgykdx/xsks/xsksap_query?Ves632DSdyV=NEW_XSD_KSBM");
        semesters = parseExams(queryHtml).semesters;
        semester = semesters.find((item) => item.current)?.value || semesters[0]?.value || "";
      } catch (error) {
        if (isUnauthorizedUpstreamError(error)) throw error;
      }
    }

    if (!semester) return { semesters, list: [], needSemester: true };
    const parsed = parseExams(await jwxtPostForm(token, "/zgykdx/xsks/xsksap_list", {
      xnxqid: semester,
      xqlb: type,
    }));
    return {
      ...parsed,
      semesters: parsed.semesters.length ? parsed.semesters : semesters,
      currentSemester: semester,
    };
  });
}

export async function getCalendar(token: string, args: { semester?: string } = {}) {
  const semester = String(args.semester ?? "").trim();
  return modernFirst(async () => {
    return loadModernScheduleCalendar(semester, (path) => jwxtFetchModernHtml(token, path));
  }, async () => {
    const path = "/zgykdx/jxzl/jxzl_query?Ves632DSdyV=NEW_XSD_WDZM";
    const html = semester
      ? await jwxtPostForm(token, path, { xnxq01id: semester })
      : await jwxtFetchHtml(token, path);
    return parseCalendar(html);
  });
}

export async function getProgress(token: string) {
  return modernFirst(
    async () => parseProgress(await jwxtFetchModernHtml(token, "/jsxsd/xxwcqk/xxwcqkOnkclb.do?isdb=0")),
    async () => parseProgress(await jwxtFetchHtml(token, "/zgykdx/xywcqk/cxxywcqk?Ves632DSdyV=NEW-XSD-XYWCQK")),
  );
}

export async function getPyfa(token: string) {
  return modernFirst(
    async () => parsePyfa(await fetchModernPagedList(token, "/jsxsd/pyfa/pyfa_query", {
      islist: "1",
      kkxq: "",
      kcxx: "",
    })),
    async () => parsePyfa(await jwxtFetchHtml(token, "/zgykdx/pyfa/pyfa_query?Ves632DSdyV=NEW_XSD_PYGL")),
  );
}

export async function getIApps(token: string) {
  return fetchIServiceApps(token);
}

export async function getIAppIcon(path: string) {
  return fetchIServiceIcon(path);
}

export async function debugSnapshot(token: string) {
  return jwxtDebugSnapshot(token);
}

export async function getGraduateSchedule(token: string, args: { semester?: string; termcode?: string } = {}) {
  return getGraduateScheduleLive(token, args);
}
