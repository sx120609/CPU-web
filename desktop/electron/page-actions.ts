import type { WebContents } from "electron";

type PageActionRequest = {
  page?: string;
  property?: string;
  args?: unknown[];
};

type NetworkRecord = {
  url: string;
  method?: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, unknown>;
  body?: string;
  at: number;
};

type Waiter = {
  kind: "request" | "response";
  pattern: string;
  resolve: (value: NetworkRecord) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type PendingResponse = Omit<NetworkRecord, "body"> & { requestId: string };

type Tracker = {
  contents: WebContents;
  ownsDebugger: boolean;
  requests: NetworkRecord[];
  responses: NetworkRecord[];
  pendingResponses: Map<string, PendingResponse>;
  waiters: Set<Waiter>;
  listener: (_event: Electron.Event, method: string, params: Record<string, any>) => void;
};

const MAX_NETWORK_RECORDS = 80;
const WAIT_TIMEOUT_MS = 30_000;
const ALLOWED_ACTIONS = new Set([
  "click", "check", "dblclick", "bringToFront", "dragAndDrop", "fill", "focus", "hover",
  "screenshot", "selectOption", "tap", "press", "reload", "waitForRequest", "waitForResponse",
  "waitForSelector", "keyboard.type", "keyboard.press", "mouse.wheel", "mouse.click", "mouse.dblclick",
  "mouse.down", "mouse.up", "mouse.move",
]);

const trimRecords = (records: NetworkRecord[]): void => {
  if (records.length > MAX_NETWORK_RECORDS) records.splice(0, records.length - MAX_NETWORK_RECORDS);
};

const matchesPattern = (url: string, pattern: string): boolean => url.includes(pattern);

const asString = (value: unknown, limit = 4096): string => typeof value === "string" ? value.slice(0, limit) : "";

const selectorScript = (property: string, args: unknown[]): string => {
  const encoded = JSON.stringify(args);
  return `(() => {
    const args = ${encoded};
    const selector = String(args[0] || "");
    const element = document.querySelector(selector);
    if (!element) return false;
    element.scrollIntoView({ block: "center", inline: "center" });
    const fire = (name) => element.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window }));
    switch (${JSON.stringify(property)}) {
      case "click": element.click(); break;
      case "dblclick": element.click(); element.click(); fire("dblclick"); break;
      case "tap": element.click(); break;
      case "hover": fire("mouseenter"); fire("mouseover"); fire("mousemove"); break;
      case "focus": element.focus(); break;
      case "check": {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "checked")?.set;
        if (setter) setter.call(element, true); else element.checked = true;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
      case "fill": {
        const value = String(args[1] ?? "");
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
        if (setter) setter.call(element, value); else element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
      case "selectOption": {
        const values = Array.isArray(args[1]) ? args[1].map(String) : [String(args[1] ?? "")];
        for (const option of element.options || []) option.selected = values.includes(option.value) || values.includes(option.label);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
      case "press": {
        const key = String(args[1] || "Enter");
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
        break;
      }
    }
    return true;
  })()`;
};

export class LearningPageActions {
  private trackers = new Map<number, Tracker>();

  attach(contents: WebContents): void {
    if (contents.isDestroyed() || this.trackers.has(contents.id)) return;
    const tracker: Tracker = {
      contents,
      ownsDebugger: false,
      requests: [],
      responses: [],
      pendingResponses: new Map(),
      waiters: new Set(),
      listener: () => undefined,
    };
    tracker.listener = (_event, method, params) => this.onDebuggerMessage(tracker, method, params);
    this.trackers.set(contents.id, tracker);
    try {
      if (!contents.debugger.isAttached()) {
        contents.debugger.attach("1.3");
        tracker.ownsDebugger = true;
      }
      contents.debugger.on("message", tracker.listener);
      void contents.debugger.sendCommand("Network.enable").catch((error) => {
        console.warn("启用网课接口监听失败", error);
      });
    } catch (error) {
      console.warn("初始化网课页面控制桥失败", error);
    }
    contents.once("destroyed", () => this.detach(contents.id));
  }

  detach(contentsId: number): void {
    const tracker = this.trackers.get(contentsId);
    if (!tracker) return;
    for (const waiter of tracker.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("网课标签已关闭"));
    }
    try {
      tracker.contents.debugger.removeListener("message", tracker.listener);
      if (tracker.ownsDebugger && tracker.contents.debugger.isAttached()) tracker.contents.debugger.detach();
    } catch { /* 页面销毁时调试器可能已经自动脱离 */ }
    this.trackers.delete(contentsId);
  }

  private resolveWaiters(tracker: Tracker, kind: "request" | "response", record: NetworkRecord): void {
    for (const waiter of [...tracker.waiters]) {
      if (waiter.kind !== kind || !matchesPattern(record.url, waiter.pattern)) continue;
      tracker.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(record);
    }
  }

  private onDebuggerMessage(tracker: Tracker, method: string, params: Record<string, any>): void {
    if (method === "Network.requestWillBeSent") {
      const request = params.request || {};
      const record: NetworkRecord = {
        url: asString(request.url, 16_384),
        method: asString(request.method, 32),
        headers: request.headers || {},
        body: asString(request.postData, 2_000_000),
        at: Date.now(),
      };
      if (!record.url) return;
      tracker.requests.push(record);
      trimRecords(tracker.requests);
      this.resolveWaiters(tracker, "request", record);
      return;
    }
    if (method === "Network.responseReceived") {
      const response = params.response || {};
      const requestId = asString(params.requestId, 256);
      const url = asString(response.url, 16_384);
      if (!requestId || !url) return;
      tracker.pendingResponses.set(requestId, {
        requestId,
        url,
        status: Number(response.status) || 0,
        statusText: asString(response.statusText, 256),
        headers: response.headers || {},
        at: Date.now(),
      });
      return;
    }
    if (method === "Network.loadingFinished") {
      const requestId = asString(params.requestId, 256);
      const pending = tracker.pendingResponses.get(requestId);
      if (!pending) return;
      tracker.pendingResponses.delete(requestId);
      void tracker.contents.debugger.sendCommand("Network.getResponseBody", { requestId }).then((result: any) => {
        const body = result?.base64Encoded
          ? Buffer.from(asString(result.body, 16_000_000), "base64").toString("utf8")
          : asString(result?.body, 16_000_000);
        const record: NetworkRecord = { ...pending, body };
        tracker.responses.push(record);
        trimRecords(tracker.responses);
        this.resolveWaiters(tracker, "response", record);
      }).catch(() => {
        const record: NetworkRecord = { ...pending, body: "" };
        tracker.responses.push(record);
        trimRecords(tracker.responses);
        this.resolveWaiters(tracker, "response", record);
      });
    }
  }

  private waitForNetwork(contents: WebContents, kind: "request" | "response", patternValue: unknown): Promise<NetworkRecord> {
    this.attach(contents);
    const tracker = this.trackers.get(contents.id);
    if (!tracker || !contents.debugger.isAttached()) throw new Error("客户端页面接口监听不可用，请刷新标签后重试");
    const pattern = asString(patternValue, 2048);
    if (!pattern) throw new Error("缺少要等待的接口地址");
    const records = kind === "request" ? tracker.requests : tracker.responses;
    const existing = [...records].reverse().find((record) => matchesPattern(record.url, pattern));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {} as Waiter;
      waiter.kind = kind;
      waiter.pattern = pattern;
      waiter.resolve = resolve;
      waiter.reject = reject;
      waiter.timer = setTimeout(() => {
        tracker.waiters.delete(waiter);
        reject(new Error(`等待接口超时：${pattern}`));
      }, WAIT_TIMEOUT_MS);
      tracker.waiters.add(waiter);
    });
  }

  async perform(contents: WebContents, input: unknown): Promise<unknown> {
    if (!input || typeof input !== "object") throw new Error("页面操作格式无效");
    const request = input as PageActionRequest;
    const property = asString(request.property, 64);
    const args = Array.isArray(request.args) ? request.args.slice(0, 8) : [];
    if (!ALLOWED_ACTIONS.has(property)) throw new Error(`客户端不支持页面操作：${property}`);
    const currentUrl = contents.getURL();
    if (request.page) {
      const expected = new URL(request.page);
      const current = new URL(currentUrl);
      if (expected.origin !== current.origin) throw new Error("页面操作目标与当前标签不一致");
    }
    if (property === "waitForRequest") return this.waitForNetwork(contents, "request", args[0]);
    if (property === "waitForResponse") return this.waitForNetwork(contents, "response", args[0]);
    if (property === "reload") { contents.reload(); return { url: currentUrl }; }
    if (property === "bringToFront") { contents.focus(); return true; }
    if (property === "screenshot") return contents.capturePage().then((image) => image.toDataURL());
    if (property === "keyboard.type") { contents.insertText(asString(args[0], 100_000)); return true; }
    if (property === "keyboard.press") {
      const keyCode = asString(args[0], 64) || "Enter";
      contents.sendInputEvent({ type: "keyDown", keyCode });
      contents.sendInputEvent({ type: "keyUp", keyCode });
      return true;
    }
    if (property.startsWith("mouse.")) {
      const x = Math.round(Number(args[0]) || 0);
      const y = Math.round(Number(args[1]) || 0);
      if (property === "mouse.move") contents.sendInputEvent({ type: "mouseMove", x, y });
      else if (property === "mouse.wheel") contents.sendInputEvent({ type: "mouseWheel", x: 0, y: 0, deltaX: Number(args[0]) || 0, deltaY: Number(args[1]) || 0 });
      else {
        const clickCount = property === "mouse.dblclick" ? 2 : Number((args[2] as any)?.clickCount) || 1;
        const button = ((args[2] as any)?.button || "left") as "left" | "middle" | "right";
        if (property !== "mouse.up") contents.sendInputEvent({ type: "mouseDown", x, y, button, clickCount });
        if (property !== "mouse.down") contents.sendInputEvent({ type: "mouseUp", x, y, button, clickCount });
      }
      return true;
    }
    if (property === "waitForSelector") {
      const selector = asString(args[0], 4096);
      const deadline = Date.now() + Math.min(30_000, Number((args[1] as any)?.timeout) || 30_000);
      while (Date.now() < deadline) {
        if (await contents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, false)) return true;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return false;
    }
    if (property === "dragAndDrop") {
      const [source, target] = args.map((value) => asString(value, 4096));
      return contents.executeJavaScript(`(() => { const a=document.querySelector(${JSON.stringify(source)}); const b=document.querySelector(${JSON.stringify(target)}); if(!a||!b)return false; const d=new DataTransfer(); a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:d})); b.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:d})); a.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:d})); return true; })()`, false);
    }
    return contents.executeJavaScript(selectorScript(property, args), false);
  }
}
