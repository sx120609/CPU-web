// 共享课表的状态：自己发布的分享码（跟着账号走），和别人分享给我的课表（只存在这台设备上）。
import { ref } from "vue";
import { scheduleShareApi, type ScheduleShare, type ScheduleShareMeta } from "@/api/scheduleShares";
import {
  adoptSharedLibraryAccount,
  isNotFoundError,
  loadSharedLibrary,
  normalizeShareCode,
  readSharedSchedule,
  refreshSharedLibrary,
  removeSharedSchedule,
  renameSharedSchedule,
  saveSharedSchedule,
  storeSharedLibrary,
  type SavedSharedSchedule,
  type SharedScheduleLibrary,
} from "./sharedSchedules";

export class ShareImportError extends Error {
  constructor(public readonly kind: "invalidCode" | "ownShare" | "notFound", message: string) {
    super(message);
  }
}

// 弹窗和共享课表页面看的是同一份库。
const library = ref<SharedScheduleLibrary>(loadSharedLibrary());
const mine = ref<ScheduleShareMeta[]>([]);
const mineLoaded = ref(false);
let refreshing: Promise<void> | null = null;

/** 写进本地存储；存不下时不改内存里的库，并告诉调用方。 */
function commit(next: SharedScheduleLibrary) {
  if (next === library.value) return true;
  if (!storeSharedLibrary(next)) return false;
  library.value = next;
  return true;
}

export function useSharedSchedules() {
  /** 换了账号登录就从空的库开始，自己的分享码也要重新读。 */
  function adoptAccount(userId: number | string | null | undefined) {
    const account = userId === null || userId === undefined ? "" : String(userId);
    const next = adoptSharedLibraryAccount(library.value, account);
    if (next === library.value) return;
    // 上一个账号发布的分享码不属于现在这个账号。
    if (library.value.account) {
      mine.value = [];
      mineLoaded.value = false;
    }
    commit(next);
  }

  async function loadMine() {
    mine.value = (await scheduleShareApi.mine()).shares;
    mineLoaded.value = true;
  }

  /** 某个学期的分享码，发布过才有。 */
  function shareFor(semester: string) {
    return mine.value.find((item) => item.semester === semester) ?? null;
  }

  /** 发布一个学期。一个学期只有一个码：再发布一次是更新这个码显示的内容。 */
  async function publish(body: Parameters<typeof scheduleShareApi.create>[0]) {
    const published = await scheduleShareApi.create(body);
    const meta: ScheduleShareMeta = {
      code: published.code,
      owner: published.owner,
      semester: published.semester,
      courseCount: published.courseCount,
      createdAt: published.createdAt,
      updatedAt: published.updatedAt,
    };
    mine.value = [meta, ...mine.value.filter((item) => item.code !== meta.code)];
    return published;
  }

  /** 撤销一个码。服务端已经没有的码本来就不在了。 */
  async function revoke(code: string) {
    try {
      await scheduleShareApi.revoke(code);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    mine.value = mine.value.filter((item) => item.code !== code);
  }

  async function download(code: string): Promise<SavedSharedSchedule> {
    let share: ScheduleShare;
    try {
      share = await scheduleShareApi.get(code);
    } catch (error) {
      if (isNotFoundError(error)) throw new ShareImportError("notFound", "没有找到这份共享课表，可能已被撤销");
      throw error;
    }
    return readSharedSchedule(share);
  }

  /** 下载一份分享但不保存，给预览用。 */
  async function preview(input: string, signedIn: boolean) {
    const code = normalizeShareCode(input);
    if (!code) throw new ShareImportError("invalidCode", "分享码是 8 位字母和数字，请检查后再试");
    // 是不是自己的分享看账号自己的列表，不看公开的昵称：昵称谁都可以起。
    if (signedIn && !mineLoaded.value) await loadMine().catch(() => undefined);
    if (mine.value.some((item) => item.code === code)) {
      throw new ShareImportError("ownShare", "这是你自己分享的课表，直接看自己的课表就可以");
    }
    return download(code);
  }

  function save(schedule: SavedSharedSchedule, remark: string) {
    return commit(saveSharedSchedule(library.value, schedule, remark));
  }

  function rename(code: string, remark: string) {
    return commit(renameSharedSchedule(library.value, code, remark));
  }

  function remove(code: string) {
    return commit(removeSharedSchedule(library.value, code));
  }

  function saved(code: string) {
    return library.value.schedules.find((item) => item.meta.code === code) ?? null;
  }

  /** 每份保存的分享检查一次；断网等情况下保存的副本保持原样。 */
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const before = library.value;
      const next = await refreshSharedLibrary(before, scheduleShareApi);
      // 检查期间用户可能改了备注或移除了某一份，只把这次得到的课表内容合进去。
      if (next === before) return;
      let merged = library.value;
      for (const item of next.schedules) {
        const current = merged.schedules.find((entry) => entry.meta.code === item.meta.code);
        if (!current) continue;
        if (current.meta.updatedAt === item.meta.updatedAt && current.revoked === item.revoked) continue;
        merged = {
          ...merged,
          schedules: merged.schedules.map((entry) => (
            entry.meta.code === item.meta.code ? { ...item, remark: entry.remark } : entry
          )),
        };
      }
      commit(merged);
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  return {
    library,
    mine,
    adoptAccount,
    loadMine,
    shareFor,
    publish,
    revoke,
    preview,
    save,
    rename,
    remove,
    saved,
    refresh,
  };
}
