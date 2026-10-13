/** Only this allowlisted bridge crosses from an untrusted work into the site. */
export const WORKSHOP_SAVE_LIMIT = 64 * 1024;
// A catalog contains up to twelve 2,000-character descriptions plus metadata.
const WORKSHOP_RESPONSE_LIMIT = 256 * 1024;

function serializeWorkshopResponse(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("能力响应必须是 JSON 数据");
  if (new TextEncoder().encode(json).length > WORKSHOP_RESPONSE_LIMIT)
    throw new Error("能力响应过大");
  return json;
}

export function serializeWorkshopSave(value: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error("存档必须是 JSON 数据");
  }
  if (json === undefined) throw new Error("存档必须是 JSON 数据");
  if (new TextEncoder().encode(json).length > WORKSHOP_SAVE_LIMIT)
    throw new Error("存档不能超过 64 KB");
  return json;
}

export type WorkshopPageTarget = "workshop" | "games" | "tools";
export interface WorkshopListParams {
  q?: string;
  type?: "game" | "tool" | "extension";
  page?: number;
  pageSize?: number;
}
export interface WorkshopToastParams {
  message: string;
  type?: "info" | "success" | "warning";
}
export interface WorkshopConfirmParams {
  title: string;
  message: string;
}
export interface WorkshopCapabilityResult {
  enabled: boolean;
  reason?: string;
}
export interface WorkshopBridgeHandlers {
  getSiteInfo(): Promise<unknown>;
  listWorks(params: WorkshopListParams): Promise<unknown>;
  toast(params: WorkshopToastParams): void | Promise<void>;
  confirm(params: WorkshopConfirmParams): Promise<{ confirmed: boolean }>;
  navigate(target: WorkshopPageTarget): void | Promise<void>;
  requestFullscreen(): Promise<WorkshopCapabilityResult>;
  close(): void;
  requestShake(): Promise<WorkshopCapabilityResult>;
}
export interface BridgeOptions {
  frame: HTMLIFrameElement;
  appId: string;
  storageAllowed?: boolean;
  permissions?: readonly string[];
  environment: () => Record<string, unknown>;
  storage: {
    get(): Promise<unknown>;
    set(value: unknown): Promise<void>;
    remove(): Promise<void>;
  };
  handlers?: Partial<WorkshopBridgeHandlers>;
  onReady?: () => void;
}
export type WorkshopBridgeEvent =
  "pause" | "resume" | "show" | "hide" | "themechange" | "resize" | "shake";

function paramsObject(
  params: unknown,
  keys: string[],
): Record<string, unknown> {
  if (params === undefined) params = {};
  if (
    !params ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    Object.keys(params).some((key) => !keys.includes(key))
  )
    throw new Error("能力参数不正确");
  return params as Record<string, unknown>;
}
function textParam(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("文本参数不正确");
  return value;
}

export function createWorkshopBridge(options: BridgeOptions) {
  let port: MessagePort | null = null;
  let disposed = false;
  let queued = 0;
  let windowStarted = Date.now();
  let requests = 0;
  let chain = Promise.resolve();

  const uiCalls = new Map<string, number>();
  const allowed = (permission: string) =>
    options.permissions
      ? options.permissions.includes(permission)
      : permission === "storage" && options.storageAllowed;
  function handler<K extends keyof WorkshopBridgeHandlers>(
    key: K,
    permission?: string,
  ): WorkshopBridgeHandlers[K] {
    if (permission && !allowed(permission))
      throw new Error("作品未声明所需权限");
    const fn = options.handlers?.[key];
    if (!fn) throw new Error("当前宿主未开放此能力");
    return fn as WorkshopBridgeHandlers[K];
  }
  function uiLimit(method: string) {
    const now = Date.now();
    const previous = uiCalls.get(method);
    const interval = method === "ui.toast" ? 1000 : 3000;
    if (previous !== undefined && now - previous < interval)
      throw new Error("界面调用过于频繁，请稍后重试");
    uiCalls.set(method, now);
  }
  async function dispatch(method: string, params: unknown) {
    if (method === "env.get") {
      paramsObject(params, []);
      return options.environment();
    }
    if (method.startsWith("storage.")) {
      if (!["storage.get", "storage.set", "storage.remove"].includes(method))
        throw new Error("作品请求了未开放的能力");
      if (!allowed("storage")) throw new Error("作品未声明存档权限");
      const data = paramsObject(
        params,
        method === "storage.set" ? ["value"] : [],
      );
      if (method === "storage.get") return options.storage.get();
      if (method === "storage.remove") {
        await options.storage.remove();
        return null;
      }
      if (!("value" in data)) throw new Error("存档参数不正确");
      await options.storage.set(JSON.parse(serializeWorkshopSave(data.value)));
      return null;
    }
    if (method === "site.getInfo") {
      paramsObject(params, []);
      return handler("getSiteInfo", "site.public")();
    }
    if (method === "site.listWorks") {
      const data = paramsObject(params, ["q", "type", "page", "pageSize"]);
      if (
        data.q !== undefined &&
        (typeof data.q !== "string" || data.q.length > 100)
      )
        throw new Error("搜索参数不正确");
      if (
        data.type !== undefined &&
        !["game", "tool", "extension"].includes(data.type as string)
      )
        throw new Error("作品类型不正确");
      for (const key of ["page", "pageSize"])
        if (
          data[key] !== undefined &&
          (!Number.isSafeInteger(data[key]) ||
            (data[key] as number) < 1 ||
            (data[key] as number) > (key === "pageSize" ? 12 : 10000))
        )
          throw new Error("分页参数不正确");
      return handler("listWorks", "site.public")(data as WorkshopListParams);
    }
    if (method === "ui.toast") {
      const data = paramsObject(params, ["message", "type"]);
      const message = textParam(data.message, 200);
      if (
        data.type !== undefined &&
        !["info", "success", "warning"].includes(data.type as string)
      )
        throw new Error("提示类型不正确");
      const fn = handler("toast", "ui.toast");
      uiLimit(method);
      await fn({
        message,
        type: (data.type ?? "info") as WorkshopToastParams["type"],
      });
      return null;
    }
    if (method === "ui.confirm") {
      const data = paramsObject(params, ["title", "message"]);
      const normalized = {
        title: textParam(data.title, 60),
        message: textParam(data.message, 500),
      };
      const fn = handler("confirm", "ui.confirm");
      uiLimit(method);
      return fn(normalized);
    }
    if (method === "navigation.open") {
      const data = paramsObject(params, ["target"]);
      if (!["workshop", "games", "tools"].includes(data.target as string))
        throw new Error("导航目标不正确");
      const fn = handler("navigate", "navigation");
      uiLimit(method);
      await fn(data.target as WorkshopPageTarget);
      return null;
    }
    if (method === "fullscreen.request" || method === "motion.requestShake") {
      paramsObject(params, []);
      const fn =
        method === "fullscreen.request"
          ? handler("requestFullscreen", "fullscreen")
          : handler("requestShake", "motion.shake");
      uiLimit(method);
      return fn();
    }
    if (method === "runtime.close") {
      paramsObject(params, []);
      handler("close");
      return null;
    }
    throw new Error("作品请求了未开放的能力");
  }

  function connect(event: MessageEvent) {
    if (
      disposed ||
      port ||
      !options.frame.contentWindow ||
      event.source !== options.frame.contentWindow ||
      event.origin !== "null"
    )
      return;
    if (event.data?.type !== "cpu-workshop:ready" || event.data.protocol !== 1)
      return;
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = (message) => {
      const data = message.data;
      if (
        disposed ||
        data?.type !== "request" ||
        typeof data.id !== "string" ||
        data.id.length > 80 ||
        typeof data.method !== "string"
      )
        return;
      if (Date.now() - windowStarted > 1000) {
        requests = 0;
        windowStarted = Date.now();
      }
      if (++requests > 30 || queued >= 8) {
        port?.postMessage({
          type: "response",
          id: data.id,
          error: { code: "RATE_LIMIT", message: "调用过于频繁，请稍后重试" },
        });
        return;
      }
      queued += 1;
      // Keep writes ordered, including a read immediately following a save.
      chain = chain.then(async () => {
        if (disposed) return;
        try {
          const result = await dispatch(data.method, data.params);
          // Vue-backed metadata may contain proxies, which structured clone cannot transfer.
          const plainResult =
            result === undefined
              ? null
              : JSON.parse(serializeWorkshopResponse(result));
          if (!disposed) {
            port?.postMessage({
              type: "response",
              id: data.id,
              result: plainResult,
            });
            if (data.method === "runtime.close")
              setTimeout(() => {
                if (!disposed) options.handlers?.close?.();
              }, 0);
          }
        } catch (error) {
          if (!disposed)
            port?.postMessage({
              type: "response",
              id: data.id,
              error: {
                code: "REQUEST_FAILED",
                message: error instanceof Error ? error.message : "操作失败",
              },
            });
        } finally {
          queued -= 1;
        }
      });
    };
    options.frame.contentWindow.postMessage(
      { type: "cpu-workshop:connect", protocol: 1, appId: options.appId },
      "*",
      [channel.port2],
    );
    options.onReady?.();
  }

  window.addEventListener("message", connect);
  return {
    notify(
      event: WorkshopBridgeEvent,
      dataOrReason: string | Record<string, unknown> = {},
    ) {
      if (disposed) return;
      let data: Record<string, unknown>;
      if (event === "pause" || event === "resume")
        data =
          typeof dataOrReason === "string"
            ? { reason: dataOrReason }
            : paramsObject(dataOrReason, ["reason"]);
      else if (event === "themechange") {
        data = paramsObject(dataOrReason, ["theme"]);
        if (data.theme !== "light" && data.theme !== "dark")
          throw new Error("主题参数不正确");
      } else if (event === "resize") {
        data = paramsObject(dataOrReason, ["width", "height"]);
        if (
          ![data.width, data.height].every(
            (value) =>
              typeof value === "number" && Number.isFinite(value) && value >= 0,
          )
        )
          throw new Error("视口参数不正确");
      } else if (["show", "hide", "shake"].includes(event)) data = {};
      else throw new Error("未知生命周期事件");
      port?.postMessage({ type: "event", event, data });
    },
    dispose() {
      disposed = true;
      window.removeEventListener("message", connect);
      port?.close();
      port = null;
    },
  };
}
