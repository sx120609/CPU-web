import { watch } from "vue";
import { jwxtApi } from "@/api/jwxt";
import { useAuthStore } from "@/stores/auth";
import { useJwxtStore } from "@/stores/jwxt";
import { useSiteStore } from "@/stores/site";
import { academicViewSet } from "@/utils/academicSystem";
import { isNativeScheduleShell } from "@/utils/clientInfo";
import { nativeScheduleAccountKey } from "@/utils/iosNextScheduleBridge";

/**
 * 原生 App 把考试安排画进课表用的入口：`window.CPUTimeNativeExams(request)`。
 *
 * - `{ semester?: string }`：返回 `{ supported, authenticated, account, semester, list }`。
 *   `list` 就是「考试安排」页那份（每条有 courseName，其余 examTime、location、seat、examType、
 *   examName、courseCode、semester 都可能没有；`examTime` 是教务给的原文，原生自己读出日期和时间）。
 *   不带学期时教务返回当前学期。
 * - 本校教务没有考试安排（`academicViews` 里没有 `exams`）时 `supported: false`，原生不显示入口。
 * - 没登录教务时 `authenticated: false`、`list` 为空；教务暂时取不到时带 `error`，原生保留已有的。
 *
 * 和「考试安排」页走同一个接口（`GET /api/jwxt/exams`），没有新的服务端数据，也不落库。
 * 页面的登录状态还没恢复时先等它（最多 8 秒），等不到返回 `{ missing: true }`，和没有这个桥的
 * 旧网页一样。
 */
type ExamsRequest = { semester?: string };

const text = (value: unknown, limit = 120) => (typeof value === "string" ? value.trim().slice(0, limit) : "");

export function installNativeExamsBridge() {
  if (!isNativeScheduleShell()) return;
  const host = window as any;
  if (typeof host.CPUTimeNativeExams === "function") return;
  const auth = useAuthStore();
  const jwxt = useJwxtStore();
  const site = useSiteStore();

  const authSettled = () => auth.ready
    ? Promise.resolve(true)
    : new Promise<boolean>((resolve) => {
      let stop = () => {};
      const timer = window.setTimeout(() => {
        stop();
        resolve(false);
      }, 8000);
      stop = watch(() => auth.ready, (ready) => {
        if (!ready) return;
        window.clearTimeout(timer);
        stop();
        resolve(true);
      });
    });

  host.CPUTimeNativeExams = async (request: ExamsRequest = {}) => {
    if (!(await authSettled())) return { missing: true };
    const supported = academicViewSet(site.school?.academicViews).has("exams");
    const base = { supported, authenticated: false, account: "", semester: "", list: [] as unknown[] };
    if (!supported || !auth.isLoggedIn || !jwxt.isLoggedIn) return base;
    const account = nativeScheduleAccountKey();
    const semester = text(request?.semester, 40);
    try {
      const result = await jwxt.withSessionRetry(() => jwxtApi.exams(semester ? { semester } : undefined, { silent: true }));
      const parsed = (result?.parsed ?? {}) as { list?: unknown; currentSemester?: unknown };
      const list = (Array.isArray(parsed.list) ? parsed.list : []).slice(0, 200).flatMap((row) => {
        const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
        const courseName = text(item.courseName);
        return courseName ? [{
          courseName,
          examTime: text(item.examTime),
          location: text(item.location),
          seat: text(item.seat, 40),
          examType: text(item.examType, 60),
          examName: text(item.examName),
          courseCode: text(item.courseCode, 60),
          semester: text(item.semester, 40),
        }] : [];
      });
      return { ...base, authenticated: true, account, semester: semester || text(parsed.currentSemester, 40), list };
    } catch (error) {
      return { ...base, authenticated: true, account, error: error instanceof Error && error.message ? error.message : "考试安排暂时读不出来" };
    }
  };
}
