import { session as electronSession, shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createServer, Server } from "node:http";
import { clearOAuthSession, OAuthSession, OAuthUser, peekOAuthSession, writeOAuthSession } from "./oauth-store";
import { branding, oauthConfig } from "./config";

type PendingLogin = {
  server: Server;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  timer: NodeJS.Timeout;
  reject: (error: Error) => void;
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
  if (pendingLogin === pending) pendingLogin = undefined;
};

const fetchJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!response.ok) throw new Error(payload?.error || payload?.message || `请求失败（HTTP ${response.status}）`);
  return payload as T;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const firstValue = (records: Record<string, unknown>[], keys: string[]): unknown => {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
};

const asOptionalText = (value: unknown): string | undefined => {
  if (value === undefined || value === null || typeof value === "object") return undefined;
  const text = String(value);
  return text === "" ? undefined : text;
};

// Number(x) || undefined 会把 0 吞成"无数据"，额度用尽的用户会以为接口挂了
const asOptionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const NAME_KEYS = ["username", "preferred_username", "name", "nickname", "login"];

const normalizeUser = (payload: unknown): OAuthUser | undefined => {
  const root = asRecord(payload);
  // 服务端统一响应是 { code, data, message }，用户信息在 data 里
  const records = [asRecord(root.data), asRecord(root.user), asRecord(root.profile), root];
  const userObject = records.map((record) => asRecord(record.user)).find((record) => Object.keys(record).length > 0);
  const nested = userObject ? [userObject] : [];
  const name = firstValue(records, NAME_KEYS) ?? firstValue(nested, NAME_KEYS);
  const sub = firstValue(records, ["sub", "id", "userId"]) ?? firstValue(nested, ["id"]);
  if (name === undefined && sub === undefined) return undefined;
  return {
    sub: asOptionalText(sub),
    user: asOptionalText(name),
    nickname: asOptionalText(userObject?.nickname),
    name: asOptionalText(userObject?.name),
    username: asOptionalText(userObject?.username),
    level: asOptionalText(firstValue(records, ["level"])),
    levelName: asOptionalText(firstValue(records, ["levelName", "level_name"])),
    aiBalance: asOptionalNumber(firstValue(records, ["aiBalance", "ai_balance"])),
    dailyQuota: asOptionalNumber(firstValue(records, ["dailyQuota", "daily_quota"])),
    usedToday: asOptionalNumber(firstValue(records, ["usedToday", "used_today"]))
  };
};

const getUser = async (session: OAuthSession): Promise<OAuthUser | undefined> => {
  const payload = await fetchJson<unknown>(baseUrl("/api/oauth/userinfo"), {
    headers: { Authorization: `${session.tokenType} ${session.accessToken}` }
  });
  return normalizeUser(payload);
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

export const startOAuthLogin = async (): Promise<OAuthSession> => {
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
    timer: setTimeout(() => {
      finishPending(pending);
      rejectLogin(new Error("登录等待超时"));
    }, oauthConfig.loginTimeoutMs)
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
    await shell.openExternal(authorizeUrl.toString());
  } catch (error) {
    finishPending(pending);
    rejectLogin(error instanceof Error ? error : new Error("无法打开系统浏览器"));
  }
  return result;
};

export const getOAuthStatus = async (): Promise<OAuthStatus> => {
  const session = await peekOAuthSession();
  if (!session) return { loggedIn: false };
  if (session.expiresAt <= Date.now()) {
    await clearOAuthSession();
    return { loggedIn: false, expired: true };
  }
  if (!session.user) {
    try {
      session.user = await getUser(session);
      if (session.user) await writeOAuthSession(session);
    } catch {
      await clearOAuthSession();
      return { loggedIn: false };
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
  // 学习平台的登录态留在默认会话里，不清掉相当于没退出
  try {
    await electronSession.defaultSession.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
  } catch (error) {
    console.error("清理本地会话数据失败", error);
  }
};
