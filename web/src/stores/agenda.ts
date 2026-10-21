import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { agendaApi, type SyncRecord } from "@/api/agenda";
import { useAuthStore } from "@/stores/auth";
import {
  AGENDA_COLLECTION,
  AGENDA_MAX_ITEMS,
  agendaWithDone,
  newAgendaId,
  normalizeAgendaItem,
  type AgendaItem,
} from "@/utils/agenda";

// 日程：网页和各客户端共用 `/api/next-sync` 里的 `agenda` 记录（和药大拾间 NEXT 是同一批）。
// 本机留一份副本和还没传上去的改动，打开页面、回到前台、改动之后各同步一次；同一条以
// 修改时间新的为准，删除留墓碑，和 NEXT 的 NextSync.kt 同一套规则。

const STORAGE_PREFIX = "cpu-agenda-v1";
const SETTINGS_COLLECTION = "settings";
const SETTINGS_ID = "agenda-preferences";
/** 和服务器一样记 180 天，离线的设备回来时也会删掉。 */
const TOMBSTONE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
const PUSH_BATCH = 50;
const MAX_PULL_PAGES = 30;

type Stored = {
  items: AgendaItem[];
  deleted: Record<string, number>;
  dirty: string[];
  cursor: string;
  relay: boolean;
  relayUpdatedAt: number;
  syncedAt: number;
};

function emptyStored(): Stored {
  return { items: [], deleted: {}, dirty: [], cursor: "", relay: false, relayUpdatedAt: 0, syncedAt: 0 };
}

/** 设置也作为一条待上传的「改动」，用这个名字记在 dirty 里。 */
const SETTINGS_DIRTY = `${SETTINGS_COLLECTION}:${SETTINGS_ID}`;

export const useAgendaStore = defineStore("agenda", () => {
  const auth = useAuthStore();
  const items = ref<AgendaItem[]>([]);
  const deleted = ref<Record<string, number>>({});
  const dirty = ref<string[]>([]);
  const cursor = ref("");
  const relay = ref(false);
  const relayUpdatedAt = ref(0);
  const syncedAt = ref(0);
  const syncing = ref(false);
  const error = ref("");
  /** 本机副本属于哪个账号；换账号时清空重来。 */
  const owner = ref(0);
  let pushTimer = 0;
  let running: Promise<void> | null = null;
  let again = false;

  const ready = computed(() => owner.value > 0 && owner.value === Number(auth.user?.id || 0));

  function storageKey(userId: number) {
    return `${STORAGE_PREFIX}:${userId}`;
  }

  function read(userId: number): Stored {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey(userId)) || "null");
      if (!raw || typeof raw !== "object") return emptyStored();
      return {
        items: Array.isArray(raw.items) ? raw.items.map(normalizeAgendaItem).filter(Boolean) as AgendaItem[] : [],
        deleted: raw.deleted && typeof raw.deleted === "object" ? raw.deleted : {},
        dirty: Array.isArray(raw.dirty) ? raw.dirty.filter((id: unknown) => typeof id === "string") : [],
        cursor: typeof raw.cursor === "string" ? raw.cursor : "",
        relay: raw.relay === true,
        relayUpdatedAt: Number(raw.relayUpdatedAt) || 0,
        syncedAt: Number(raw.syncedAt) || 0,
      };
    } catch {
      return emptyStored();
    }
  }

  function persist() {
    if (!owner.value) return;
    const horizon = Date.now() - TOMBSTONE_LIFETIME_MS;
    deleted.value = Object.fromEntries(Object.entries(deleted.value).filter(([, at]) => at > horizon));
    const body: Stored = {
      items: items.value,
      deleted: deleted.value,
      dirty: dirty.value,
      cursor: cursor.value,
      relay: relay.value,
      relayUpdatedAt: relayUpdatedAt.value,
      syncedAt: syncedAt.value,
    };
    try { localStorage.setItem(storageKey(owner.value), JSON.stringify(body)); } catch { /* 存不下也照常用内存里的 */ }
  }

  /** 读出当前账号的本机副本。没登录时清空；返回是否可用。 */
  function attach() {
    const userId = Number(auth.user?.id || 0);
    if (!auth.isLoggedIn || !userId) {
      owner.value = 0;
      items.value = [];
      deleted.value = {};
      dirty.value = [];
      cursor.value = "";
      relay.value = false;
      return false;
    }
    if (owner.value === userId) return true;
    const stored = read(userId);
    owner.value = userId;
    items.value = stored.items;
    deleted.value = stored.deleted;
    dirty.value = stored.dirty;
    cursor.value = stored.cursor;
    relay.value = stored.relay;
    relayUpdatedAt.value = stored.relayUpdatedAt;
    syncedAt.value = stored.syncedAt;
    error.value = "";
    return true;
  }

  /** 比这一条以前的版本都新的修改时间（本机时钟往回拨也不会让新改动输掉）。 */
  function nextVersion(previous = 0) {
    return Math.max(Date.now(), previous + 1);
  }

  function markDirty(key: string) {
    if (!dirty.value.includes(key)) dirty.value = [...dirty.value, key];
    persist();
    clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => { void sync(); }, 400);
  }

  function find(id: string) {
    return items.value.find((item) => item.id === id) ?? null;
  }

  /** 保存新的或改过的一条；没有标题等原因存不了时返回 null。 */
  function save(input: Partial<AgendaItem> & { title: string }): AgendaItem | null {
    if (!attach()) return null;
    const existing = input.id ? find(input.id) : null;
    if (!existing && items.value.length >= AGENDA_MAX_ITEMS) {
      error.value = `日程最多 ${AGENDA_MAX_ITEMS} 条，先删掉一些不需要的`;
      return null;
    }
    const now = nextVersion(existing?.updatedAt);
    const prepared = normalizeAgendaItem({
      ...existing,
      ...input,
      id: existing?.id || input.id || newAgendaId(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      done: input.done ?? existing?.done ?? false,
      doneDates: input.doneDates ?? existing?.doneDates ?? [],
      origin: existing?.origin ?? input.origin ?? "user",
    });
    if (!prepared) return null;
    const { [prepared.id]: _removed, ...rest } = deleted.value;
    deleted.value = rest;
    items.value = existing ? items.value.map((item) => (item.id === prepared.id ? prepared : item)) : [...items.value, prepared];
    markDirty(prepared.id);
    return prepared;
  }

  function remove(id: string) {
    const existing = find(id);
    if (!existing || !attach()) return null;
    items.value = items.value.filter((item) => item.id !== id);
    deleted.value = { ...deleted.value, [id]: nextVersion(existing.updatedAt) };
    markDirty(id);
    return existing;
  }

  /** 撤销刚才的删除：算作现在改的，所以会盖过别处的删除。 */
  function restore(item: AgendaItem) {
    if (find(item.id) || !attach()) return;
    const { [item.id]: removedAt = 0, ...rest } = deleted.value;
    deleted.value = rest;
    items.value = [...items.value, { ...item, updatedAt: nextVersion(Math.max(item.updatedAt, removedAt)) }];
    markDirty(item.id);
  }

  /** 勾掉或取消勾掉一次；重复的事只改那一天。 */
  function setDone(id: string, date: string, done: boolean) {
    const existing = find(id);
    if (!existing || !attach()) return;
    const next = { ...agendaWithDone(existing, date, done), updatedAt: nextVersion(existing.updatedAt) };
    items.value = items.value.map((item) => (item.id === id ? next : item));
    markDirty(id);
  }

  function setRelay(on: boolean) {
    if (!attach()) return;
    relay.value = on;
    relayUpdatedAt.value = nextVersion(relayUpdatedAt.value);
    markDirty(SETTINGS_DIRTY);
  }

  /** 收下服务器上更新的一条；不比本机新就不动。 */
  function applyRemote(record: SyncRecord) {
    if (record.collection === SETTINGS_COLLECTION && record.id === SETTINGS_ID) {
      if (record.updatedAt > relayUpdatedAt.value) {
        relay.value = !record.deleted && Boolean((record.data as { relay?: unknown } | null)?.relay);
        relayUpdatedAt.value = record.updatedAt;
        dirty.value = dirty.value.filter((key) => key !== SETTINGS_DIRTY);
      } else if (record.updatedAt === relayUpdatedAt.value) {
        dirty.value = dirty.value.filter((key) => key !== SETTINGS_DIRTY);
      }
      return;
    }
    if (record.collection !== AGENDA_COLLECTION) return;
    const local = find(record.id);
    const localAt = local?.updatedAt ?? deleted.value[record.id] ?? 0;
    if (record.updatedAt < localAt) return;
    if (record.updatedAt === localAt) {
      // 服务器已经有这一版。
      dirty.value = dirty.value.filter((key) => key !== record.id);
      return;
    }
    dirty.value = dirty.value.filter((key) => key !== record.id);
    if (record.deleted) {
      items.value = items.value.filter((item) => item.id !== record.id);
      deleted.value = { ...deleted.value, [record.id]: record.updatedAt };
      return;
    }
    const incoming = normalizeAgendaItem({ ...(record.data as object), id: record.id, updatedAt: record.updatedAt });
    if (!incoming) return;
    const { [record.id]: _gone, ...rest } = deleted.value;
    deleted.value = rest;
    items.value = local ? items.value.map((item) => (item.id === record.id ? incoming : item)) : [...items.value, incoming];
  }

  function outgoing(key: string) {
    if (key === SETTINGS_DIRTY) {
      return { collection: SETTINGS_COLLECTION, id: SETTINGS_ID, updatedAt: relayUpdatedAt.value || nextVersion(), deleted: false, data: { relay: relay.value } };
    }
    const item = find(key);
    if (item) return { collection: AGENDA_COLLECTION, id: item.id, updatedAt: item.updatedAt, deleted: false, data: item };
    const removedAt = deleted.value[key];
    if (removedAt) return { collection: AGENDA_COLLECTION, id: key, updatedAt: removedAt, deleted: true };
    return null;
  }

  async function runSync() {
    if (!attach()) return;
    const userId = owner.value;
    syncing.value = true;
    let problem = "";
    try {
      // 先拉下别处的改动，再传本机的。
      for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
        const result = await agendaApi.pull(cursor.value);
        if (owner.value !== userId) return;
        result.records.forEach(applyRemote);
        cursor.value = result.cursor || cursor.value;
        if (!result.more) break;
      }
      const keys = [...dirty.value];
      for (let index = 0; index < keys.length; index += PUSH_BATCH) {
        const batch = keys.slice(index, index + PUSH_BATCH)
          .map((key) => ({ key, record: outgoing(key) }))
          .filter((entry): entry is { key: string; record: NonNullable<ReturnType<typeof outgoing>> } => Boolean(entry.record));
        const unknown = keys.slice(index, index + PUSH_BATCH).filter((key) => !batch.some((entry) => entry.key === key));
        if (unknown.length) dirty.value = dirty.value.filter((key) => !unknown.includes(key));
        if (!batch.length) continue;
        const reply = await agendaApi.push(batch.map((entry) => entry.record));
        if (owner.value !== userId) return;
        const sent = new Map(batch.map((entry) => [entry.key, entry.record.updatedAt]));
        for (const applied of reply.applied) {
          const key = applied.collection === SETTINGS_COLLECTION ? SETTINGS_DIRTY : applied.id;
          // 上传途中又改了的那一条留着下次再传。
          if (outgoing(key)?.updatedAt === sent.get(key)) dirty.value = dirty.value.filter((item) => item !== key);
        }
        reply.newer.forEach(applyRemote);
        for (const rejected of reply.rejected) {
          const key = rejected.collection === SETTINGS_COLLECTION ? SETTINGS_DIRTY : rejected.id;
          dirty.value = dirty.value.filter((item) => item !== key);
          problem = rejected.reason === "limit" ? `日程最多 ${AGENDA_MAX_ITEMS} 条，超出的没有同步` : "有一条日程格式不对，没有同步";
        }
      }
      syncedAt.value = Date.now();
      error.value = problem;
    } catch (cause) {
      if (owner.value === userId) error.value = (cause as { message?: string })?.message?.includes("401") ? "请先登录" : "同步失败，改动已存在本机，稍后会再试";
    } finally {
      if (owner.value === userId) {
        syncing.value = false;
        persist();
      }
    }
  }

  /** 和服务器同步一次；正在同步时等它结束再来一次。 */
  async function sync() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await runSync();
      } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  return {
    items,
    relay,
    syncing,
    syncedAt,
    error,
    ready,
    dirtyCount: computed(() => dirty.value.length),
    attach,
    sync,
    save,
    remove,
    restore,
    setDone,
    setRelay,
    find,
  };
});
