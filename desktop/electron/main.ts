import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, net, Notification, powerMonitor, session, shell, Tray } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FetchTextResult, isHostAllowed, parseHttpsUrl, parseWebUrl, UserScript } from "./shared";
import { asInjectableUrl, asNavigableUrl, asSiteUrl, createAuthNavigationRule, scriptMatchesUrl } from "./policy";
import { abortOAuthLogin, AuthorizeOpener, ensureOAuthSession, getOAuthStatus, logoutOAuth, OAuthStatus, startOAuthLogin } from "./oauth";
import { readOAuthSession } from "./oauth-store";
import { applyLaunchOnLogin, readPreferences, writePreferences } from "./preferences";
import { buildScriptConfig } from "./script-config";
import { CampusNetService, CampusState } from "./campus-net/service";
import { clearChaoxingCredential, maskChaoxingAccount, readChaoxingCredential, writeChaoxingCredential } from "./chaoxing-credentials";
import { onCampusLog, pruneCampusLogs, readCampusLogs } from "./campus-net/log";
import { checkForUpdate, openUpdateDownload } from "./updater";
import { checkAndDownload, getUpdateState, hasPendingUpdate, onUpdateState, runPendingUpdate, UpdateState } from "./auto-update";
import { CHROME_HEIGHT, TabKind, TabManager } from "./tabs";
import { isInstallLaunch, openInstallerWindow, runUninstall, sweepReplacedFiles } from "./self-install";
import { branding, chaoxingLoginHost, injectableHosts, learningUrl, limits, oauthConfig } from "./config";
import {
  checkUserScriptUpdate,
  readCachedUserScript,
  USER_SCRIPT_CHECK_INTERVAL_MS,
  UserScriptUpdateResult,
} from "./userscript-update";
import { flushPersistentSession } from "./session-persistence";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let exitPreparationStarted = false;
let siteLoaded = false;
let closeToTray = true;
let campusNet: CampusNetService | undefined;
let tabs: TabManager | undefined;
let siteError = "";
const supportsAutomaticInstallerUpdates = process.platform === "win32";

const flushBrowserSession = async (): Promise<void> => {
  try {
    await flushPersistentSession(session.defaultSession);
  } catch (error) {
    // 落盘失败不应把用户困在应用里，但必须留下证据，便于定位系统级存储异常。
    console.error("保存网站登录状态失败：", error);
  }
};

// 一次性授权票据：主进程在注入脚本时下发 nonce，脚本每次调用特权桥都要带上。
// 页面导航或窗口销毁即回收，避免票据长期有效。
type ScriptGrant = { scriptId: string; webContentsId: number };
const grants = new Map<string, ScriptGrant>();

// 按 webContents 的临时导航放行规则。目前只有 OAuth 授权窗口用到：
// 它需要访问本机回环回调地址，那个地址不在任何站点白名单里。
const navigationOverrides = new Map<number, (url: string) => boolean>();

// 每个内容视图属于哪种标签。导航策略要按这个区分：学习通标签里页面自身的跳转
// 不能拦（超星登录会连跳好几个白名单外的域名），主站标签则必须锁在白名单内。
const contentsKind = new Map<number, TabKind>();

// 脚本回传的运行状态。脚本自己的面板只留 20 条日志且关掉面板就看不见，
// 这里存一份好让客户端界面显示。
type ScriptActivity = { at: number; kind: "status" | "log"; text: string };
const scriptActivity: ScriptActivity[] = [];
let latestScriptStatus = "";
type ScriptUpdateState = {
  stage: "loading" | "checking" | "current" | "updated" | "error";
  activeVersion: string;
  source: "builtin" | "cache" | "cloud";
  checkedAt?: number;
  message: string;
};
let scriptUpdateState: ScriptUpdateState = {
  stage: "loading",
  activeVersion: "",
  source: "builtin",
  message: "正在载入学习通助手脚本",
};

const recordScriptActivity = (entry: ScriptActivity): void => {
  scriptActivity.push(entry);
  if (scriptActivity.length > 200) scriptActivity.splice(0, scriptActivity.length - 200);
  if (entry.kind === "status") latestScriptStatus = entry.text;
  broadcast("script:activity", entry);
};

const resolveAsset = (...segments: string[]): string => path.join(app.getAppPath(), ...segments);

// 状态推送只发给主窗口：学习通窗口是第三方页面，不该收到应用内部事件。
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

// 主站链接留在主窗口，其余网页地址一律开成应用内标签。
const routeUrl = (value: string): void => {
  if (asSiteUrl(value)) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      void mainWindow.loadURL(value);
      return;
    }
  }
  if (parseWebUrl(value)) void tabs?.openLearningTab(value, { trusted: true });
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
    version: values("version")[0] ?? "0.0.0",
    source,
    matches,
    requires: values("require"),
    resources: Object.fromEntries(values("resource").map((value) => value.split(/\s+/, 2)).filter(([name, url]) => name && url)),
    connects: values("connect")
  };
};

let scriptCache: Promise<UserScript[]> | undefined;
const userScriptCacheDirectory = () => path.join(app.getPath("userData"), "userscripts");

const capabilityFingerprint = (script: Omit<UserScript, "id" | "values" | "source" | "name" | "version">): string =>
  JSON.stringify({
    matches: script.matches,
    requires: script.requires,
    resources: script.resources,
    connects: script.connects,
  });

const validateCloudScriptCapabilities = (source: string, builtInSource: string): void => {
  const cloud = parseUserScript(source);
  const builtIn = parseUserScript(builtInSource);
  if (capabilityFingerprint(cloud) !== capabilityFingerprint(builtIn)) {
    throw new Error("云端脚本请求的页面、网络域名或依赖已变化，必须随客户端版本审核发布");
  }
};

const setScriptUpdateState = (patch: Partial<ScriptUpdateState>): void => {
  scriptUpdateState = { ...scriptUpdateState, ...patch };
  broadcast("script:update-state", scriptUpdateState);
};

const loadBuiltInScripts = async (): Promise<UserScript[]> => {
  const filePath = resolveAsset("assets", "userscripts", "monkey.js");
  try {
    const builtInSource = await readFile(filePath, "utf8");
    const cached = await readCachedUserScript(
      userScriptCacheDirectory(),
      (source) => validateCloudScriptCapabilities(source, builtInSource),
    );
    const source = cached?.source ?? builtInSource;
    const script = { ...parseUserScript(source), id: "builtin-chaoxing-helper", values: {} };
    setScriptUpdateState({
      stage: "current",
      activeVersion: script.version,
      source: cached ? "cache" : "builtin",
      message: cached ? `正在使用云端缓存脚本 v${script.version}` : `正在使用内置脚本 v${script.version}`,
    });
    return [script];
  } catch (error) {
    // 静默失败会表现为"界面正常但脚本毫无动静"，必须留下痕迹
    console.error(`内置用户脚本加载失败：${filePath}`, error);
    return [];
  }
};

const getScripts = (): Promise<UserScript[]> => (scriptCache ??= loadBuiltInScripts());

const applyUserScriptUpdate = (result: UserScriptUpdateResult): void => {
  const script = { ...parseUserScript(result.source), id: "builtin-chaoxing-helper", values: {} };
  scriptCache = Promise.resolve([script]);
  setScriptUpdateState({
    stage: result.status,
    activeVersion: script.version,
    source: result.status === "updated" ? "cloud" : scriptUpdateState.source,
    checkedAt: Date.now(),
    message: result.status === "updated"
      ? `学习通助手脚本已更新到 v${script.version}，下次进入页面生效`
      : `学习通助手脚本 v${script.version} 已是最新`,
  });
};

let cloudScriptUpdateCheck: Promise<ScriptUpdateState> | undefined;
const checkCloudUserScript = (): Promise<ScriptUpdateState> => {
  if (cloudScriptUpdateCheck) return cloudScriptUpdateCheck;
  cloudScriptUpdateCheck = (async () => {
    setScriptUpdateState({ stage: "checking", message: "正在检查学习通助手脚本更新" });
    try {
      const builtInSource = await readFile(resolveAsset("assets", "userscripts", "monkey.js"), "utf8");
      const current = (await getScripts())[0];
      if (!current) throw new Error("本地学习通助手脚本不可用");
      const result = await checkUserScriptUpdate({
        origin: oauthConfig.origin,
        cacheDirectory: userScriptCacheDirectory(),
        currentSource: current.source,
        validateSource: (source) => validateCloudScriptCapabilities(source, builtInSource),
      });
      applyUserScriptUpdate(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScriptUpdateState({
        stage: "error",
        checkedAt: Date.now(),
        message: `云端脚本检查失败，继续使用 v${scriptUpdateState.activeVersion || "内置版本"}：${message}`,
      });
    }
    return scriptUpdateState;
  })().finally(() => {
    cloudScriptUpdateCheck = undefined;
  });
  return cloudScriptUpdateCheck;
};

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
    GM_info: { script: { name: definition.name, version: definition.version, matches: definition.matches }, scriptHandler },
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

// 每次页面加载完成后调用。标签管理器负责在合适的时机把 contents 交过来。
const injectMatchingScripts = async (contents: Electron.WebContents): Promise<void> => {
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

// 主站内容跑在标签里。加载不出来（没联网、校园网未认证、站点故障）时不换页面，
// 而是让外壳显示离线提示 —— 校园网登录恰恰要在主站不可达的时候用。
const loadSite = async (contents: Electron.WebContents): Promise<void> => {
  try {
    await contents.loadURL(oauthConfig.origin);
    siteLoaded = true;
    siteError = "";
  } catch (error) {
    siteLoaded = false;
    siteError = error instanceof Error ? error.message : String(error);
    console.error(`主站加载失败：${siteError}`);
  }
  broadcast("shell:site-state", { siteLoaded, siteError });
  // 主站这一刻的 cookie 是最新的，正是静默换 token 的时机
  if (siteLoaded) void syncAuth();
};

// 让工具面板的登录状态跟着主站走：没有 token、已过期、或快到期，都在这里
// 静默补一个。并发触发（首页加载 + 工具页打开）共用同一次隐藏授权，避免互相顶掉。
let authSyncInFlight: Promise<OAuthStatus> | undefined;

const requestAuthSync = async (options: { force?: boolean } = {}): Promise<OAuthStatus> => {
  if (authSyncInFlight) {
    const current = await authSyncInFlight;
    // “刚在首页登录完”是确定性信号。若之前那轮在未登录时失败了，立刻重试，
    // 不让 5 分钟冷却拖住刚完成登录的用户。
    if (!options.force || current.loggedIn) return current;
  }
  const task = ensureOAuthSession(openAuthorizeWindow, options);
  authSyncInFlight = task;
  try {
    return await task;
  } finally {
    if (authSyncInFlight === task) authSyncInFlight = undefined;
  }
};

const authStatusChanged = (before: OAuthStatus, after: OAuthStatus): boolean =>
  before.loggedIn !== after.loggedIn
  || before.expiresAt !== after.expiresAt
  || JSON.stringify(before.user) !== JSON.stringify(after.user);

const syncAuth = async (options: { force?: boolean } = {}): Promise<OAuthStatus> => {
  try {
    // before 只做差异比较，不触发 userinfo；真正的刷新由 requestAuthSync 完成
    const before = await getOAuthStatus({ refreshUser: false });
    const after = await requestAuthSync(options);
    if (authStatusChanged(before, after)) broadcast("oauth:changed", after);
    return after;
  } catch (error) {
    console.error("同步登录状态失败", error);
    return getOAuthStatus({ refreshUser: false });
  }
};

// 主站标签上一次停在哪。用来识别"用户刚登录完"这一个瞬间：
// 从 /login 走到别处，就是登录成功了。
let lastSitePath = "";

const noteSiteNavigation = (contents: Electron.WebContents): void => {
  if (contentsKind.get(contents.id) !== "site") return;
  let pathname = "";
  try {
    pathname = new URL(contents.getURL()).pathname;
  } catch {
    return;
  }
  const cameFromLogin = lastSitePath.startsWith("/login") && !pathname.startsWith("/login");
  lastSitePath = pathname;
  // 这是个确定性信号，值得跳过冷却立刻换 token —— 用户登完就会去点工具页，
  // 让他等一个冷却周期等于这个机制白做了。
  if (cameFromLogin) void syncAuth({ force: true });
};

const createTabManager = (window: BrowserWindow): TabManager => new TabManager(window, {
  appVersion: app.getVersion(),
  isNavigable: (url) => asNavigableUrl(url) !== undefined,
  registerKind: (webContentsId, kind) => contentsKind.set(webContentsId, kind),
  openExternally,
  onNavigation: noteSiteNavigation,
  onDidFinishLoad: (contents) => {
    void injectMatchingScripts(contents);
  },
  onChange: (tabsState, activeId) => broadcast("tabs:changed", { tabs: tabsState, activeId })
});

const openMainWindow = async (options: { show?: boolean } = {}): Promise<void> => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    title: branding.windowTitle,
    backgroundColor: "#f8fafc",
    show: options.show !== false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "shell-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });
  const window = mainWindow;
  window.on("close", (event) => {
    if (quitting || !tray || !closeToTray) return;
    event.preventDefault();
    window.hide();
  });
  window.once("closed", () => {
    tabs?.destroy();
    tabs = undefined;
    mainWindow = undefined;
  });
  enableClipboardMenu(window);
  await window.loadFile(resolveAsset("src", "shell", "index.html"));

  // 首启引导还没走完时先不建标签：内容视图永远盖在外壳页面之上，
  // 建了就会把引导页压住。走完引导再补建。
  const { onboarded } = await readPreferences();
  if (onboarded) await createTabs(window);
};

const createTabs = async (window: BrowserWindow): Promise<void> => {
  if (tabs) return;
  tabs = createTabManager(window);
  tabs.openToolsTab();
  await tabs.openSiteTab(loadSite);
};

const openLearningPage = async (): Promise<void> => {
  // 这里只判断 token，没必要为了开标签再拉一次资料
  const auth = await getOAuthStatus({ refreshUser: false });
  if (!auth.loggedIn) throw new Error("请先完成登录");
  await openMainWindow();
  await tabs?.openLearningTab(learningUrl);
};

// 授权页开在应用内窗口，与主站共用会话：用户在主站已登录的话这里直接过。
// silent 时窗口不显示 —— 服务端认得出 cookie 就会直接签发 code 并跳回本机回调，
// 整个过程用户看不见；认不出来会跳登录页，那时候立刻收手。
const openAuthorizeWindow: AuthorizeOpener = async (authorizeUrl, callbackOrigin, options) => {
  const window = new BrowserWindow({
    width: 520,
    height: 720,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    show: !options.silent,
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
  // 回环回调是 http 且不在任何白名单里，只对这一个窗口、这一次登录放行。
  // id 必须现在就取下来：closed 回调触发时窗口已经销毁，那时再读
  // window.webContents 会抛 "Object has been destroyed"。
  const authContentsId = window.webContents.id;
  navigationOverrides.set(authContentsId, createAuthNavigationRule(callbackOrigin));
  let settled = false;

  // 静默授权只有"服务端凭 cookie 当场放行"这一种成功路径。一旦跳到登录页，
  // 说明主站会话也没了 —— 必须立刻结束，否则这个看不见的窗口会挂到超时，
  // 期间用户点"登录"会被"已开始新的登录流程"顶掉。
  if (options.silent) {
    const bail = (_event: Electron.Event, url: string): void => {
      try {
        if (new URL(url).pathname.startsWith("/login")) abortOAuthLogin();
      } catch {
        // 地址解析不了就不管，交给超时兜底
      }
    };
    window.webContents.on("will-navigate", bail);
    window.webContents.on("will-redirect", bail);
    window.webContents.on("did-navigate", bail);
  }
  window.once("closed", () => {
    navigationOverrides.delete(authContentsId);
    // 用户手动关窗时要把等待中的登录 Promise 结掉，否则要挂到 5 分钟超时
    if (!settled) abortOAuthLogin();
  });
  // 不能 await：授权页会自己一路跳到本机回调地址，登录一成功这个窗口就被销毁，
  // 于是这次导航必然以 ERR_ABORTED 收尾。那是预期结果 ——
  // 之前 await 它，等于把"登录成功"报成了"登录失败"。
  window.loadURL(authorizeUrl).catch(() => undefined);
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
    { label: "打开学习通", click: () => void openLearningPage().catch((error) => console.error("打开学习通失败", error)) },
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
  // Windows 的传统菜单栏平时虽被隐藏，单按 Alt 仍会突然把它唤出来，
  // 与客户端自己绘制的导航重复。macOS 需要系统级应用菜单，只有非 Mac
  // 平台彻底移除默认菜单；剪切、复制、粘贴仍由 Chromium 与右键菜单处理。
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const windowSubmenu: Electron.MenuItemConstructorOptions[] = [{ role: "reload", label: "重新加载" }];
  // 开发者工具只在开发期开放：打包版留着它等于给任意页面一个提权入口
  if (!app.isPackaged) windowSubmenu.push({ role: "toggleDevTools", label: "开发者工具" });
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{
          label: branding.productName,
          submenu: [
            { role: "about" as const, label: `关于${branding.productName}` },
            { type: "separator" as const },
            { role: "hide" as const, label: "隐藏" },
            { role: "hideOthers" as const, label: "隐藏其他" },
            { role: "unhide" as const, label: "全部显示" },
            { type: "separator" as const },
            { role: "quit" as const, label: `退出${branding.productName}` }
          ]
        }]
      : [{ label: "应用", submenu: [{ role: "quit" as const, label: "退出" }] }]),
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
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    // 外壳自己用 file:// 加载，不受站点白名单约束
    if (url.startsWith("file://")) return;
    if (navigationOverrides.get(contents.id)?.(url)) return;
    // 学习通标签里页面自身的跳转全部放行：超星登录会连跳好几个白名单外的域名，
    // 把它踢去外部浏览器会直接把会话断在半路。
    // 脚本注入与特权桥不受影响 —— 那两件事始终只看 injectableHosts。
    // 明文 http 也放行：超星登录链路中间有一跳是 http，只认 https 会把登录踢去系统浏览器。
    if (contentsKind.get(contents.id) === "learning" && parseWebUrl(url)) return;
    if (asNavigableUrl(url)) return;
    event.preventDefault();
    // 页面里点出来的链接一律留在应用内开新标签，不丢给系统浏览器。
    // "不是通用浏览器"的边界靠没有地址栏来守：用户没有任何入口主动输网址。
    if (parseWebUrl(url)) {
      void tabs?.openLearningTab(url, { trusted: true });
      return;
    }
    // 剩下的是 mailto: 之类的非网页协议，直接丢弃
    console.warn(`忽略非网页协议地址：${url}（来源标签 ${contentsKind.get(contents.id) ?? "未知"}）`);
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
  contents.on("destroyed", () => { revokeGrants(contents.id); contentsKind.delete(contents.id); });
  // 页面加载失败本来是完全静默的，表现为"窗口开着但一片空白"
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) console.error(`页面加载失败：${validatedURL} (${errorCode} ${errorDescription})`);
  });
};

// 安装态与卸载态刻意不参与单实例锁：两者都可能在正式版正开着的时候运行，
// 抢不到锁会让安装器"双击没反应"。它们也不碰托盘、标签、校园网那一整套。
// 自安装器、卸载器与覆盖更新都是 Windows 专属。macOS 的 DMG 由系统负责拖拽安装，
// 绝不能因为碰巧带了同名参数而走到 PowerShell / 注册表代码。
const installMode = process.platform === "win32" && isInstallLaunch();
const uninstallMode = process.platform === "win32" && process.argv.includes("--uninstall");

if (installMode || uninstallMode) {
  app.whenReady().then(async () => {
    if (uninstallMode) {
      await runUninstall();
      app.exit(0);
      return;
    }
    await openInstallerWindow();
  }).catch((error) => {
    console.error("安装程序启动失败：", error);
    app.exit(1);
  });
  app.on("window-all-closed", () => app.exit(0));
} else if (!app.requestSingleInstanceLock()) {
  // 不说一声就退的话，表现是"双击没反应、日志空白"，很难判断到底是崩了还是被锁住了
  console.log("已有一个实例在运行，本次启动退出并把窗口交给它");
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

    // 上次覆盖安装时旧版正开着，那些文件当时只能改名不能删，现在收拾掉
    if (process.platform === "win32") void sweepReplacedFiles();

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

    /* ---------------------------------------------------------- 自动更新 */
    onUpdateState((value: UpdateState) => {
      broadcast("update:state", value);
      // 只在"下好了"这一刻提示一次。下载全程静默 —— 用户没要求过这次更新，
      // 中途弹窗只会打断他，而下载失败也不值得惊动他，下次开机再试。
      if (value.stage === "ready") {
        try {
          if (Notification.isSupported()) {
            const notification = new Notification({
              title: "药大拾间已准备好更新",
              body: `v${value.latest} 已下载完成，下次启动时自动安装。`
            });
            notification.on("click", () => void openMainWindow());
            notification.show();
          }
        } catch {
          // 通知失败不影响更新本身
        }
      }
    });
    ipcMain.handle("update:state", () => getUpdateState());
    ipcMain.handle("update:check-now", () =>
      supportsAutomaticInstallerUpdates ? checkAndDownload() : getUpdateState()
    );
    // 用户点"立即重启更新"：安装器会自己关掉旧版并在装完后拉起新版
    ipcMain.handle("update:install-now", async () => {
      if (!supportsAutomaticInstallerUpdates) return false;
      await flushBrowserSession();
      if (!runPendingUpdate()) return false;
      quitting = true;
      // Cookie 和站点存储已经显式刷盘；再留一点时间让安装器完成解压启动。
      setTimeout(() => app.exit(0), 500);
      return true;
    });
    ipcMain.handle("app:open-update", (_event, url: unknown) => {
      if (typeof url === "string") openUpdateDownload(url);
    });
    ipcMain.handle("site:reload", async () => {
      const contents = tabs?.contentsOfKind("site")[0];
      if (!contents) return { siteLoaded: false, siteError: "" };
      await loadSite(contents);
      return { siteLoaded, siteError };
    });

    /* ---------------------------------------------------------------- 标签 */
    ipcMain.handle("shell:boot", () => ({
      productName: branding.productName,
      version: app.getVersion(),
      origin: oauthConfig.origin,
      siteLoaded,
      siteError,
      chromeHeight: CHROME_HEIGHT,
      onboarded: preferences.onboarded
    }));
    ipcMain.handle("app:complete-onboarding", async (_event, patch: unknown) => {
      const settings = (patch ?? {}) as { launchOnLogin?: boolean; campusNetEnabled?: boolean };
      const saved = await writePreferences({
        onboarded: true,
        ...(typeof settings.launchOnLogin === "boolean" ? { launchOnLogin: settings.launchOnLogin } : {}),
        ...(typeof settings.campusNetEnabled === "boolean"
          ? { campusNet: { enabled: settings.campusNetEnabled } as never }
          : {})
      });
      closeToTray = saved.closeToTray;
      applyLaunchOnLogin(saved.launchOnLogin, saved.startMinimized);
      campusNet?.updateSettings(saved.campusNet);
      if (mainWindow && !mainWindow.isDestroyed()) await createTabs(mainWindow);
      return { onboarded: true };
    });

    ipcMain.handle("tabs:state", () => tabs?.getState() ?? { tabs: [], activeId: "" });
    ipcMain.handle("tabs:activate", (_event, id: unknown) => { if (typeof id === "string") tabs?.activate(id); });
    ipcMain.handle("tabs:close", (_event, id: unknown) => { if (typeof id === "string") tabs?.close(id); });
    ipcMain.handle("tabs:reload", (_event, id: unknown) => { if (typeof id === "string") tabs?.reload(id); });
    ipcMain.handle("tabs:go-back", (_event, id: unknown) => { if (typeof id === "string") tabs?.goBack(id); });
    ipcMain.handle("tabs:open-learning", () => openLearningPage());
    ipcMain.handle("tabs:open-sponsor", () => tabs?.navigateSite(new URL("/profile#sponsor", oauthConfig.origin).href) ?? false);

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

    /* ------------------------------------------------ 学习通「记住密码」 */
    // 密码只有一个去处：学习通登录页的输入框。工具页拿到的账号是打码的、
    // 永远拿不到密码；下发明文凭据的 chaoxing:credential 只回应真的停在
    // 超星登录页上的学习通标签，其余来源一律回 null。

    const chaoxingState = async (): Promise<{ remember: boolean; hasCredential: boolean; account: string }> => {
      const { rememberChaoxing } = await readPreferences();
      const credential = await readChaoxingCredential();
      return {
        remember: rememberChaoxing,
        hasCredential: Boolean(credential),
        account: credential ? maskChaoxingAccount(credential.account) : ""
      };
    };

    const isChaoxingLoginSender = (event: Electron.IpcMainInvokeEvent): boolean => {
      if (contentsKind.get(event.sender.id) !== "learning") return false;
      const frameUrl = senderFrameUrl(event);
      if (!frameUrl) return false;
      try {
        const url = new URL(frameUrl);
        return url.protocol === "https:" && url.hostname === chaoxingLoginHost;
      } catch {
        return false;
      }
    };

    ipcMain.handle("chaoxing:state", () => chaoxingState());
    ipcMain.handle("chaoxing:set-remember", async (_event, value: unknown) => {
      const remember = value === true;
      await writePreferences({ rememberChaoxing: remember });
      // 开关的语义是"要不要存"，不只是"要不要填"：关掉就删，不留死数据
      if (!remember) await clearChaoxingCredential();
      return chaoxingState();
    });
    ipcMain.handle("chaoxing:clear-credential", async () => {
      await clearChaoxingCredential();
      return chaoxingState();
    });
    // 登录页 preload 开页时调用：开关关着直接回 null，那边连输入框都不会碰
    ipcMain.handle("chaoxing:credential", async (event) => {
      if (!isChaoxingLoginSender(event)) return null;
      const { rememberChaoxing } = await readPreferences();
      if (!rememberChaoxing) return null;
      return { credential: await readChaoxingCredential() };
    });
    ipcMain.handle("chaoxing:offer-credential", async (event, account: unknown, password: unknown) => {
      if (!isChaoxingLoginSender(event)) return;
      const { rememberChaoxing } = await readPreferences();
      if (!rememberChaoxing) return;
      if (typeof account !== "string" || typeof password !== "string") return;
      const trimmed = account.trim();
      if (!trimmed || !password || trimmed.length > 128 || password.length > 256) return;
      await writeChaoxingCredential({ account: trimmed, password });
      // 工具页可能正开着，提示得跟着从"还没保存过"变成"已保存"
      broadcast("chaoxing:state-changed", await chaoxingState());
    });

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

    // 返回生效后的完整配置，不是用户覆盖项。存的只有覆盖项，全新安装时是空对象，
    // 直接抛给界面会让所有开关显示成关、数字框显示成空 —— 而脚本那边其实按默认值在跑。
    ipcMain.handle("script:get-config", async () => buildScriptConfig((await readPreferences()).scriptConfig));
    ipcMain.handle("script:set-config", async (_event, patch: unknown) => {
      const saved = await writePreferences({ scriptConfig: (patch ?? {}) as Record<string, unknown> });
      const effective = buildScriptConfig(saved.scriptConfig);
      broadcast("script:config-changed", effective);
      return effective;
    });
    ipcMain.handle("script:get-activity", (_event, limit: unknown) => ({
      status: latestScriptStatus,
      running: (tabs?.contentsOfKind("learning").length ?? 0) > 0,
      entries: scriptActivity.slice(-(typeof limit === "number" ? Math.min(Math.max(limit, 1), 200) : 80))
    }));
    ipcMain.handle("script:get-update-state", () => scriptUpdateState);
    ipcMain.handle("script:check-update", () => checkCloudUserScript());

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
    ipcMain.handle("oauth:sync", (_event, force: unknown) => syncAuth({ force: force === true }));
    // 额度规则由服务端下发：档位与系数都能被后台改，写死在客户端就会变成误导
    ipcMain.handle("oauth:quota-rules", async () => {
      try {
        const response = await fetch(new URL("/api/site/ai-quota-rules", oauthConfig.origin).toString(), {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) return null;
        const payload = await response.json() as { data?: unknown };
        return payload.data ?? null;
      } catch {
        // 拿不到就不显示"怎么提升"那一段，不影响其余信息
        return null;
      }
    });
    ipcMain.handle("site:config", async () => {
      try {
        const response = await fetch(new URL("/api/site/config", oauthConfig.origin).toString(), {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) return null;
        const payload = await response.json() as { data?: unknown };
        return payload.data ?? null;
      } catch {
        return null;
      }
    });
    ipcMain.handle("oauth:logout", async () => {
      await logoutOAuth();
      tabs?.closeAllLearningTabs();
      grants.clear();
    });
    ipcMain.handle("learning:open", () => openLearningPage());

    createTray();
    // 开机自启且勾了静默启动时，只把托盘挂上，不弹窗
    const loginSettings = app.getLoginItemSettings();
    const launchedAtLogin = process.argv.includes("--startup")
      || (process.platform === "darwin" && loginSettings.wasOpenedAtLogin);
    const silentStart = preferences.startMinimized && launchedAtLogin && tray !== undefined;
    await openMainWindow({ show: !silentStart });
    const scripts = await getScripts();
    console.log(
      `${branding.productName} v${app.getVersion()} 已启动 · 主站 ${oauthConfig.origin}`
      + ` · ${tabs ? (siteLoaded ? "主站已加载" : "主站不可达，已显示离线提示") : "等待首启引导完成"}`
      + ` · 已载入 ${scripts.length} 个用户脚本`
    );
    app.on("activate", () => void openMainWindow());

    // 启动后延后查一次更新：这批用户不会主动去看有没有新版，
    // 而超星一改版脚本就失效，得让他们知道。
    // 静默下载在后台跑，下好了才提示；失败就等下一轮，不打扰。
    if (supportsAutomaticInstallerUpdates) {
      setTimeout(() => void checkAndDownload(), 8000).unref?.();
      // 长期开着的实例（这个应用常驻托盘）也要能拿到更新，每 6 小时再探一次
      setInterval(() => void checkAndDownload(), 6 * 60 * 60 * 1000).unref?.();
    }
    // 学习通助手脚本独立热更新，Windows 与 macOS 都可用。失败时保留已校验缓存或内置脚本。
    setTimeout(() => void checkCloudUserScript(), 4000).unref?.();
    setInterval(() => void checkCloudUserScript(), USER_SCRIPT_CHECK_INTERVAL_MS).unref?.();
  }).catch((error) => {
    // 没有这个 catch 的话，启动期任何异常都会变成被吞掉的 unhandled rejection，
    // 表现为"进程静默退出、没有任何输出"，完全无从排查。
    console.error("启动失败：", error);
  });

  app.on("before-quit", (event) => {
    quitting = true;
    campusNet?.stop();
    if (exitPreparationStarted) return;

    // Chromium 会延迟写 Cookie 与 localStorage。这里先拦住退出，完成落盘后再启动
    // 更新器，避免安装器强制关闭旧进程时只丢主站会话、却保留独立 OAuth 文件。
    event.preventDefault();
    exitPreparationStarted = true;
    void flushBrowserSession().finally(() => {
      if (supportsAutomaticInstallerUpdates && hasPendingUpdate()) runPendingUpdate();
      app.exit(0);
    });
  });

  app.on("window-all-closed", () => {
    // 有托盘时关掉所有窗口只是收起来，不退出
    if (process.platform !== "darwin" && !tray) app.quit();
  });
}
