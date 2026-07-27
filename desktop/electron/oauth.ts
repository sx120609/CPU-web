import { session as electronSession } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createServer, Server } from "node:http";
import { clearOAuthSession, OAuthSession, OAuthUser, peekOAuthSession, writeOAuthSession } from "./oauth-store";
import { normalizeOAuthUser, refreshOAuthUser } from "./oauth-user";
import { branding, oauthConfig } from "./config";

// 授权页由调用方负责打开：主进程会开一个与主站共用会话的应用内窗口，
// 这样用户在主站已经登录过就不必再登录一次。close() 用于登录结束后收拾窗口。
export type AuthorizeWindow = { close: () => void };
export type AuthorizeOptions = { silent: boolean };
export type AuthorizeOpener = (
  authorizeUrl: string,
  callbackOrigin: string,
  options: AuthorizeOptions
) => Promise<AuthorizeWindow>;

type PendingLogin = {
  server: Server;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  timer: NodeJS.Timeout;
  reject: (error: Error) => void;
  window?: AuthorizeWindow;
};

export type OAuthStatus = {
  loggedIn: boolean;
  expired?: boolean;
  expiresAt?: number;
  scope?: string;
  user?: OAuthUser;
};

let pendingLogin: PendingLogin | undefined;

const baseUrl = (path: string): string => new URL(path, oauthConfig.origin).toString();

const ensureOrigin = (): void => {
  if (new URL(oauthConfig.origin).protocol !== "https:") throw new Error("主站地址必须使用 HTTPS");
};

const responsePage = (message: string): string =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${branding.productName}</title><body><p>${message}</p><script>window.close()</script></body></html>`;

const finishPending = (pending: PendingLogin): void => {
  clearTimeout(pending.timer);
  pending.server.close();
  pending.window?.close();
  if (pendingLogin === pending) pendingLogin = undefined;
};

const fetchJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!response.ok) throw new Error(payload?.error || payload?.message || `请求失败（HTTP ${response.status}）`);
  return payload as T;
};

const getUser = async (session: OAuthSession): Promise<OAuthUser | undefined> => {
  const payload = await fetchJson<unknown>(baseUrl("/api/oauth/userinfo"), {
    headers: { Authorization: `${session.tokenType} ${session.accessToken}` }
  });
  return normalizeOAuthUser(payload);
};

const exchangeCode = async (pending: PendingLogin, code: string): Promise<OAuthSession> => {
  const token = await fetchJson<{ access_token: string; token_type?: string; expires_in: number; scope?: string }>(baseUrl("/api/oauth/token"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: oauthConfig.clientId,
      code_verifier: pending.codeVerifier
    })
  });
  if (!token.access_token || !Number.isFinite(token.expires_in)) throw new Error("服务端返回的登录凭据无效");
  const session: OAuthSession = {
    accessToken: token.access_token,
    tokenType: token.token_type || "Bearer",
    expiresAt: Date.now() + token.expires_in * 1000,
    scope: token.scope || oauthConfig.scope
  };
  session.user = await getUser(session);
  if (!session.user) throw new Error("未能获取用户信息");
  await writeOAuthSession(session);
  return session;
};

// 只关服务器而不 reject，会让上一次 ipcMain.handle("oauth:login") 永久挂起：
// 渲染进程的 finally 不执行，登录按钮永久变灰，只能重启应用。
const stopPending = (reason: string): void => {
  const pending = pendingLogin;
  if (!pending) return;
  finishPending(pending);
  pending.reject(new Error(reason));
};

export const startOAuthLogin = async (
  openAuthorize: AuthorizeOpener,
  options: { silent?: boolean; timeoutMs?: number } = {}
): Promise<OAuthSession> => {
  ensureOrigin();
  stopPending("已开始新的登录流程");
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  let resolveLogin: (session: OAuthSession) => void = () => undefined;
  let rejectLogin: (error: Error) => void = () => undefined;
  const result = new Promise<OAuthSession>((resolve, reject) => {
    resolveLogin = resolve;
    rejectLogin = reject;
  });
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${oauthConfig.callbackHost}`);
    if (request.method !== "GET" || requestUrl.pathname !== oauthConfig.callbackPath) {
      response.writeHead(404).end();
      return;
    }
    const pending = pendingLogin;
    if (!pending || requestUrl.searchParams.get("state") !== pending.state) {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(responsePage("登录回调无效，请返回应用重试。"));
      return;
    }
    const error = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");
    const failed = Boolean(error) || !code;
    response
      .writeHead(failed ? 400 : 200, { "content-type": "text/html; charset=utf-8" })
      .end(responsePage(failed ? "登录未完成，请返回应用。" : "登录已完成，请返回应用。"));
    finishPending(pending);
    if (failed) rejectLogin(new Error(error || "未收到授权码"));
    else void exchangeCode(pending, code as string).then(resolveLogin).catch(rejectLogin);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, oauthConfig.callbackHost, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("无法创建 OAuth 回调服务");
  }
  const redirectUri = `http://${oauthConfig.callbackHost}:${address.port}${oauthConfig.callbackPath}`;
  const pending: PendingLogin = {
    server,
    state,
    codeVerifier,
    redirectUri,
    reject: rejectLogin,
    // 静默授权不该等满 5 分钟：它要么被服务端当场放行，要么就是主站会话也没了。
    // 挂着等超时会让用户随后点"登录"时被"已有登录流程"顶掉。
    timer: setTimeout(() => {
      finishPending(pending);
      rejectLogin(new Error(options.silent ? "静默授权未完成" : "登录等待超时"));
    }, options.timeoutMs ?? oauthConfig.loginTimeoutMs)
  };
  pendingLogin = pending;
  const authorizeUrl = new URL(baseUrl("/api/oauth/authorize"));
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: oauthConfig.clientId,
    redirect_uri: redirectUri,
    scope: oauthConfig.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  }).toString();
  try {
    const authWindow = await openAuthorize(
      authorizeUrl.toString(),
      `http://${oauthConfig.callbackHost}:${address.port}`,
      { silent: options.silent === true }
    );
    // 授权可能在窗口创建返回前就已经回调完成，那时 pending 已经结束了
    if (pendingLogin === pending) pending.window = authWindow;
    else authWindow.close();
  } catch (error) {
    finishPending(pending);
    rejectLogin(error instanceof Error ? error : new Error("无法打开授权页面"));
  }
  return result;
};

// 用户手动关掉授权窗口时调用，否则调用方的 Promise 会一直挂到 5 分钟超时
export const abortOAuthLogin = (): void => stopPending("授权已取消");

/* ------------------------------------------------------------ 静默授权 */
// 主站标签用的是 cookie 会话，工具面板用的是独立的 access token，两者本来各登各的。
// 但服务端的 /api/oauth/authorize 在 cookie 认得出用户时会直接签发 code 并跳转，
// 没有同意页也不需要点击 —— 所以只要主站已登录，我们就能在一个隐藏窗口里把整套
// 授权流程跑完，用户什么都看不见。
//
// 这一个机制同时解决两件事：
//   1. 主站登录后工具面板自动生效，不用再点一次"登录"
//   2. token 到期自动续 —— 服务端只支持 authorization_code、不发 refresh_token，
//      重跑一遍授权就是唯一不改服务端的续期办法
//
// 可行的前提是主站会话活得比 token 长：浏览器会话绝对有效期 1 年、空闲 24 小时
// 且滑动续期，而 access token 只有 30 天。

const SILENT_COOLDOWN_MS = 5 * 60 * 1000;
const SILENT_TIMEOUT_MS = 25_000;

let lastSilentAttempt = 0;

/**
 * 尝试静默拿一个新 token。拿不到就安静返回 null —— 这是后台行为，
 * 任何失败都不该冒泡成用户可见的错误，界面上还有手动登录按钮兜底。
 */
export const trySilentOAuthLogin = async (
  openAuthorize: AuthorizeOpener,
  options: { force?: boolean } = {}
): Promise<OAuthSession | null> => {
  // 用户正在手动登录时不插队：startOAuthLogin 开头会 stopPending，插进去会把人家顶掉
  if (pendingLogin) return null;
  // force 用于"刚在主站登录完"这种确定性信号：上一次尝试多半是在未登录时失败的，
  // 让用户干等一个冷却周期才生效，就白费了这个机制。
  if (!options.force && Date.now() - lastSilentAttempt < SILENT_COOLDOWN_MS) return null;
  lastSilentAttempt = Date.now();
  try {
    return await startOAuthLogin(openAuthorize, { silent: true, timeoutMs: SILENT_TIMEOUT_MS });
  } catch {
    // 主站也没登录、网络不通、被跳到登录页 —— 都走这里，安静收手
    return null;
  }
};

/** token 剩这么久以内就提前续，别等真过期那天用户正在用 */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 保证有一个可用 token：没有、已过期、或快过期，都试着静默续一次。
 * 返回续期后的状态，调用方据此刷新界面。
 */
export const ensureOAuthSession = async (
  openAuthorize: AuthorizeOpener,
  options: { force?: boolean } = {}
): Promise<OAuthStatus> => {
  const session = await peekOAuthSession();
  const healthy = session
    && session.expiresAt > Date.now() + RENEW_BEFORE_MS
    && Boolean(session.user);
  if (healthy) return getOAuthStatus();
  await trySilentOAuthLogin(openAuthorize, options);
  // 新登录已经在 exchangeCode 中取过一次资料，不重复请求
  return getOAuthStatus({ refreshUser: false });
};

export const getOAuthStatus = async (
  options: { refreshUser?: boolean } = {}
): Promise<OAuthStatus> => {
  const session = await peekOAuthSession();
  if (!session) return { loggedIn: false };
  if (session.expiresAt <= Date.now()) {
    await clearOAuthSession();
    return { loggedIn: false, expired: true };
  }
  // access token 的有效期是 30 天，但信誉、点数与每日额度随时会变。旧实现把
  // user 快照也缓存 30 天，导致升级客户端后新增字段一直显示"—"。
  if (options.refreshUser !== false || !session.user) {
    try {
      const refreshed = await refreshOAuthUser(session, getUser, writeOAuthSession);
      if (!refreshed && !session.user) {
        await clearOAuthSession();
        return { loggedIn: false };
      }
    } catch (error) {
      // 断网时保留上次成功快照；只有从来没有可用资料时才判成未登录
      if (!session.user) {
        await clearOAuthSession();
        return { loggedIn: false };
      }
      console.warn("刷新 OAuth 用户资料失败，暂用本地快照", error);
    }
  }
  return { loggedIn: true, expiresAt: session.expiresAt, scope: session.scope, user: session.user };
};

export const logoutOAuth = async (): Promise<void> => {
  stopPending("登录已取消");
  const session = await peekOAuthSession();
  await clearOAuthSession();
  // 删本地文件不等于服务端失效：access token 有效期 30 天，必须主动撤销
  if (session) {
    try {
      await fetch(baseUrl("/api/oauth/revoke"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 服务端 schema 是 strict()，只接受这两个字段
        body: JSON.stringify({ token: session.accessToken, client_id: oauthConfig.clientId }),
        signal: AbortSignal.timeout(10000)
      });
    } catch (error) {
      console.error("撤销 access token 失败，可到主站会话管理中手动处理", error);
    }
  }
  // 学习通的登录态留在默认会话里，不清掉相当于没退出
  try {
    await electronSession.defaultSession.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
  } catch (error) {
    console.error("清理本地会话数据失败", error);
  }
};
