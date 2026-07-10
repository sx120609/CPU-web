import {
  beginLogin,
  submitLogin,
  submitLoginForHandoff,
  consumeLoginHandoff,
  logout as clientLogout,
  getSession,
  sessionStats as clientSessionStats,
  jwxtFetchHtml,
  jwxtPostForm,
  fetchIServiceApps,
  jwxtDebugSnapshot,
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

export { beginLogin, submitLogin, submitLoginForHandoff, consumeLoginHandoff };
export type { LoginSessionHandoff, LoginHandoffAttempt } from "./jwxtClient";

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

export async function getSchedule(token: string, args: { semester?: string; week?: string } = {}) {
  const semester = args.semester ?? "";
  const week = args.week ?? "";
  let path = "/zgykdx/xskb/xskb_list.do";
  if (semester || week) {
    const qs = new URLSearchParams();
    if (semester) qs.set("xnxq01id", semester);
    if (week) qs.set("zc", week);
    path += "?" + qs.toString();
  }
  return parseSchedule(await jwxtFetchHtml(token, path));
}

export async function getGrades(token: string, args: { semester?: string } = {}) {
  return parseGrades(await jwxtPostForm(token, "/zgykdx/kscj/cjcx_list", {
    kksj: args.semester ?? "",
    kcxz: "",
    kcmc: "",
  }));
}

export async function getMidtermGrades(token: string, args: { semester?: string } = {}) {
  let semesters = [] as ReturnType<typeof parseGrades>["semesters"];
  try {
    semesters = parseGrades(
      await jwxtFetchHtml(token, "/zgykdx/kscj/qzcjcx_query?Ves632DSdyV=NEW_XSD_CJGL")
    ).semesters;
  } catch {
    // 查询页失败时继续用列表结果兜底。
  }

  const parsed = parseMidtermGrades(await jwxtPostForm(token, "/zgykdx/kscj/qzcjcx_list", {
    kksj: args.semester ?? "",
    kcxz: "",
    kcmc: "",
    xsfs: "all",
  }));
  return parsed.semesters.length ? parsed : { ...parsed, semesters };
}

export async function getExams(token: string, args: { semester?: string; type?: string } = {}) {
  let semester = args.semester ?? "";
  const type = args.type ?? "";

  // xsksap_list 的学期必填；未传时先读 query 页，取最新学期兜底。
  if (!semester) {
    try {
      const queryHtml = await jwxtFetchHtml(token, "/zgykdx/xsks/xsksap_query?Ves632DSdyV=NEW_XSD_KSBM");
      const options = Array.from(queryHtml.matchAll(/<option[^>]*value="([^"]+)"/g))
        .map((x) => x[1])
        .filter(Boolean)
        .sort()
        .reverse();
      semester = options[0] ?? "";
    } catch {
      // 返回 needSemester，让前端能继续显示一个可恢复的空态。
    }
  }

  if (!semester) return { semesters: [], list: [], needSemester: true };

  const parsed = parseExams(await jwxtPostForm(token, "/zgykdx/xsks/xsksap_list", {
    xnxqid: semester,
    xqlb: type,
  }));
  return { ...parsed, currentSemester: semester };
}

export async function getCalendar(token: string) {
  return parseCalendar(await jwxtFetchHtml(token, "/zgykdx/jxzl/jxzl_query?Ves632DSdyV=NEW_XSD_WDZM"));
}

export async function getProgress(token: string) {
  return parseProgress(await jwxtFetchHtml(token, "/zgykdx/xywcqk/cxxywcqk?Ves632DSdyV=NEW-XSD-XYWCQK"));
}

export async function getPyfa(token: string) {
  return parsePyfa(await jwxtFetchHtml(token, "/zgykdx/pyfa/pyfa_query?Ves632DSdyV=NEW_XSD_PYGL"));
}

export async function getIApps(token: string) {
  return fetchIServiceApps(token);
}

export async function debugSnapshot(token: string) {
  return jwxtDebugSnapshot(token);
}

export async function getGraduateSchedule(token: string, args: { semester?: string; termcode?: string } = {}) {
  return getGraduateScheduleLive(token, args);
}
