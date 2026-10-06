import { isJwxtDataCacheKey } from "@/utils/jwxtCache";

/** 网页端自己能统计和清理的分类。 */
export type WebStorageCategoryId = "offline" | "pages" | "academic";
/** 只有原生壳能清理的分类（WebView 的网络缓存、临时文件）。 */
export type NativeStorageCategoryId = "network" | "temp";
export type StorageCategoryId = WebStorageCategoryId | NativeStorageCategoryId;

export type NativeStorageUsage = {
  categories: Array<{ id: NativeStorageCategoryId; bytes: number }>;
  /** 应用在本机占用的全部数据，对应系统设置里的“文稿与数据”。 */
  totalBytes: number | null;
};

type StorageLike = Pick<Storage, "length" | "key" | "getItem" | "removeItem">;

// 页面数据快照：只为秒开页面，随时可以重新请求。草稿、外观、登录状态都不在这里。
const PAGE_CACHE_PREFIXES = [
  "cpu-home-summary-v1:",
  "cpu-home-second-hand-v1:",
  "cpu-profile-view-v1:",
  "cpu-services-tools-v1:",
  "cpu-forum-view-v1:",
];
const PAGE_CACHE_KEYS = ["cpu-iservice-apps-cache-v1"];
const SESSION_CACHE_PREFIXES = ["cpu-api-get-cache-v1:"];

export function isPageCacheKey(key: string) {
  return PAGE_CACHE_KEYS.includes(key) || PAGE_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isSessionCacheKey(key: string) {
  return SESSION_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function matchingKeys(storage: StorageLike, matches: (key: string) => boolean) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && matches(key)) keys.push(key);
  }
  return keys;
}

/** 浏览器按 UTF-16 保存键和值，每个字符两个字节。 */
export function storageBytes(storage: StorageLike, matches: (key: string) => boolean) {
  let chars = 0;
  for (const key of matchingKeys(storage, matches)) chars += key.length + (storage.getItem(key)?.length ?? 0);
  return chars * 2;
}

export function removeStorageKeys(storage: StorageLike, matches: (key: string) => boolean) {
  const keys = matchingKeys(storage, matches);
  keys.forEach((key) => storage.removeItem(key));
  return keys.length;
}

function browserStorage(kind: "localStorage" | "sessionStorage"): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window[kind];
  } catch {
    return null;
  }
}

function safely<T>(run: () => T, fallback: T) {
  try {
    return run();
  } catch {
    return fallback;
  }
}

async function mapLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await run(item);
    }
  }));
}

async function cacheStorageBytes() {
  if (typeof caches === "undefined") return 0;
  // 逐条读取大小。navigator.storage.estimate() 在 WebKit 上没有分项，在 Chromium 上清理后也不会立刻更新。
  let bytes = 0;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    await mapLimited([...await cache.keys()], 6, async (request) => {
      const response = await cache.match(request);
      if (!response) return;
      // 先等到大小再累加：`bytes += await …` 会在等待前读取旧值，并发时互相覆盖。
      const size = await response.blob().then((blob) => blob.size, () => Number(response.headers.get("content-length")) || 0);
      bytes += size;
    });
  }
  return bytes;
}

export async function measureWebStorage(id: WebStorageCategoryId): Promise<number> {
  const local = browserStorage("localStorage");
  const session = browserStorage("sessionStorage");
  if (id === "offline") return cacheStorageBytes().catch(() => 0);
  if (id === "academic") return local ? safely(() => storageBytes(local, isJwxtDataCacheKey), 0) : 0;
  return (local ? safely(() => storageBytes(local, isPageCacheKey), 0) : 0)
    + (session ? safely(() => storageBytes(session, isSessionCacheKey), 0) : 0);
}

export async function clearWebStorage(id: WebStorageCategoryId): Promise<void> {
  const local = browserStorage("localStorage");
  const session = browserStorage("sessionStorage");
  if (id === "offline") {
    if (typeof caches === "undefined") return;
    // Service Worker 仍在运行，之后访问到的资源会重新写入缓存。
    await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
    return;
  }
  if (id === "academic") {
    if (local) safely(() => removeStorageKeys(local, isJwxtDataCacheKey), 0);
    return;
  }
  if (local) safely(() => removeStorageKeys(local, isPageCacheKey), 0);
  if (session) safely(() => removeStorageKeys(session, isSessionCacheKey), 0);
}

type SyncStorageBridge = {
  getStorageUsage?: () => string;
  clearStorage?: (categories: string) => string;
};
type IosStorageHandler = { postMessage: (message: unknown) => Promise<unknown> };

// 安卓的 JavascriptInterface 是同步调用；鸿蒙以后接入时用同样的两个方法即可。
function syncStorageBridge(): SyncStorageBridge | null {
  const host = window as unknown as { CPUAndroid?: SyncStorageBridge; CPUHarmony?: SyncStorageBridge };
  const bridge = host.CPUHarmony ?? host.CPUAndroid;
  return typeof bridge?.getStorageUsage === "function" && typeof bridge.clearStorage === "function" ? bridge : null;
}

function iosStorageHandler(): IosStorageHandler | null {
  const handler = (window as unknown as {
    webkit?: { messageHandlers?: { cpuTimeStorage?: IosStorageHandler } };
  }).webkit?.messageHandlers?.cpuTimeStorage;
  return typeof handler?.postMessage === "function" ? handler : null;
}

/** 当前客户端是否带有存储清理的原生桥；旧版客户端和浏览器只显示网页端分类。 */
export function hasNativeStorageBridge() {
  if (typeof window === "undefined") return false;
  return Boolean(iosStorageHandler() ?? syncStorageBridge());
}

const NATIVE_CATEGORY_IDS: NativeStorageCategoryId[] = ["network", "temp"];

function nonNegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

export function parseNativeStorageUsage(raw: unknown): NativeStorageUsage | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const record = value as { categories?: unknown; totalBytes?: unknown };
  if (!Array.isArray(record.categories)) return null;
  const categories = record.categories
    .filter((item): item is { id: NativeStorageCategoryId; bytes?: unknown } => (
      Boolean(item) && NATIVE_CATEGORY_IDS.includes((item as { id?: NativeStorageCategoryId }).id as NativeStorageCategoryId)
    ))
    .map((item) => ({ id: item.id, bytes: nonNegative(item.bytes) }));
  return { categories, totalBytes: record.totalBytes == null ? null : nonNegative(record.totalBytes) };
}

async function callNative(action: "usage" | "clear", categories: NativeStorageCategoryId[] = []) {
  try {
    const ios = iosStorageHandler();
    if (ios) return parseNativeStorageUsage(await ios.postMessage({ action, categories }));
    const bridge = syncStorageBridge();
    if (!bridge) return null;
    return parseNativeStorageUsage(action === "usage" ? bridge.getStorageUsage!() : bridge.clearStorage!(JSON.stringify(categories)));
  } catch {
    return null;
  }
}

export function measureNativeStorage() {
  return callNative("usage");
}

/** 清理后返回最新的占用；原生桥不可用或清理失败时返回 null。 */
export function clearNativeStorage(categories: NativeStorageCategoryId[]) {
  return callNative("clear", categories);
}

export function formatBytes(bytes: number) {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (value < 1024) return value ? "不到 1 KB" : "0 KB";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${trimDecimal(value / 1024 / 1024)} MB`;
  return `${trimDecimal(value / 1024 / 1024 / 1024, 2)} GB`;
}

function trimDecimal(value: number, digits = 1) {
  return String(Number(value.toFixed(digits)));
}
