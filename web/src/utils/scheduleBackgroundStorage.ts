const DB_NAME = "cpu-web-local-assets-v1";
const STORE_NAME = "assets";
const BACKGROUND_KEY = "schedule-background-v1";

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

export async function readScheduleBackgroundBlob() {
  const result = await runStoreRequest<Blob | undefined>("readonly", (store) => store.get(BACKGROUND_KEY));
  return result ?? null;
}

export async function saveScheduleBackgroundBlob(blob: Blob) {
  await runStoreRequest<IDBValidKey>("readwrite", (store) => store.put(blob, BACKGROUND_KEY));
}

export async function clearScheduleBackgroundBlob() {
  await runStoreRequest<undefined>("readwrite", (store) => store.delete(BACKGROUND_KEY));
}
