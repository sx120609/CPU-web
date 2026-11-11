import { nativeScheduleAccountKey } from "../../web/src/utils/iosNextScheduleBridge";
import {
  AGENDA_COLLECTION,
  AGENDA_MAX_ITEMS,
  agendaWithDone,
  newAgendaId,
  normalizeAgendaItem,
  parseAgendaText,
  type AgendaItem,
} from "../../web/src/utils/agenda";
import { useAuthStore } from "./adapters";

/**
 * `window.CPUTimeNativeAgenda` for the HarmonyOS app. The live site installs that bridge only for user
 * agents with `CPUTimeNative/`, which this shell does not send, so 日程 stayed empty ("登录后就能记日程")
 * however the user was signed in. This is the site's bridge (web/src/utils/nativeAgendaBridge.ts) over
 * the same records (`/api/next-sync`, collection `agenda`) and the same local copy as the site's agenda
 * store (web/src/stores/agenda.ts, `cpu-agenda-v1:<user>` in localStorage), without Vue or Pinia.
 */
type AgendaRequest = {
  action?: string;
  refresh?: boolean;
  id?: string;
  date?: string;
  done?: boolean;
  data?: Partial<AgendaItem>;
  on?: boolean;
  text?: string;
  image?: string;
};
type SyncRecord = { collection: string; id: string; updatedAt: number; deleted: boolean; data?: unknown };

const STORAGE_PREFIX = "cpu-agenda-v1";
const SETTINGS_COLLECTION = "settings";
const SETTINGS_ID = "agenda-preferences";
const SETTINGS_DIRTY = `${SETTINGS_COLLECTION}:${SETTINGS_ID}`;
const TOMBSTONE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
const PUSH_BATCH = 50;
const MAX_PULL_PAGES = 30;

export function installHarmonyAgenda() {
  const host = window as any;
  if (typeof host.CPUTimeNativeAgenda === "function") return;

  let owner = 0;
  let items: AgendaItem[] = [];
  let deleted: Record<string, number> = {};
  let dirty: string[] = [];
  let cursor = "";
  let relay = false;
  let relayUpdatedAt = 0;
  let syncedAt = 0;
  let error = "";
  let running: Promise<void> | null = null;
  let again = false;
  let signature = "";

  const cookie = (name: string) => {
    const part = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(name + "="));
    return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
  };
  async function request(method: string, path: string, body?: unknown, timeoutMs = 30000) {
    const auth = useAuthStore();
    const headers: Record<string, string> = { "X-CPU-Auth-Mode": "cookie", "X-CPU-Client": "harmony-app" };
    if (auth?.token && auth.token !== "__cpu_cookie_session__") headers.Authorization = `Bearer ${auth.token}`;
    if (method !== "GET") headers["X-CSRF-Token"] = cookie("__Host-cpu-csrf") || cookie("cpu-csrf");
    const init: RequestInit = { method, credentials: "same-origin", headers, cache: "no-store" };
    if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("/api" + path, { ...init, signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
        throw new Error(response.status === 401 ? "401" : payload.message || "请求失败");
      }
      return typeof payload.code === "number" ? payload.data : payload;
    } finally {
      clearTimeout(timer);
    }
  }

  const key = (userId: number) => `${STORAGE_PREFIX}:${userId}`;
  function read(userId: number) {
    try {
      const raw = JSON.parse(localStorage.getItem(key(userId)) || "null");
      if (!raw || typeof raw !== "object") return null;
      return raw;
    } catch {
      return null;
    }
  }
  function persist() {
    if (!owner) return;
    const horizon = Date.now() - TOMBSTONE_LIFETIME_MS;
    deleted = Object.fromEntries(Object.entries(deleted).filter(([, at]) => at > horizon));
    try {
      localStorage.setItem(key(owner), JSON.stringify({ items, deleted, dirty, cursor, relay, relayUpdatedAt, syncedAt }));
    } catch { /* memory copy still works */ }
  }
  function attach() {
    const auth = useAuthStore();
    const userId = Number(auth?.user?.id || 0);
    if (!auth?.isLoggedIn || !userId) {
      owner = 0; items = []; deleted = {}; dirty = []; cursor = ""; relay = false;
      return false;
    }
    if (owner === userId) return true;
    const raw = read(userId);
    owner = userId;
    items = Array.isArray(raw?.items) ? raw.items.map(normalizeAgendaItem).filter(Boolean) as AgendaItem[] : [];
    deleted = raw?.deleted && typeof raw.deleted === "object" ? raw.deleted : {};
    dirty = Array.isArray(raw?.dirty) ? raw.dirty.filter((id: unknown) => typeof id === "string") : [];
    cursor = typeof raw?.cursor === "string" ? raw.cursor : "";
    relay = raw?.relay === true;
    relayUpdatedAt = Number(raw?.relayUpdatedAt) || 0;
    syncedAt = Number(raw?.syncedAt) || 0;
    error = "";
    return true;
  }
  const nextVersion = (previous = 0) => Math.max(Date.now(), previous + 1);
  const find = (id: string) => items.find((item) => item.id === id) ?? null;
  function markDirty(id: string) {
    if (!dirty.includes(id)) dirty = [...dirty, id];
    persist();
  }
  function save(input: Partial<AgendaItem> & { title: string }): AgendaItem | null {
    if (!attach()) return null;
    const existing = input.id ? find(input.id) : null;
    if (!existing && items.length >= AGENDA_MAX_ITEMS) {
      error = `日程最多 ${AGENDA_MAX_ITEMS} 条，先删掉一些不需要的`;
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
    const { [prepared.id]: _removed, ...rest } = deleted;
    deleted = rest;
    items = existing ? items.map((item) => (item.id === prepared.id ? prepared : item)) : [...items, prepared];
    markDirty(prepared.id);
    return prepared;
  }
  function remove(id: string) {
    const existing = find(id);
    if (!existing || !attach()) return;
    items = items.filter((item) => item.id !== id);
    deleted = { ...deleted, [id]: nextVersion(existing.updatedAt) };
    markDirty(id);
  }
  function setDone(id: string, date: string, done: boolean) {
    const existing = find(id);
    if (!existing || !attach()) return;
    const next = { ...agendaWithDone(existing, date, done), updatedAt: nextVersion(existing.updatedAt) };
    items = items.map((item) => (item.id === id ? next : item));
    markDirty(id);
  }
  function setRelay(on: boolean) {
    if (!attach()) return;
    relay = on;
    relayUpdatedAt = nextVersion(relayUpdatedAt);
    markDirty(SETTINGS_DIRTY);
  }
  function applyRemote(record: SyncRecord) {
    if (record.collection === SETTINGS_COLLECTION && record.id === SETTINGS_ID) {
      if (record.updatedAt > relayUpdatedAt) {
        relay = !record.deleted && Boolean((record.data as { relay?: unknown } | null)?.relay);
        relayUpdatedAt = record.updatedAt;
        dirty = dirty.filter((entry) => entry !== SETTINGS_DIRTY);
      } else if (record.updatedAt === relayUpdatedAt) {
        dirty = dirty.filter((entry) => entry !== SETTINGS_DIRTY);
      }
      return;
    }
    if (record.collection !== AGENDA_COLLECTION) return;
    const local = find(record.id);
    const localAt = local?.updatedAt ?? deleted[record.id] ?? 0;
    if (record.updatedAt < localAt) return;
    dirty = dirty.filter((entry) => entry !== record.id);
    if (record.updatedAt === localAt) return;
    if (record.deleted) {
      items = items.filter((item) => item.id !== record.id);
      deleted = { ...deleted, [record.id]: record.updatedAt };
      return;
    }
    const incoming = normalizeAgendaItem({ ...(record.data as object), id: record.id, updatedAt: record.updatedAt });
    if (!incoming) return;
    const { [record.id]: _gone, ...rest } = deleted;
    deleted = rest;
    items = local ? items.map((item) => (item.id === record.id ? incoming : item)) : [...items, incoming];
  }
  function outgoing(entry: string): SyncRecord | null {
    if (entry === SETTINGS_DIRTY) {
      return { collection: SETTINGS_COLLECTION, id: SETTINGS_ID, updatedAt: relayUpdatedAt || nextVersion(), deleted: false, data: { relay } };
    }
    const item = find(entry);
    if (item) return { collection: AGENDA_COLLECTION, id: item.id, updatedAt: item.updatedAt, deleted: false, data: item };
    const removedAt = deleted[entry];
    return removedAt ? { collection: AGENDA_COLLECTION, id: entry, updatedAt: removedAt, deleted: true } : null;
  }
  async function runSync() {
    if (!attach()) return;
    const userId = owner;
    let problem = "";
    try {
      for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
        const query = `?collection=agenda,settings${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const result = await request("GET", `/next-sync${query}`);
        if (owner !== userId) return;
        (result?.records ?? []).forEach(applyRemote);
        cursor = result?.cursor || cursor;
        if (!result?.more) break;
      }
      const keys = [...dirty];
      for (let index = 0; index < keys.length; index += PUSH_BATCH) {
        const slice = keys.slice(index, index + PUSH_BATCH);
        const batch = slice.map((entry) => ({ entry, record: outgoing(entry) }))
          .filter((pair): pair is { entry: string; record: SyncRecord } => Boolean(pair.record));
        const unknown = slice.filter((entry) => !batch.some((pair) => pair.entry === entry));
        if (unknown.length) dirty = dirty.filter((entry) => !unknown.includes(entry));
        if (!batch.length) continue;
        const reply = await request("POST", "/next-sync", { records: batch.map((pair) => pair.record) });
        if (owner !== userId) return;
        const sent = new Map(batch.map((pair) => [pair.entry, pair.record.updatedAt]));
        for (const applied of reply?.applied ?? []) {
          const entry = applied.collection === SETTINGS_COLLECTION ? SETTINGS_DIRTY : applied.id;
          if (outgoing(entry)?.updatedAt === sent.get(entry)) dirty = dirty.filter((item) => item !== entry);
        }
        (reply?.newer ?? []).forEach(applyRemote);
        for (const rejected of reply?.rejected ?? []) {
          const entry = rejected.collection === SETTINGS_COLLECTION ? SETTINGS_DIRTY : rejected.id;
          dirty = dirty.filter((item) => item !== entry);
          problem = rejected.reason === "limit" ? `日程最多 ${AGENDA_MAX_ITEMS} 条，超出的没有同步` : "有一条日程格式不对，没有同步";
        }
      }
      syncedAt = Date.now();
      error = problem;
    } catch (cause) {
      if (owner === userId) error = String((cause as Error)?.message).includes("401") ? "请先登录" : "同步失败，改动已存在本机，稍后会再试";
    } finally {
      if (owner === userId) persist();
    }
  }
  async function sync() {
    if (running) { again = true; return running; }
    running = (async () => {
      do { again = false; await runSync(); } while (again);
    })().finally(() => { running = null; });
    await running;
    const next = JSON.stringify(items.map((item) => [item.id, item.updatedAt]));
    if (next !== signature) {
      const changed = signature !== "";
      signature = next;
      if (changed) host.CPUTimeNative?.agendaChanged?.();
    }
  }

  const reply = () => (attach()
    ? { authenticated: true, account: nativeScheduleAccountKey(), items: JSON.parse(JSON.stringify(items)), relay, ...(error ? { error } : {}) }
    : { authenticated: false, account: "", items: [], relay: false });

  const authSettled = async () => {
    for (let waited = 0; waited < 8000; waited += 200) {
      const auth = useAuthStore();
      if (auth && auth.ready !== false) return true;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  };

  host.CPUTimeNativeAgenda = async (input: AgendaRequest = {}) => {
    try {
      if (input.action === "parse") return { parsed: parseAgendaText(String(input.text ?? "").slice(0, 120)) };
      if (!(await authSettled())) return { missing: true };
      if (!useAuthStore()?.isLoggedIn || !attach()) return reply();
      if (input.action === "extract") {
        const image = typeof input.image === "string" && input.image.startsWith("data:image/") ? input.image : undefined;
        const text = typeof input.text === "string" ? input.text.trim().slice(0, 4000) : "";
        if (!image && !text) return { items: [], message: "先选一张截图或粘贴通知文字" };
        try {
          const result = await request("POST", "/search/assistant/agenda-extract", { ...(image ? { image } : {}), ...(text ? { text } : {}) }, 120000);
          return { items: result?.items ?? [], message: result?.message ?? "" };
        } catch (cause) {
          return { items: [], message: (cause as Error)?.message && (cause as Error).message !== "401" ? (cause as Error).message : "拾间AI 暂时不可用" };
        }
      }
      switch (input.action) {
        case "toggle":
          if (input.id && typeof input.date === "string") setDone(input.id, input.date, input.done !== false);
          await sync();
          return reply();
        case "save": {
          const data = input.data && typeof input.data === "object" ? input.data : null;
          const saved = data && typeof data.title === "string" ? save({ ...data, title: data.title }) : null;
          if (saved) await sync();
          return { ...reply(), saved, ...(saved ? {} : { error: error || "先写个标题" }) };
        }
        case "remove":
          if (input.id) remove(input.id);
          await sync();
          return reply();
        case "relay":
          setRelay(input.on === true);
          await sync();
          return reply();
        default:
          if (input.refresh !== false) await sync();
          return reply();
      }
    } catch (cause) {
      return { ...reply(), error: cause instanceof Error ? cause.message : "日程暂时读不出来" };
    }
  };
}
