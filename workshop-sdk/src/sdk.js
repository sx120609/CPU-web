/** CPU Workshop protocol v1. Runs without dependencies in an opaque-origin iframe. */
export function createWorkshopSDK({
  timeout = 8000,
  interactionTimeout = 60000,
} = {}) {
  let port;
  let closed = false;
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  let rejectReady;
  let cleanupHandshake = () => {};
  const ready = new Promise((resolve, reject) => {
    rejectReady = reject;
    const timer = setTimeout(() => {
      window.removeEventListener("message", connect);
      reject(
        new Error("无法连接创意工坊。请从作品页打开，或显式启用本地预览。"),
      );
    }, timeout);
    cleanupHandshake = () => {
      clearTimeout(timer);
      window.removeEventListener("message", connect);
    };
    function connect(event) {
      if (
        closed ||
        event.source !== window.parent ||
        event.data?.type !== "cpu-workshop:connect" ||
        event.data.protocol !== 1 ||
        !event.ports[0]
      )
        return;
      cleanupHandshake();
      port = event.ports[0];
      port.onmessage = ({ data }) => {
        if (data?.type === "response") {
          const request = pending.get(data.id);
          if (!request) return;
          clearTimeout(request.timer);
          pending.delete(data.id);
          if (data.error) {
            const error = new Error(data.error.message || "请求失败");
            error.code = data.error.code;
            request.reject(error);
          } else request.resolve(data.result);
        } else if (
          data?.type === "event" &&
          [
            "pause",
            "resume",
            "show",
            "hide",
            "themechange",
            "resize",
            "shake",
          ].includes(data.event)
        ) {
          for (const listener of listeners.get(data.event) || []) {
            try {
              listener(data.data || {});
            } catch (error) {
              console.error(error);
            }
          }
        }
      };
      port.start();
      resolve({ appId: event.data.appId });
    }
    window.addEventListener("message", connect);
    window.parent.postMessage({ type: "cpu-workshop:ready", protocol: 1 }, "*");
  });
  async function request(method, params = {}, requestTimeout = timeout) {
    await ready;
    if (closed) throw new Error("SDK 已关闭");
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("创意工坊请求超时"));
      }, requestTimeout);
      pending.set(id, { resolve, reject, timer });
      try {
        port.postMessage({ type: "request", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }
  let writes = Promise.resolve();
  const enqueue = (operation) => {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  };
  return {
    ready,
    getEnvironment: () => request("env.get"),
    getSiteInfo: () => request("site.getInfo"),
    listWorks: (params = {}) => request("site.listWorks", params),
    showToast: (params) => request("ui.toast", params),
    confirm: (params) => request("ui.confirm", params, interactionTimeout),
    openPage: (target) => request("navigation.open", { target }, interactionTimeout),
    requestFullscreen: () =>
      request("fullscreen.request", {}, interactionTimeout),
    close: () => request("runtime.close"),
    requestShake: () => request("motion.requestShake", {}, interactionTimeout),
    getSave: () => enqueue(() => request("storage.get")),
    setSave: (value) => enqueue(() => request("storage.set", { value })),
    removeSave: () => enqueue(() => request("storage.remove")),
    updateSave: (update) =>
      enqueue(async () => {
        const value = await update(await request("storage.get"));
        await request("storage.set", { value });
        return value;
      }),
    on(event, listener) {
      if (
        ![
          "pause",
          "resume",
          "show",
          "hide",
          "themechange",
          "resize",
          "shake",
        ].includes(event)
      )
        throw new Error("未知生命周期事件");
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
    destroy() {
      closed = true;
      cleanupHandshake();
      rejectReady(new Error("SDK 已关闭"));
      port?.close();
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("SDK 已关闭"));
      }
      pending.clear();
      listeners.clear();
    },
  };
}

/** Explicit top-level development adapter; never available inside a hosted iframe. */
export function createLocalPreviewSDK({
  appId,
  name = "本地预览",
  type = "game",
  version = "1.0.0",
  game,
} = {}) {
  if (window.parent !== window) throw new Error("本地预览仅限独立页面");
  if (!appId) throw new Error("本地预览需要 appId");
  const key = `cpu-workshop-preview:${appId}`;
  let writes = Promise.resolve();
  const enqueue = (operation) => {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  };
  const read = () => JSON.parse(localStorage.getItem(key) || "null");
  const write = (value) => {
    localStorage.setItem(key, JSON.stringify(value));
    return null;
  };
  return {
    ready: Promise.resolve({ appId }),
    getEnvironment: async () => ({
      name,
      type,
      version,
      theme: matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
      locale: "zh-CN",
      storageAvailable: true,
      slot: "page",
      viewport: {
        width: window.innerWidth || 0,
        height: window.innerHeight || 0,
      },
      capabilities: ["storage"],
      motionSupported: false,
      game,
    }),
    getSiteInfo: unsupportedPreview,
    listWorks: unsupportedPreview,
    showToast: unsupportedPreview,
    confirm: unsupportedPreview,
    openPage: unsupportedPreview,
    requestFullscreen: unsupportedPreview,
    close: unsupportedPreview,
    requestShake: unsupportedPreview,
    getSave: () => enqueue(read),
    setSave: (value) => enqueue(() => write(value)),
    removeSave: () =>
      enqueue(() => {
        localStorage.removeItem(key);
        return null;
      }),
    updateSave: (update) =>
      enqueue(async () => {
        const value = await update(read());
        write(value);
        return value;
      }),
    on: () => () => {},
    destroy() {},
  };
}

function unsupportedPreview() {
  return Promise.reject(
    Object.assign(new Error("本地预览不支持此宿主能力"), {
      code: "UNSUPPORTED",
    }),
  );
}
