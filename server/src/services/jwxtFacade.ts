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
  parseGrades,
  parseMidtermGrades,
  parseProgress,
  parsePyfa,
  parseSchedule,
} from "./jwxtParser";
import { isRecognizableUndergraduateSchedule } from "./academicIdentityDetection";
import { Errors } from "../utils/response";

export type JwxtDataSource = "modern" | "legacy";

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

export { beginLogin, submitLogin, submitLoginForHandoff, consumeLoginHandoff, exportSessionSnapshot, importSessionSnapshot };
export type { LoginSessionHandoff, LoginHandoffAttempt, JwxtSessionSnapshot } from "./jwxtClient";

export async function logout(token: string) {
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
  let semesters = [] as ReturnType<typeof parseGrades>["semesters"];
  try {
    semesters = parseGrades(
      await jwxtFetchHtml(token, "/zgykdx/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_CJGL"),
    ).semesters;
  } catch (error) {
    if (isUnauthorizedUpstreamError(error)) throw error;
    // 列表数据不依赖查询页的筛选选项，查询页临时异常时仍可继续。
  }
  const parsed = parseGrades(await jwxtPostForm(token, "/zgykdx/kscj/cjcx_list", {
    kksj: args.semester ?? "",
    kcxz: "",
    kcmc: "",
  }));
  const result = parsed.semesters.length ? parsed : { ...parsed, semesters };
  return { ...result, source: "legacy" as const };
}

export async function getMidtermGrades(token: string, args: { semester?: string } = {}) {
  let semesters = [] as ReturnType<typeof parseGrades>["semesters"];
  try {
    semesters = parseGrades(
      await jwxtFetchHtml(token, "/zgykdx/kscj/qzcjcx_query?Ves632DSdyV=NEW_XSD_CJGL")
    ).semesters;
  } catch (error) {
    if (isUnauthorizedUpstreamError(error)) throw error;
    // 查询页失败时继续用列表结果兜底。
  }

  const parsed = parseMidtermGrades(await jwxtPostForm(token, "/zgykdx/kscj/qzcjcx_list", {
    kksj: args.semester ?? "",
    kcxz: "",
    kcmc: "",
    xsfs: "all",
  }));
  const result = parsed.semesters.length ? parsed : { ...parsed, semesters };
  return { ...result, source: "legacy" as const };
}

export async function getExams(token: string, args: { semester?: string; type?: string } = {}) {
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
      // 返回 needSemester，让前端能继续显示一个可恢复的空态。
    }
  }

  if (!semester) return { semesters, list: [], needSemester: true, source: "legacy" as const };

  const parsed = parseExams(await jwxtPostForm(token, "/zgykdx/xsks/xsksap_list", {
    xnxqid: semester,
    xqlb: type,
  }));
  return {
    ...parsed,
    semesters: parsed.semesters.length ? parsed.semesters : semesters,
    currentSemester: semester,
    source: "legacy" as const,
  };
}

export async function getCalendar(token: string, args: { semester?: string } = {}) {
  const semester = String(args.semester ?? "").trim();
  const path = "/zgykdx/jxzl/jxzl_query?Ves632DSdyV=NEW_XSD_WDZM";
  const html = semester
    ? await jwxtPostForm(token, path, { xnxq01id: semester })
    : await jwxtFetchHtml(token, path);
  return { ...parseCalendar(html), source: "legacy" as const };
}

export async function getProgress(token: string) {
  return {
    ...parseProgress(await jwxtFetchHtml(token, "/zgykdx/xywcqk/cxxywcqk?Ves632DSdyV=NEW-XSD-XYWCQK")),
    source: "legacy" as const,
  };
}

export async function getPyfa(token: string) {
  return {
    ...parsePyfa(await jwxtFetchHtml(token, "/zgykdx/pyfa/pyfa_query?Ves632DSdyV=NEW_XSD_PYGL")),
    source: "legacy" as const,
  };
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
