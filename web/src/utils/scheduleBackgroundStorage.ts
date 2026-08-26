const DB_NAME = "cpu-web-local-assets-v1";
const STORE_NAME = "assets";
const BACKGROUND_KEY = "schedule-background-v1";

export interface PreloadedScheduleBackgroundAsset {
  blob: Blob;
  url: string;
}

let cachedBackgroundBlob: Blob | null | undefined;
let cachedBackgroundUrl = "";
let backgroundBlobPromise: Promise<Blob | null> | null = null;
let backgroundAssetPromise: Promise<PreloadedScheduleBackgroundAsset | null> | null = null;

async function openAssetDatabase() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    throw new Error("当前浏览器不支持本地背景存储");
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地背景存储初始化失败"));
  });
}

async function runStoreRequest<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openAssetDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let settled = false;
    let request: IDBRequest<T>;

    try {
      request = action(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }

    request.onsuccess = () => {
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error("本地背景存储失败"));
    };
    transaction.onabort = () => {
      if (!settled) reject(transaction.error ?? new Error("本地背景存储失败"));
      database.close();
    };
    transaction.onerror = () => {
      if (!settled) reject(transaction.error ?? new Error("本地背景存储失败"));
    };
    transaction.oncomplete = () => {
      database.close();
    };
  });
}

export function peekPreloadedScheduleBackgroundAsset() {
  if (!cachedBackgroundBlob || !cachedBackgroundUrl) return null;
  return {
    blob: cachedBackgroundBlob,
    url: cachedBackgroundUrl,
  } satisfies PreloadedScheduleBackgroundAsset;
}

export async function readScheduleBackgroundBlob() {
  if (cachedBackgroundBlob !== undefined) return cachedBackgroundBlob;
  if (!backgroundBlobPromise) {
    backgroundBlobPromise = runStoreRequest<Blob | undefined>("readonly", (store) => store.get(BACKGROUND_KEY))
      .then((result) => {
        cachedBackgroundBlob = result ?? null;
        return cachedBackgroundBlob;
      })
      .catch((error) => {
        backgroundBlobPromise = null;
        throw error;
      });
  }
  return backgroundBlobPromise;
}

export async function preloadScheduleBackgroundAsset() {
  const readyAsset = peekPreloadedScheduleBackgroundAsset();
  if (readyAsset) return readyAsset;
  if (!backgroundAssetPromise) {
    backgroundAssetPromise = readScheduleBackgroundBlob()
      .then(async (blob) => {
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        cachedBackgroundUrl = url;
        await decodeBackgroundImage(url);
        return { blob, url } satisfies PreloadedScheduleBackgroundAsset;
      })
      .catch((error) => {
        backgroundAssetPromise = null;
        throw error;
      });
  }
  return backgroundAssetPromise;
}

export async function saveScheduleBackgroundBlob(blob: Blob) {
  await runStoreRequest<IDBValidKey>("readwrite", (store) => store.put(blob, BACKGROUND_KEY));
  resetCachedBackgroundUrl();
  cachedBackgroundBlob = blob;
  backgroundBlobPromise = Promise.resolve(blob);
  const url = URL.createObjectURL(blob);
  cachedBackgroundUrl = url;
  const asset = { blob, url } satisfies PreloadedScheduleBackgroundAsset;
  backgroundAssetPromise = decodeBackgroundImage(url).then(() => asset);
}

export async function clearScheduleBackgroundBlob() {
  await runStoreRequest<undefined>("readwrite", (store) => store.delete(BACKGROUND_KEY));
  resetCachedBackgroundUrl();
  cachedBackgroundBlob = null;
  backgroundBlobPromise = Promise.resolve(null);
  backgroundAssetPromise = null;
}

function resetCachedBackgroundUrl() {
  if (!cachedBackgroundUrl) return;
  URL.revokeObjectURL(cachedBackgroundUrl);
  cachedBackgroundUrl = "";
}

async function decodeBackgroundImage(url: string) {
  if (typeof Image === "undefined") return;
  const image = new Image();
  try {
    if (typeof image.decode === "function") {
      image.src = url;
      await image.decode();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("课表背景图片解码失败"));
      image.src = url;
    });
  } catch {
    // 图片仍可交给 CSS 加载；预解码失败不应阻止课表进入。
  }
}
