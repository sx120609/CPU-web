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
  return modernFirst(async () => {
    const [queryHtml, listText] = await Promise.all([
      jwxtFetchModernHtml(token, "/jsxsd/kscj/cjcx_frm"),
      fetchModernPagedList(token, "/jsxsd/kscj/cjcx_list", {
        kksj: args.semester ?? "",
        kcxz: "",
        kcsx: "",
        kcmc: "",
        xsfs: "all",
        sfxsbcxq: "1",
      }),
    ]);
    const semesters = parseGrades(queryHtml).semesters;
    const parsed = parseGrades(listText);
    return parsed.semesters.length ? parsed : { ...parsed, semesters };
  }, async () => {
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
  return modernFirst(async () => {
    const [queryHtml, listText] = await Promise.all([
      jwxtFetchModernHtml(token, "/jsxsd/kscj/cjcx_frm"),
      fetchModernPagedList(token, "/jsxsd/kscj/cjcx_list", {
        kksj: args.semester ?? "",
        kcxz: "",
        kcsx: "",
        kcmc: "",
        xsfs: "all",
        sfxsbcxq: "1",
      }),
    ]);
    const semesters = parseGrades(queryHtml).semesters;
    const parsed = parseGrades(listText);
    return parsed.semesters.length ? parsed : { ...parsed, semesters };
  }, async () => {
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
    const query = semester ? `?${new URLSearchParams({ xnxq01id: semester }).toString()}` : "";
    return parseCalendar(await jwxtFetchModernHtml(token, `/jsxsd/jxzl/jxzl_query${query}`));
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
