import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, session, shell, Tray } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FetchTextResult, isHostAllowed, parseHttpsUrl, UserScript } from "./shared";
import { asInjectableUrl, asNavigableUrl, scriptMatchesUrl } from "./policy";
import { getOAuthStatus, logoutOAuth, startOAuthLogin } from "./oauth";
import { readOAuthSession } from "./oauth-store";
import { branding, injectableHosts, learningUrl, limits, oauthConfig } from "./config";

let homeWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
const learningWindows = new Set<BrowserWindow>();

// 一次性授权票据：主进程在注入脚本时下发 nonce，脚本每次调用特权桥都要带上。
// 页面导航或窗口销毁即回收，避免票据长期有效。
type ScriptGrant = { scriptId: string; webContentsId: number };
const grants = new Map<string, ScriptGrant>();

const resolveAsset = (...segments: string[]): string => path.join(app.getAppPath(), ...segments);

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

const routeUrl = (value: string): void => {
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

const createInjection = (script: UserScript, nonce: string): string => `(() => {
  const definition = ${JSON.stringify(script)};
  const nonce = ${JSON.stringify(nonce)};
  const storagePrefix = ${JSON.stringify(`${branding.storagePrefix}:${script.id}:`)};
  const scriptHandler = ${JSON.stringify(branding.productName)};
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
    GM_getValue: (key, fallback) => { try { const value = localStorage.getItem(storagePrefix + key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } },
    GM_setValue: (key, value) => { try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); } catch (error) { console.error("用户脚本配置保存失败", error); } },
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
      for (const script of await getScripts()) {
        if (!scriptMatchesUrl(script, currentUrl)) continue;
        const nonce = randomBytes(32).toString("base64url");
        grants.set(nonce, { scriptId: script.id, webContentsId: contents.id });
        try {
          await contents.executeJavaScript(createInjection(script, nonce), false);
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

const openHomePage = async (): Promise<void> => {
  if (homeWindow && !homeWindow.isDestroyed()) {
    homeWindow.show();
    homeWindow.focus();
    return;
  }
  homeWindow = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 640,
    minHeight: 520,
    title: branding.homeTitle,
    webPreferences: {
      preload: path.join(__dirname, "home-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });
  const window = homeWindow;
  window.on("close", (event) => {
    // 刷课是长时任务，关窗默认收进托盘而不是退出
    if (quitting || !tray) return;
    event.preventDefault();
    window.hide();
  });
  window.once("closed", () => {
    homeWindow = undefined;
  });
  enableClipboardMenu(window);
  await window.loadFile(resolveAsset("src", "home", "index.html"));
};

const openLearningPage = async (): Promise<void> => {
  const auth = await getOAuthStatus();
  if (!auth.loggedIn) throw new Error("请先完成 OAuth2 登录");
  await openLearningWindow(learningUrl);
};

const createTray = (): void => {
  const source = nativeImage.createFromPath(resolveAsset("assets", "tray-icon.png"));
  if (source.isEmpty()) return;
  // 托盘图源是 512×512 的品牌图，直接交给系统会被拉伸得很糊
  const icon = source.resize({ width: 16, height: 16, quality: "best" });
  tray = new Tray(icon);
  tray.setToolTip(branding.productName);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示主窗口", click: () => void openHomePage() },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on("double-click", () => void openHomePage());
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
    // 本地首页用 file:// 加载，不受站点白名单约束
    if (url.startsWith("file://")) return;
    if (asNavigableUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.setWindowOpenHandler(({ url }) => {
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
  app.on("second-instance", () => void openHomePage());

  app.on("web-contents-created", (_event, contents) => applyNavigationPolicy(contents));

  app.whenReady().then(async () => {
    buildApplicationMenu();

    // 默认拒绝所有权限请求，只放行视频全屏
    const allowPermission = (permission: string): boolean => permission === "fullscreen";
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowPermission(permission)));
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowPermission(permission));

    ipcMain.handle("app:info", () => ({
      productName: branding.productName,
      version: app.getVersion(),
      origin: oauthConfig.origin,
      learningUrl
    }));

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

    ipcMain.handle("oauth:login", () => startOAuthLogin().then((session) => ({
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
    await openHomePage();
    const scripts = await getScripts();
    console.log(`${branding.productName} v${app.getVersion()} 已启动 · 主站 ${oauthConfig.origin} · 已载入 ${scripts.length} 个用户脚本`);
    app.on("activate", () => void openHomePage());
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("window-all-closed", () => {
    // 有托盘时关掉所有窗口只是收起来，不退出
    if (process.platform !== "darwin" && !tray) app.quit();
  });
}
