import { dormApi, type DormStatus } from "@/api/dorm";
import { emptyScheduleEdits } from "@/utils/scheduleEdits";
import {
  readCachedDormStatus,
  syncDormScheduleIfJoined,
  type DormSyncNowOptions,
  type DormSyncNowResult,
} from "@/views/schedule/dormSync";
import type { CalendarResult, ScheduleResult } from "@/views/schedule/types";

/**
 * 原生 App 的宿舍课表同步。
 *
 * 原生课表是自己画的，网页拿不到它的数据（含本机修改）。原生课表稳定后把**当前学期**整学期课表
 * 按情侣课表上传的同一格式（`{ semester, schedule, calendar }`）交给网页，网页记下这一份并按网页
 * 课表页同样的规则（`syncDormScheduleIfJoined`）上传；`/dorm-schedule` 页面的立即同步也用它。
 * 这样宿舍状态缓存、内容指纹、换宿舍补传这些规则只有网页一份实现。
 */

export type NativeDormSnapshot = { semester: string; schedule: ScheduleResult; calendar: CalendarResult };
type StoredEntry = { userId: number; snapshot: NativeDormSnapshot; receivedAt: number };
type DormNativeApi = Pick<typeof dormApi, "status" | "syncSchedule">;

const STORAGE_KEY = "cpu-native-dorm-snapshot-v1";
const SEMESTER = /^(\d{4})-(\d{4})-([1-3])$/;

/** 按学年、学期比较；认不出的写法当作相同，不拦。 */
export function compareSemesters(a: string, b: string) {
  const left = SEMESTER.exec(a.trim());
  const right = SEMESTER.exec(b.trim());
  if (!left || !right) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(left[index]) - Number(right[index]);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/**
 * 校验原生交来的快照。必须是整学期课表、带校历周次（按日期对齐要用），
 * 课表自己写的学期和外层一致。不合格时返回 null，调用方当作“还没有数据”。
 */
export function readNativeDormSnapshot(value: unknown): NativeDormSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, any>;
  const semester = typeof input.semester === "string" ? input.semester.trim() : "";
  const schedule = input.schedule;
  const calendar = input.calendar;
  if (!semester || semester.length > 80) return null;
  if (!schedule || typeof schedule !== "object" || !Array.isArray(schedule.cells)) return null;
  // 原生上传格式不写 scope，按整学期收；写明了别的范围（比如单周）就不是整学期，不能当成整学期传。
  if (schedule.scope !== undefined && schedule.scope !== "semester") return null;
  if (!calendar || typeof calendar !== "object" || !Array.isArray(calendar.weeks) || !calendar.weeks.length) return null;
  const own = typeof schedule.currentSemester === "string" ? schedule.currentSemester.trim() : "";
  if (own && own !== semester) return null;
  return {
    semester,
    // 原生交来的已经是整学期、已合并本机修改的课表；补齐网页类型要求的字段。
    schedule: {
      semesters: [],
      weeks: [],
      currentWeek: "",
      ...schedule,
      currentSemester: semester,
      scope: "semester",
    } as ScheduleResult,
    calendar: calendar as CalendarResult,
  };
}

export interface NativeDormSyncDeps {
  /** 当前登录的站内账号；没登录时为空。 */
  userId: () => number | null | undefined;
  api?: DormNativeApi;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  now?: () => number;
}

export function createNativeDormSync(deps: NativeDormSyncDeps) {
  const api = deps.api ?? dormApi;
  const now = deps.now ?? Date.now;
  let entry: StoredEntry | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  /** 原生刚交来、正在上传的那一份；页面同时要同步时等它，不传第二遍。 */
  let offering: { entry: StoredEntry; task: Promise<DormSyncNowResult> } | null = null;
  const waiters = new Set<() => void>();
  const syncedListeners = new Set<() => void>();

  function restore() {
    if (entry || !deps.storage) return;
    try {
      const raw = deps.storage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) as StoredEntry : null;
      const snapshot = readNativeDormSnapshot(parsed?.snapshot);
      if (parsed && snapshot && Number.isFinite(parsed.userId)) entry = { ...parsed, snapshot };
    } catch {
      entry = null;
    }
  }

  /** 只返回属于当前账号的快照：换账号后旧账号的课表不能传到新账号的宿舍里。 */
  function latest() {
    restore();
    const userId = deps.userId();
    return userId && entry?.userId === userId ? entry : null;
  }

  function remember(next: StoredEntry) {
    entry = next;
    try { deps.storage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 存不下时只留在内存里 */ }
    for (const wake of [...waiters]) wake();
  }

  function forget() {
    entry = null;
    try { deps.storage?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  async function upload(current: StoredEntry, options: DormSyncNowOptions): Promise<DormSyncNowResult> {
    const userId = current.userId;
    // 等待期间换了账号或退出登录，这份课表就不再传。
    const isCurrent = () => deps.userId() === userId;
    if (!isCurrent()) return "skipped";
    let status: DormStatus | undefined = options.status;
    if (!status) {
      if (!options.force && readCachedDormStatus(userId, now()) === "none") return "skipped";
      try {
        status = await api.status(true);
      } catch {
        return "failed";
      }
      if (!isCurrent()) return "skipped";
    }
    // 别的设备已经传了更新的学期（比如网页已经切到新学期，原生还停在上学期的本地副本），不能用旧学期覆盖。
    const serverSemester = status.status === "active" ? status.me.snapshot?.semester : undefined;
    if (serverSemester && compareSemesters(serverSemester, current.snapshot.semester) > 0) return "skipped";
    return syncDormScheduleIfJoined({
      userId,
      semester: current.snapshot.semester,
      parsed: current.snapshot.schedule,
      calendar: current.snapshot.calendar,
      edits: emptyScheduleEdits(),
      status,
      force: options.force,
      isCurrent,
      now: now(),
      api,
    });
  }

  /** 同一时刻只跑一次上传，后面的排队，避免同一份课表传两遍。 */
  function enqueue(current: StoredEntry, options: DormSyncNowOptions) {
    const task = queue.then(() => upload(current, options));
    queue = task.catch(() => undefined);
    return task.then((result) => {
      if (result === "synced") for (const listener of [...syncedListeners]) listener();
      return result;
    });
  }

  /**
   * 原生交来一份快照：记下来，并在已加入宿舍时按需上传。
   * 返回 "unavailable" 表示快照不合格或没有登录。
   */
  async function offer(value: unknown, options: { force?: boolean; userId?: number } = {}): Promise<DormSyncNowResult> {
    const userId = deps.userId();
    if (!userId) {
      forget();
      return "unavailable";
    }
    // 调用方收到快照时的账号；那之后换了账号，这份课表不属于现在的账号。
    if (options.userId !== undefined && options.userId !== userId) return "skipped";
    const snapshot = readNativeDormSnapshot(value);
    if (!snapshot) return "unavailable";
    const next = { userId, snapshot, receivedAt: now() };
    const task = enqueue(next, { force: options.force });
    offering = { entry: next, task };
    const settle = () => { if (offering?.task === task) offering = null; };
    task.then(settle, settle);
    remember(next);
    return task;
  }

  /** 等原生交来快照，最多等 timeoutMs；页面刚从原生课表打开时，快照可能还在路上。 */
  function waitForSnapshot(timeoutMs: number): Promise<StoredEntry | null> {
    const ready = latest();
    if (ready || timeoutMs <= 0) return Promise.resolve(ready);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve(latest());
      };
      const timer = setTimeout(done, timeoutMs);
      waiters.add(done);
    });
  }

  /**
   * 宿舍页的立即同步（DormDialog 的 syncNow）。原生还没交来本学期课表时返回 "unavailable"，
   * 弹窗据此提示“课表加载好后会自动同步”，不会把没同步当成没课。
   */
  async function syncNow(options: DormSyncNowOptions = {}, waitMs = 5000): Promise<DormSyncNowResult> {
    const current = await waitForSnapshot(waitMs);
    if (!current) return "unavailable";
    // 这一份原生刚交来、已经在上传：传上去了就用它的结果。没传成（比如那时还没加入宿舍）或手动同步时再传。
    if (!options.force && offering?.entry === current) {
      const result = await offering.task;
      if (result === "synced" || result === "unchanged") return result;
    }
    return enqueue(current, options);
  }

  function onSynced(listener: () => void) {
    syncedListeners.add(listener);
    return () => { syncedListeners.delete(listener); };
  }

  return { offer, syncNow, latest, forget, onSynced, waitForSnapshot };
}

export type NativeDormSync = ReturnType<typeof createNativeDormSync>;
