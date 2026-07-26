import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, net, powerMonitor, session, shell, Tray } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FetchTextResult, isHostAllowed, parseHttpsUrl, UserScript } from "./shared";
import { asInjectableUrl, asNavigableUrl, asSiteUrl, createAuthNavigationRule, scriptMatchesUrl } from "./policy";
import { abortOAuthLogin, AuthorizeOpener, getOAuthStatus, logoutOAuth, startOAuthLogin } from "./oauth";
import { readOAuthSession } from "./oauth-store";
import { applyLaunchOnLogin, readPreferences, writePreferences } from "./preferences";
import { buildScriptConfig } from "./script-config";
import { CampusNetService, CampusState } from "./campus-net/service";
import { onCampusLog, pruneCampusLogs, readCampusLogs } from "./campus-net/log";
import { checkForUpdate, notifyUpdate, openUpdateDownload } from "./updater";
import { branding, injectableHosts, learningUrl, limits, oauthConfig } from "./config";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let siteLoaded = false;
let closeToTray = true;
let campusNet: CampusNetService | undefined;
const learningWindows = new Set<BrowserWindow>();

// 一次性授权票据：主进程在注入脚本时下发 nonce，脚本每次调用特权桥都要带上。
// 页面导航或窗口销毁即回收，避免票据长期有效。
type ScriptGrant = { scriptId: string; webContentsId: number };
const grants = new Map<string, ScriptGrant>();

// 按 webContents 的临时导航放行规则。目前只有 OAuth 授权窗口用到：
// 它需要访问本机回环回调地址，那个地址不在任何站点白名单里。
const navigationOverrides = new Map<number, (url: string) => boolean>();

// 脚本回传的运行状态。脚本自己的面板只留 20 条日志且关掉面板就看不见，
// 这里存一份好让客户端界面显示。
type ScriptActivity = { at: number; kind: "status" | "log"; text: string };
const scriptActivity: ScriptActivity[] = [];
let latestScriptStatus = "";

const recordScriptActivity = (entry: ScriptActivity): void => {
  scriptActivity.push(entry);
  if (scriptActivity.length > 200) scriptActivity.splice(0, scriptActivity.length - 200);
  if (entry.kind === "status") latestScriptStatus = entry.text;
  broadcast("script:activity", entry);
};

const resolveAsset = (...segments: string[]): string => path.join(app.getAppPath(), ...segments);

// 状态推送只发给主窗口：学习平台窗口是第三方页面，不该收到应用内部事件。
const broadcast = (channel: string, payload: unknown): void => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

const revokeGrants = (webContentsId: number): void => {
  for (const [nonce, grant] of grants) if (grant.webContentsId === webContentsId) grants.delete(nonce);
};

/* ------------------------------------------------------------------ 地址策略 */
// 判定逻辑全部在 electron/policy.ts，这里只负责按判定结果分流。

const openExternally = (value: string): void => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") void shell.openExternal(url.href);
  } catch {
    // 非法地址直接丢弃，不做任何处理
  }
};

// 主站链接留在主窗口，学习平台开独立窗口，其余交给系统浏览器。
const routeUrl = (value: string): void => {
  if (asSiteUrl(value)) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      void mainWindow.loadURL(value);
      return;
    }
  }
  const target = asNavigableUrl(value);
  if (target) void openLearningWindow(target.href);
  else openExternally(value);
};

/* --------------------------------------------------------------- 用户脚本 */

const parseUserScript = (source: string): Omit<UserScript, "id" | "values"> => {
  const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
  if (!header) throw new Error("未找到有效的 UserScript 元数据头");
  const entries = [...header[1].matchAll(/^\s*\/\/\s*@([\w-]+)\s+(.+?)\s*$/gm)];
  const values = (name: string): string[] => entries.filter((entry) => entry[1] === name).map((entry) => entry[2].trim());
  const matches = values("match");
  if (matches.length === 0) throw new Error("用户脚本必须声明至少一个 @match 规则");
  return {
    name: values("name")[0] ?? "未命名用户脚本",
    source,
    matches,
    requires: values("require"),
    resources: Object.fromEntries(values("resource").map((value) => value.split(/\s+/, 2)).filter(([name, url]) => name && url)),
    connects: values("connect")
  };
};

let scriptCache: Promise<UserScript[]> | undefined;

const loadBuiltInScripts = async (): Promise<UserScript[]> => {
  const filePath = resolveAsset("assets", "userscripts", "monkey.js");
  try {
    const source = await readFile(filePath, "utf8");
    return [{ ...parseUserScript(source), id: "builtin-chaoxing-helper", values: {} }];
  } catch (error) {
    // 静默失败会表现为"界面正常但脚本毫无动静"，必须留下痕迹
    console.error(`内置用户脚本加载失败：${filePath}`, error);
    return [];
  }
};

const getScripts = (): Promise<UserScript[]> => (scriptCache ??= loadBuiltInScripts());

// @require / @resource 依赖优先走随包分发的本地副本，避免每次启动都从 CDN 取
// 可执行代码（校园网不通即不可用，且 CDN 被投毒等于在超星会话里执行任意代码）。
// 用 npm run vendor:deps 生成。
const vendoredDependency = async (url: string): Promise<string | undefined> => {
  const name = `${createHash("sha256").update(url).digest("hex").slice(0, 40)}.txt`;
  try {
    return await readFile(resolveAsset("assets", "vendor", name), "utf8");
  } catch {
    return undefined;
  }
};

const createInjection = (script: UserScript, nonce: string, seededValues: Record<string, unknown>): string => `(() => {
  const definition = ${JSON.stringify(script)};
  const nonce = ${JSON.stringify(nonce)};
  const storagePrefix = ${JSON.stringify(`${branding.storagePrefix}:${script.id}:`)};
  const scriptHandler = ${JSON.stringify(branding.productName)};
  // 客户端下发的脚本配置。脚本自带的配置面板被隐藏了，用户只能从客户端界面改，
  // 所以这里的值必须优先于页面 localStorage 里可能残留的旧值。
  const seeded = ${JSON.stringify(seededValues)};
  const bridge = window.cpuDesktopBridge;
  if (!bridge) { console.error("脚本桥接未注入，用户脚本无法运行"); return; }
  const resourceTexts = new Map();
  const decodeBase64 = (data) => new TextDecoder().decode(Uint8Array.from(atob(data), (character) => character.charCodeAt(0)));
  const loadText = async (url) => {
    if (url.startsWith("data:")) {
      const separator = url.indexOf(",");
      if (separator < 0) throw new Error("无效的 data: 依赖");
      const metadata = url.slice(0, separator);
      const data = url.slice(separator + 1);
      return metadata.includes(";base64") ? decodeBase64(data) : decodeURIComponent(data);
    }
    const response = await bridge.fetchText(nonce, url);
    if (response.status < 200 || response.status >= 300) throw new Error("加载依赖失败: " + response.status);
    return response.text;
  };
  const loadDependencies = async () => {
    for (const url of definition.requires) (0, eval)(await loadText(url));
    for (const [name, url] of Object.entries(definition.resources)) resourceTexts.set(name, await loadText(url));
    return definition.requires.some((url) => /(?:^|[/.])jquery(?:[/.@-]|$)/i.test(url)) && window.jQuery?.noConflict ? window.jQuery.noConflict(true) : undefined;
  };
  const gm = {
    GM_addStyle: (css) => { const style = document.createElement("style"); style.textContent = String(css); document.head.append(style); return style; },
    GM_getResourceText: (name) => resourceTexts.get(name) ?? "",
    // 客户端下发的值优先；没下发过的键才回落到页面 localStorage。
    GM_getValue: (key, fallback) => {
      if (Object.prototype.hasOwnProperty.call(seeded, key)) return seeded[key];
      try {
        const value = localStorage.getItem(storagePrefix + key);
        return value === null ? fallback : JSON.parse(value);
      } catch {
        return fallback;
      }
    },
    // 脚本是同步调用它的，紧接着可能就 GM_getValue 读回来，所以必须先同步写内存副本，
    // 持久化再异步回传给主进程。
    GM_setValue: (key, value) => {
      seeded[key] = value;
      try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); } catch { /* 存不下不影响本次运行 */ }
      try { bridge.setValue(nonce, key, JSON.stringify(value)); } catch (error) { console.error("配置回传失败", error); }
    },
    GM_info: { script: { name: definition.name, matches: definition.matches }, scriptHandler },
    GM_xmlhttpRequest: (details) => {
      // 失败必须走回调：脚本大量使用 new Promise(resolve => GM_xmlhttpRequest({ onload: resolve }))，
      // 只 throw 不回调会让外层 await 永久悬挂。
      const settle = (message) => {
        const result = { readyState: 4, status: 0, statusText: message, responseText: "", response: "", responseHeaders: "", finalUrl: (details && details.url) || "", error: message };
        const timedOut = /超时|timed?\\s?out/i.test(message);
        if (timedOut && details && details.ontimeout) details.ontimeout(result);
        else if (details && details.onerror) details.onerror(result);
        if (details && details.onloadend) details.onloadend(result);
        return result;
      };
      if (!details || !details.url) return Promise.resolve(settle("缺少请求地址"));
      return bridge.fetchText(nonce, details.url, { method: details.method, headers: details.headers, body: details.data, responseType: details.responseType, timeout: details.timeout })
        .then((response) => {
          const result = { readyState: 4, status: response.status, statusText: response.statusText, responseText: response.text, response: response.text, responseHeaders: response.responseHeaders || "", finalUrl: response.url };
          if (details.onload) details.onload(result);
          if (details.onloadend) details.onloadend(result);
          return result;
        })
        .catch((error) => settle(error instanceof Error ? error.message : String(error)));
    },
    GM_cpuAIRequest: async (body) => bridge.requestAi(nonce, JSON.stringify(body)),
    // 脚本把运行状态喊出来，客户端界面才能显示。脚本自己的面板只留 20 条日志，
    // 而且关掉面板就什么都看不见。
    GM_cpuReport: (kind, text) => {
      try { bridge.report(nonce, JSON.stringify({ kind, text: String(text ?? "") })); } catch { /* 上报失败不影响刷课 */ }
    },
    unsafeWindow: window
  };
  loadDependencies()
    .then((privateJQuery) => Function(...Object.keys(gm), "jQuery", "$", definition.source)(...Object.values(gm), privateJQuery, privateJQuery))
    .catch((error) => console.error("用户脚本加载失败: " + definition.name, error));
})()`;

const injectMatchingScripts = (page: BrowserWindow): void => {
  page.webContents.on("did-finish-load", () => {
    void (async () => {
      const contents = page.webContents;
      if (contents.isDestroyed()) return;
      const currentUrl = contents.getURL();
      // 上一页发放的票据在这里作废
      revokeGrants(contents.id);
      // 配置必须在注入前就绪：脚本在构造时对配置做快照，之后再改对一半的项无效
      const { scriptConfig } = await readPreferences();
      const seeded = { config: buildScriptConfig(scriptConfig) };
      for (const script of await getScripts()) {
        if (!scriptMatchesUrl(script, currentUrl)) continue;
        const nonce = randomBytes(32).toString("base64url");
        grants.set(nonce, { scriptId: script.id, webContentsId: contents.id });
        try {
          await contents.executeJavaScript(createInjection(script, nonce, seeded), false);
        } catch (error) {
          grants.delete(nonce);
          console.error(`用户脚本注入失败：${script.name}`, error);
        }
      }
    })();
  });
};

/* ------------------------------------------------------------ 特权桥校验 */

const senderFrameUrl = (event: Electron.IpcMainInvokeEvent): string | undefined => {
  try {
    return event.senderFrame?.url || undefined;
  } catch {
    // frame 已销毁时读取会抛错
    return undefined;
  }
};

// 光有 nonce 不算授权：还要确认发起调用的 frame 此刻确实停在脚本声明的
// @match 范围内，否则超星页面里的第三方 iframe（广告/统计）也能借道。
const authorize = async (event: Electron.IpcMainInvokeEvent, nonce: unknown): Promise<UserScript> => {
  if (typeof nonce !== "string" || nonce.length < 16) throw new Error("脚本桥接令牌无效");
  const grant = grants.get(nonce);
  if (!grant || grant.webContentsId !== event.sender.id) throw new Error("脚本桥接令牌无效");
  const script = (await getScripts()).find((item) => item.id === grant.scriptId);
  if (!script) throw new Error("用户脚本不存在");
  const frameUrl = senderFrameUrl(event);
  if (!frameUrl || !scriptMatchesUrl(script, frameUrl)) throw new Error("调用来源不在允许范围内");
  return script;
};

/* --------------------------------------------------------------- HTTP 代理 */

const ALLOWED_METHODS = new Set(["GET", "POST"]);
// 白名单而非黑名单：不允许脚本自造 Cookie / Authorization / Origin / Referer。
const ALLOWED_REQUEST_HEADERS = new Set(["accept", "accept-language", "content-type", "user-agent", "x-requested-with"]);

const sanitizeHeaders = (input: unknown): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (!input || typeof input !== "object") return headers;
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== "string" || /[\r\n]/.test(value)) continue;
    if (!ALLOWED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  return headers;
};

type ProxyResponse = { status: number; statusText: string; headers: Record<string, string | string[]>; url: string; body: Buffer };

const requestWithPolicy = (
  targetSession: Electron.Session,
  target: URL,
  isAllowed: (url: URL) => boolean,
  options: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number; withCookies: boolean }
): Promise<ProxyResponse> => new Promise((resolve, reject) => {
  const request = net.request({
    method: options.method,
    url: target.href,
    session: targetSession,
    useSessionCookies: options.withCookies,
    redirect: "manual"
  });
  let finalUrl = target.href;
  let hops = 0;
  let received = 0;
  let settled = false;
  const chunks: Buffer[] = [];

  const timer = setTimeout(() => fail(new Error("请求超时")), options.timeoutMs);
  function fail(error: Error): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { request.abort(); } catch { /* 已结束的请求忽略 */ }
    reject(error);
  }
  const succeed = (value: ProxyResponse): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(value);
  };

  // 每一跳都重新校验：白名单域一次 302 就能把请求带到任意地址。
  request.on("redirect", (_status, _method, redirectUrl) => {
    hops += 1;
    if (hops > limits.redirectHops) return fail(new Error("重定向次数过多"));
    const next = parseHttpsUrl(redirectUrl);
    if (!next || !isAllowed(next)) return fail(new Error("请求被重定向到未授权的地址"));
    finalUrl = next.href;
    request.followRedirect();
  });
  request.on("response", (response) => {
    response.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > limits.fetchMaxBytes) return fail(new Error("响应内容超过大小上限"));
      chunks.push(chunk);
    });
    response.on("end", () => succeed({
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: response.headers,
      url: finalUrl,
      body: Buffer.concat(chunks)
    }));
    response.on("error", (error: Error) => fail(error));
  });
  request.on("error", (error) => fail(error));

  for (const [name, value] of Object.entries(options.headers)) request.setHeader(name, value);
  if (options.body !== undefined) request.write(options.body);
  request.end();
});

const formatHeaders = (headers: Record<string, string | string[]>): string => Object.entries(headers)
  .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
  .join("\r\n");

/* ----------------------------------------------------------------- 窗口 */

const enableClipboardMenu = (window: BrowserWindow): void => {
  window.webContents.on("context-menu", (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.selectionText) items.push({ role: "copy", label: "复制" });
    if (params.isEditable) items.push({ role: "cut", label: "剪切" }, { role: "paste", label: "粘贴" });
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window });
  });
};

const trackWindow = (window: BrowserWindow, onClosed: () => void): void => {
  window.on("close", () => {
    if (!window.isDestroyed()) window.destroy();
  });
  window.once("closed", onClosed);
};

async function openLearningWindow(url: string): Promise<void> {
  const target = asNavigableUrl(url);
  if (!target) {
    openExternally(url);
    return;
  }
  const page = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: branding.learningTitle,
    webPreferences: {
      preload: path.join(__dirname, "learning-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });
  learningWindows.add(page);
  trackWindow(page, () => {
    learningWindows.delete(page);
  });
  enableClipboardMenu(page);
  injectMatchingScripts(page);
  await page.loadURL(target.href);
}

// 主窗口就是主站本身。加载不出来（没联网、校园网未认证、站点故障）时
// 落到本地启动台 —— 校园网登录恰恰要在主站不可达的时候用。
const loadSiteOrLauncher = async (window: BrowserWindow, reason?: string): Promise<void> => {
  try {
    await window.loadURL(oauthConfig.origin);
    siteLoaded = true;
  } catch (error) {
    siteLoaded = false;
    const detail = reason || (error instanceof Error ? error.message : String(error));
    console.error(`主站加载失败，回退到本地启动台：${detail}`);
    await window.loadFile(resolveAsset("src", "launcher", "index.html"), { query: { reason: detail } });
  }
};

const openMainWindow = async (options: { show?: boolean } = {}): Promise<void> => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: branding.windowTitle,
    backgroundColor: "#f8fafc",
    show: options.show !== false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "site-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      additionalArguments: [`--cpu-desktop-version=${app.getVersion()}`]
    }
  });
  const window = mainWindow;
  window.on("close", (event) => {
    if (quitting || !tray || !closeToTray) return;
    event.preventDefault();
    window.hide();
  });
  window.once("closed", () => {
    mainWindow = undefined;
  });
  enableClipboardMenu(window);
  await loadSiteOrLauncher(window);
};

const openLearningPage = async (): Promise<void> => {
  const auth = await getOAuthStatus();
  if (!auth.loggedIn) throw new Error("请先完成登录");
  await openLearningWindow(learningUrl);
};

// 授权页开在应用内窗口，与主站共用会话：用户在主站已登录的话这里直接过。
const openAuthorizeWindow: AuthorizeOpener = async (authorizeUrl, callbackOrigin) => {
  const window = new BrowserWindow({
    width: 520,
    height: 720,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    title: "授权登录",
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });
  // 回环回调是 http 且不在任何白名单里，只对这一个窗口、这一次登录放行
  navigationOverrides.set(window.webContents.id, createAuthNavigationRule(callbackOrigin));
  let settled = false;
  window.once("closed", () => {
    navigationOverrides.delete(window.webContents.id);
    // 用户手动关窗时要把等待中的登录 Promise 结掉，否则要挂到 5 分钟超时
    if (!settled) abortOAuthLogin();
  });
  await window.loadURL(authorizeUrl);
  return {
    close: () => {
      settled = true;
      if (!window.isDestroyed()) window.destroy();
    }
  };
};

const createTray = (): void => {
  const source = nativeImage.createFromPath(resolveAsset("assets", "tray-icon.png"));
  if (source.isEmpty()) return;
  // 托盘图源是 512×512 的品牌图，直接交给系统会被拉伸得很糊
  const icon = source.resize({ width: 16, height: 16, quality: "best" });
  tray = new Tray(icon);
  refreshTray();
  tray.on("double-click", () => void openMainWindow());
};

// 托盘常驻，所以它得随时反映校园网状态 —— 不然用户看不出后台在干什么
const refreshTray = (state?: CampusState): void => {
  if (!tray) return;
  const campus = state ?? campusNet?.getState();
  const summary = campus && campus.status !== "disabled" ? `校园网：${campus.message}` : "校园网自动连接未启用";
  tray.setToolTip(`${branding.productName}\n${summary}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: summary, enabled: false },
    { type: "separator" },
    { label: "打开药大拾间", click: () => void openMainWindow() },
    { label: "打开学习平台", click: () => void openLearningPage().catch((error) => console.error("打开学习平台失败", error)) },
    {
      label: "立即连接校园网",
      enabled: Boolean(campus?.hasCredential),
      click: () => void campusNet?.loginNow().catch((error) => console.error("校园网登录失败", error))
    },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } }
  ]));
};

const buildApplicationMenu = (): void => {
  const windowSubmenu: Electron.MenuItemConstructorOptions[] = [{ role: "reload", label: "重新加载" }];
  // 开发者工具只在开发期开放：打包版留着它等于给任意页面一个提权入口
  if (!app.isPackaged) windowSubmenu.push({ role: "toggleDevTools", label: "开发者工具" });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "应用", submenu: [{ role: "quit", label: "退出" }] },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    { label: "窗口", submenu: windowSubmenu }
  ]));
};

/* ------------------------------------------------------------- AI 请求体 */

const asText = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new Error(`AI 请求的 ${field} 无效`);
  if (value.length > limits.aiTextLength) throw new Error("AI 请求内容过长");
  return value;
};

const sanitizeContentItem = (raw: unknown): Record<string, unknown> => {
  if (typeof raw === "string") return { type: "input_text", text: asText(raw, "content") };
  if (!raw || typeof raw !== "object") throw new Error("AI 请求内容无效");
  const item = raw as Record<string, unknown>;
  if (item.type === "input_text" || item.type === "output_text") return { type: item.type, text: asText(item.text, "text") };
  if (item.type === "input_image") {
    const imageUrl = asText(item.image_url, "image_url");
    if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(imageUrl) && !/^https:\/\//.test(imageUrl)) throw new Error("AI 请求的图片地址无效");
    return { type: "input_image", image_url: imageUrl, detail: item.detail === "low" || item.detail === "high" ? item.detail : "auto" };
  }
  throw new Error("AI 请求包含不支持的内容类型");
};

// 严格白名单：只放行服务端 /api/oauth/v1/responses 接受的字段，
// 其余一律丢弃，避免脚本借这条通道把任意参数透传给上游。
const sanitizeAiBody = (raw: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI 请求格式无效");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("AI 请求内容无效");
  const body = parsed as Record<string, unknown>;
  if (!Array.isArray(body.input) || body.input.length === 0) throw new Error("AI 请求内容无效");
  if (body.input.length > limits.aiInputItems) throw new Error("AI 请求条目过多");
  const input = body.input.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("AI 请求内容无效");
    const message = entry as Record<string, unknown>;
    if (message.role !== "user" && message.role !== "assistant") throw new Error("AI 请求只接受 user 与 assistant 角色");
    const content = Array.isArray(message.content)
      ? message.content.map(sanitizeContentItem)
      : [sanitizeContentItem(message.content)];
    return { role: message.role, content };
  });
  const sanitized: Record<string, unknown> = { input, stream: false };
  if (typeof body.model === "string" && body.model.length <= 128) sanitized.model = body.model;
  if (typeof body.temperature === "number" && Number.isFinite(body.temperature) && body.temperature >= 0 && body.temperature <= 2) {
    sanitized.temperature = body.temperature;
  }
  return sanitized;
};

/* ------------------------------------------------------------- 生命周期 */

const applyNavigationPolicy = (contents: Electron.WebContents): void => {
  const guard = (event: Electron.Event, url: string): void => {
    // 本地启动台用 file:// 加载，不受站点白名单约束
    if (url.startsWith("file://")) return;
    if (navigationOverrides.get(contents.id)?.(url)) return;
    if (asNavigableUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.setWindowOpenHandler(({ url }) => {
    // 授权窗口里的跳转按自己的规则留在原窗口，不另开
    if (navigationOverrides.get(contents.id)?.(url)) return { action: "allow" };
    routeUrl(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("destroyed", () => revokeGrants(contents.id));
  // 页面加载失败本来是完全静默的，表现为"窗口开着但一片空白"
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) console.error(`页面加载失败：${validatedURL} (${errorCode} ${errorDescription})`);
  });
};

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 窗口收在托盘里且处于最小化时，只 show 是不够的
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isMinimized()) mainWindow.restore();
    void openMainWindow();
  });

  app.on("web-contents-created", (_event, contents) => applyNavigationPolicy(contents));

  app.whenReady().then(async () => {
    buildApplicationMenu();

    // 让主站能识别出这是桌面端，与 CPUWebScheduleApp / CPUWebHarmonyApp 同一套约定
    session.defaultSession.setUserAgent(
      `${session.defaultSession.getUserAgent()} ${branding.userAgentTag}/${app.getVersion()}`
    );

    // 默认拒绝所有权限请求，只放行视频全屏
    const allowPermission = (permission: string): boolean => permission === "fullscreen";
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowPermission(permission)));
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowPermission(permission));

    const preferences = await readPreferences();
    closeToTray = preferences.closeToTray;
    applyLaunchOnLogin(preferences.launchOnLogin, preferences.startMinimized);

    ipcMain.handle("app:info", () => ({
      productName: branding.productName,
      version: app.getVersion(),
      origin: oauthConfig.origin,
      learningUrl,
      siteLoaded,
      platform: process.platform
    }));
    ipcMain.handle("app:get-preferences", () => readPreferences());
    ipcMain.handle("app:set-preferences", async (_event, patch: unknown) => {
      const next = await writePreferences((patch ?? {}) as Record<string, never>);
      closeToTray = next.closeToTray;
      applyLaunchOnLogin(next.launchOnLogin, next.startMinimized);
      return next;
    });
    ipcMain.handle("site:open-external", (_event, url: unknown) => {
      if (typeof url === "string") openExternally(url);
    });
    ipcMain.handle("site:copy-text", (_event, text: unknown) => {
      if (typeof text === "string") clipboard.writeText(text);
    });
    ipcMain.handle("app:check-update", async () => {
      const info = await checkForUpdate();
      if (info.hasUpdate) broadcast("app:update-available", info);
      return info;
    });
    ipcMain.handle("app:open-update", (_event, url: unknown) => {
      if (typeof url === "string") openUpdateDownload(url);
    });
    ipcMain.handle("site:reload", async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return { siteLoaded: false };
      await loadSiteOrLauncher(mainWindow);
      return { siteLoaded };
    });

    /* -------------------------------------------------------------- 校园网 */
    // 密码只单向进主进程：campus:state 永不返回密码，只回 hasCredential 与学号。
    const service = new CampusNetService(preferences.campusNet);
    campusNet = service;
    service.onChange((state) => {
      broadcast("campus:state-changed", state);
      refreshTray(state);
    });
    onCampusLog((entry) => broadcast("campus:log", entry));

    ipcMain.handle("campus:state", () => service.getState());
    ipcMain.handle("campus:settings", () => readPreferences().then((value) => value.campusNet));
    ipcMain.handle("campus:save-credential", (_event, studentId: unknown, password: unknown) =>
      service.saveCredential(studentId, password));
    ipcMain.handle("campus:clear-credential", () => service.clearCredential());
    ipcMain.handle("campus:update-settings", async (_event, patch: unknown) => {
      const saved = await writePreferences({ campusNet: (patch ?? {}) as never });
      service.updateSettings(saved.campusNet);
      return saved.campusNet;
    });
    ipcMain.handle("campus:login-now", () => service.loginNow());
    ipcMain.handle("campus:check-now", () => service.checkNow());
    ipcMain.handle("campus:logs", (_event, limit: unknown) =>
      readCampusLogs(typeof limit === "number" ? limit : 200));

    void pruneCampusLogs();
    await service.start();

    // 合盖唤醒、锁屏解锁之后立刻探一次，不干等下一个轮询周期
    const checkNow = (): void => void service.checkNow();
    powerMonitor.on("resume", checkNow);
    powerMonitor.on("unlock-screen", checkNow);

    ipcMain.handle("userscript:fetch-text", async (event, nonce: unknown, url: unknown, options?: unknown): Promise<FetchTextResult> => {
      const script = await authorize(event, nonce);
      if (typeof url !== "string") throw new Error("请求地址无效");
      const target = parseHttpsUrl(url);
      if (!target) throw new Error("只允许 https 请求");

      const dependencies = [...script.requires, ...Object.values(script.resources)];
      const isDependency = dependencies.includes(url);
      if (isDependency) {
        const vendored = await vendoredDependency(url);
        if (vendored !== undefined) return { status: 200, statusText: "OK", text: vendored, responseHeaders: "", url };
      }

      // @connect 通配不再被接受：脚本必须逐条声明它要访问的域名
      const declared = script.connects.filter((rule) => rule !== "*");
      const connectAllowed = (candidate: URL): boolean => isHostAllowed(candidate.hostname, declared);
      const isAllowed = (candidate: URL): boolean => connectAllowed(candidate) || dependencies.includes(candidate.href);
      if (!isAllowed(target)) throw new Error("请求地址未在用户脚本元数据中声明");

      const settings = (options ?? {}) as { method?: unknown; headers?: unknown; body?: unknown; responseType?: unknown; timeout?: unknown };
      const method = typeof settings.method === "string" ? settings.method.toUpperCase() : "GET";
      if (!ALLOWED_METHODS.has(method)) throw new Error("不支持的请求方法");
      const timeoutMs = typeof settings.timeout === "number" && settings.timeout > 0
        ? Math.min(settings.timeout, limits.fetchTimeoutMs)
        : limits.fetchTimeoutMs;

      // 只有脚本注入范围内的站点（超星系）才带会话 Cookie；
      // 第三方题库接口一律匿名请求，不携带任何身份。
      const withCookies = isHostAllowed(target.hostname, injectableHosts);

      const response = await requestWithPolicy(event.sender.session, target, isAllowed, {
        method,
        headers: sanitizeHeaders(settings.headers),
        body: typeof settings.body === "string" ? settings.body : undefined,
        timeoutMs,
        withCookies
      });

      const text = settings.responseType === "arraybuffer"
        ? response.body.toString("base64")
        : response.body.toString("utf8");
      return {
        status: response.status,
        statusText: response.statusText,
        text,
        responseHeaders: formatHeaders(response.headers),
        url: response.url
      };
    });

    ipcMain.handle("userscript:set-value", async (event, nonce: unknown, key: unknown, json: unknown) => {
      await authorize(event, nonce);
      if (typeof key !== "string" || !key || key.length > 64) throw new Error("配置键无效");
      if (typeof json !== "string" || json.length > 64 * 1024) throw new Error("配置内容无效");
      let value: unknown;
      try {
        value = JSON.parse(json);
      } catch {
        throw new Error("配置内容无法解析");
      }
      const saved = await writePreferences({ scriptConfig: { [key]: value } });
      broadcast("script:config-changed", saved.scriptConfig);
    });

    ipcMain.handle("userscript:report", async (event, nonce: unknown, payload: unknown) => {
      await authorize(event, nonce);
      if (typeof payload !== "string" || payload.length > 8192) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      // 页面里的内容不可信，只放行已知形状，再转给渲染进程显示
      const entry = (parsed ?? {}) as { kind?: unknown; text?: unknown };
      const kind = entry.kind === "status" ? "status" : "log";
      const text = typeof entry.text === "string" ? entry.text.slice(0, 500) : "";
      if (!text) return;
      recordScriptActivity({ at: Date.now(), kind, text });
    });

    ipcMain.handle("script:get-config", () => readPreferences().then((value) => value.scriptConfig));
    ipcMain.handle("script:set-config", async (_event, patch: unknown) => {
      const saved = await writePreferences({ scriptConfig: (patch ?? {}) as Record<string, unknown> });
      broadcast("script:config-changed", saved.scriptConfig);
      return saved.scriptConfig;
    });
    ipcMain.handle("script:get-activity", (_event, limit: unknown) => ({
      status: latestScriptStatus,
      running: learningWindows.size > 0,
      entries: scriptActivity.slice(-(typeof limit === "number" ? Math.min(Math.max(limit, 1), 200) : 80))
    }));

    ipcMain.handle("userscript:request-ai", async (event, nonce: unknown, body: unknown) => {
      await authorize(event, nonce);
      if (typeof body !== "string") throw new Error("AI 请求格式无效");
      const session = await readOAuthSession();
      if (!session) throw new Error("请先完成 OAuth2 登录");
      const payload = sanitizeAiBody(body);
      const response = await fetch(`${oauthConfig.origin}/api/oauth/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `${session.tokenType} ${session.accessToken}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000)
      });
      return { status: response.status, statusText: response.statusText, text: await response.text() };
    });

    ipcMain.handle("oauth:login", () => startOAuthLogin(openAuthorizeWindow).then((session) => ({
      loggedIn: true,
      expiresAt: session.expiresAt,
      scope: session.scope,
      user: session.user
    })));
    ipcMain.handle("oauth:status", () => getOAuthStatus());
    ipcMain.handle("oauth:logout", async () => {
      await logoutOAuth();
      for (const window of [...learningWindows]) if (!window.isDestroyed()) window.destroy();
      grants.clear();
    });
    ipcMain.handle("learning:open", () => openLearningPage());

    createTray();
    // 开机自启且勾了静默启动时，只把托盘挂上，不弹窗
    const silentStart = preferences.startMinimized && process.argv.includes("--startup") && tray !== undefined;
    await openMainWindow({ show: !silentStart });
    const scripts = await getScripts();
    console.log(
      `${branding.productName} v${app.getVersion()} 已启动 · 主站 ${oauthConfig.origin}`
      + ` · ${siteLoaded ? "主站已加载" : "主站不可达，已回退启动台"}`
      + ` · 已载入 ${scripts.length} 个用户脚本`
    );
    app.on("activate", () => void openMainWindow());

    // 启动后延后查一次更新：这批用户不会主动去看有没有新版，
    // 而超星一改版脚本就失效，得让他们知道。
    setTimeout(() => {
      void checkForUpdate().then((info) => {
        if (!info.hasUpdate) return;
        console.log(`发现新版本 v${info.latest}（当前 v${info.current}）`);
        notifyUpdate(info);
        broadcast("app:update-available", info);
      });
    }, 8000).unref?.();
  });

  app.on("before-quit", () => {
    quitting = true;
    campusNet?.stop();
  });

  app.on("window-all-closed", () => {
    // 有托盘时关掉所有窗口只是收起来，不退出
    if (process.platform !== "darwin" && !tray) app.quit();
  });
}
