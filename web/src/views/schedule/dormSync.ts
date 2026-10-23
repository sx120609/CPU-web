import { dormApi, type DormStatus } from "@/api/dorm";
import { applyScheduleEditsToCells, type ScheduleEditState } from "@/utils/scheduleEdits";
import { snapshotFingerprint } from "./couple";
import type { CalendarResult, ScheduleResult } from "./types";

const STATUS_KEY = "cpu-dorm-status-v1";
const SYNC_KEY = "cpu-dorm-sync-v2";
const LEGACY_SYNC_KEY = "cpu-dorm-sync-v1";
// 不在宿舍里时不必每次打开课表都问服务端。
const UNBOUND_STATUS_TTL_MS = 10 * 60 * 1000;
// 只有周视图数据时，拉取整学期课表需要再请求一次教务，所以限制频率。
const WEEKLY_SOURCE_RESYNC_MS = 6 * 60 * 60 * 1000;
// 内容没变时也定期刷新“同步于”时间，让室友知道这份课表仍然可信。
const UNCHANGED_RESYNC_MS = 12 * 60 * 60 * 1000;

type StoredStatus = { userId: number; status: DormStatus["status"]; dormId?: number; checkedAt: number };
/** 上次上传记录绑定到具体宿舍：被移出后加入别的宿舍，旧记录不能让新宿舍跳过上传。 */
type StoredSync = { userId: number; dormId: number; semester: string; editsHash: string; hash: string; syncedAt: number };

export type DormSyncResult = "skipped" | "unchanged" | "synced" | "failed";
/** 课表页给宿舍弹窗的立即同步；"unavailable" 表示课表还没加载好或正在看往年学期。 */
export type DormSyncNowResult = DormSyncResult | "unavailable";
export type DormSyncNowOptions = Pick<DormSyncInput, "status" | "force">;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储不可用时每次都重新检查 */ }
}

function forgetSync() {
  try {
    localStorage.removeItem(SYNC_KEY);
    localStorage.removeItem(LEGACY_SYNC_KEY);
  } catch { /* ignore */ }
}

/** 宿舍状态变化后调用（弹窗里创建、加入、退出都要调），让课表页立即按新状态决定是否同步。 */
export function rememberDormStatus(userId: number | null | undefined, status: DormStatus) {
  if (!userId) return;
  const dormId = status.status === "active" ? status.id : undefined;
  writeJson(STATUS_KEY, { userId, status: status.status, dormId, checkedAt: Date.now() } satisfies StoredStatus);
  const last = readJson<StoredSync>(SYNC_KEY);
  if (status.status !== "active" || (last && (last.userId !== userId || last.dormId !== dormId))) forgetSync();
}

/** 未过期的“不在宿舍里”缓存返回 "none"，其余情况都需要问服务端。 */
export function readCachedDormStatus(userId: number, now = Date.now()) {
  const cached = readJson<StoredStatus>(STATUS_KEY);
  return cached?.userId === userId && cached.status === "none" && now - cached.checkedAt < UNBOUND_STATUS_TTL_MS ? "none" : null;
}

type DormSyncApi = Pick<typeof dormApi, "status" | "syncSchedule">;
type ActiveDormStatus = Extract<DormStatus, { status: "active" }>;

async function activeDorm(api: DormSyncApi, userId: number, now: number, known?: DormStatus): Promise<ActiveDormStatus | null> {
  if (!known) {
    const cached = readJson<StoredStatus>(STATUS_KEY);
    if (cached?.userId === userId && cached.status !== "active" && now - cached.checkedAt < UNBOUND_STATUS_TTL_MS) return null;
  }
  const status = known ?? await api.status(true);
  rememberDormStatus(userId, status);
  return status.status === "active" ? status : null;
}

export interface DormSyncInput {
  userId: number | null | undefined;
  semester: string;
  parsed: ScheduleResult;
  calendar: CalendarResult;
  edits: ScheduleEditState;
  /** 当前页面只有单周数据时，用它拉取整学期课表。 */
  loadSemesterSchedule?: () => Promise<ScheduleResult>;
  /** 调用方刚从服务端拿到的宿舍状态，省掉一次查询。 */
  status?: DormStatus;
  /** 用户手动同步：忽略本地“内容没变”的判断，一定上传一次。 */
  force?: boolean;
  /** 每次等待之后都会问一次：页面卸载或换了账号就返回 false，旧账号的课表不能用新登录上传。 */
  isCurrent?: () => boolean;
  now?: number;
  api?: DormSyncApi;
}

/**
 * 已在宿舍课表里时，把当前学期完整课表（含自定义修改）同步给服务端。
 * 全部失败都不抛出：同步是附带功能，不能影响课表本身；"failed" 只给手动同步的界面提示用。
 */
export async function syncDormScheduleIfJoined(input: DormSyncInput): Promise<DormSyncResult> {
  const now = input.now ?? Date.now();
  const api = input.api ?? dormApi;
  if (!input.userId || !input.semester) return "skipped";
  const current = () => input.isCurrent?.() ?? true;
  if (!current()) return "skipped";
  try {
    const dorm = await activeDorm(api, input.userId, now, input.status);
    if (!dorm || !current()) return "skipped";
    const editsHash = snapshotFingerprint(input.edits);
    const last = readJson<StoredSync>(SYNC_KEY);
    // 服务端没有这学期的快照（刚加入、被移出后重新加入、快照被清理）时，本地记录不算数。
    const serverHasSnapshot = dorm.me.snapshot?.semester === input.semester;
    const sameTarget = !input.force
      && serverHasSnapshot
      && last?.userId === input.userId
      && last.dormId === dorm.id
      && last.semester === input.semester;
    let source = input.parsed;
    if (source.scope !== "semester") {
      if (!input.loadSemesterSchedule) return "skipped";
      if (sameTarget && last.editsHash === editsHash && now - last.syncedAt < WEEKLY_SOURCE_RESYNC_MS) return "unchanged";
      source = await input.loadSemesterSchedule();
      if (source.currentSemester && source.currentSemester !== input.semester) return "skipped";
    }
    const schedule: ScheduleResult = { ...source, cells: applyScheduleEditsToCells(source.cells, input.edits) };
    const payload = { semester: input.semester, schedule, calendar: input.calendar };
    const hash = snapshotFingerprint(payload);
    if (sameTarget && last.hash === hash && now - last.syncedAt < UNCHANGED_RESYNC_MS) return "unchanged";
    // 拉整学期课表要等教务，等的时候可能已经换了账号。
    if (!current()) return "skipped";
    await api.syncSchedule(payload);
    if (!current()) return "skipped";
    writeJson(SYNC_KEY, {
      userId: input.userId,
      dormId: dorm.id,
      semester: input.semester,
      editsHash,
      hash,
      syncedAt: now,
    } satisfies StoredSync);
    return "synced";
  } catch {
    return "failed";
  }
}
