import { defineStore } from "pinia";
import {
  jwxtApi,
  getJwxtToken,
  getJwxtAuthGeneration,
  setJwxtToken,
  clearJwxtToken,
  isJwxtAuthFailure,
  jwxtNotAuthorizedError,
  JWXT_AUTH_EXPIRED_EVENT,
  JWXT_COOKIE_SESSION_MARKER,
  type JwxtRequestError,
} from "@/api/jwxt";
import { clearCreds, hasCreds } from "@/utils/credCrypto";
import { useAuthStore } from "@/stores/auth";
import { clearJwxtDataCaches } from "@/utils/jwxtCache";
import {
  prepareManualJwxtReauthorization,
  repairUnavailableJwxtSession,
  retryJwxtAuthorization,
  shouldAutoRecoverJwxtSession,
  type JwxtAuthorizationRetryResult,
} from "@/utils/jwxtSessionRepair";

let authExpiredListenerInstalled = false;
let jwxtStatusRefreshInFlight: Promise<void> | null = null;
let jwxtEnsureSessionInFlight: Promise<boolean> | null = null;
let jwxtSessionRecoveryInFlight: Promise<boolean> | null = null;
/** 上次静默恢复失败的时间；刚失败过就先不再试，连续登录会让学校要求验证码。 */
let lastRecoveryFailedAt = 0;
/** 上次静默恢复成功的时间；刚恢复完又失效，说明问题不在会话，别再反复登录。 */
let lastRecoveredAt = 0;
const RECOVERY_RETRY_MS = 60_000;
const RECOVERY_REPEAT_MS = 30_000;

function justLoggedOutThisSession() {
  try {
    return sessionStorage.getItem("cpu-just-logged-out") === "1";
  } catch {
    return false;
  }
}

function markLoggedOutThisSession() {
  try { sessionStorage.setItem("cpu-just-logged-out", "1"); } catch { /* ignore */ }
}

function clearLoggedOutThisSession() {
  try { sessionStorage.removeItem("cpu-just-logged-out"); } catch { /* ignore */ }
}

function isJwxtAuthExpired(error: unknown) {
  return isJwxtAuthFailure(error);
}

/**
 * 教务 jwxt store —— 现在是 auth store 的薄包装。
 *
 * 原本两套登录（/auth/sso-login 与 /jwxt/login）是分开的：在教务页登录后，
 * 站内账号并不会同步登录，用户得再去 /login 走一次，体验割裂。
 * 现在统一改成 **复用 useAuthStore 的 ssoLogin** —— 一次操作同时建立：
 *   • 服务端站内身份 + 自动建/查 User
 *   • 服务端教务会话（浏览器只持有 HttpOnly 会话 Cookie）
 * 本 store 保留主要是为了让 /jwxt 页面、SchedulePane、IServicePane 等老组件
 * 不用大改：它们读 jwxt.isLoggedIn / jwxt.error / jwxt.needCaptcha / jwxt.captchaImage
 * 等状态，本 store 把这些代理到 auth store。
 */
export const useJwxtStore = defineStore("jwxt", {
  state: () => ({
    token: "",
    active: false,
    rememberSaved: false,
    authorizationExpired: false,
    /** 正在用保存的凭据静默恢复；这期间界面不提示授权失效。 */
    recovering: false,
    /** 每恢复成功一次加一，页面据此重新加载数据。 */
    recoveryVersion: 0,
  }),
  getters: {
    isLoggedIn: (s) => s.active && !!s.token,
    /** 确实需要用户重新授权：失效了，而且没有在静默恢复。界面只看这个。 */
    needsReauthorization: (s) => s.authorizationExpired && !s.recovering,
    // 把 auth store 的 SSO 流程态代理出来，供模板 v-if / v-model 直接绑定
    error(): string {
      return useAuthStore().ssoError;
    },
    loading(): boolean {
      return useAuthStore().ssoLoading;
    },
    needCaptcha(): boolean {
      return useAuthStore().ssoNeedCaptcha;
    },
    captchaImage(): string {
      return useAuthStore().ssoCaptchaImage;
    },
    pendingId(): string {
      return useAuthStore().ssoPendingId;
    },
    isGraduateIdentity(): boolean {
      return useAuthStore().academicIdentity === "graduate";
    },
  },
  actions: {
    hydrate() {
      this.token = getJwxtToken();
      // 站内独立账号可能没有任何学校侧会话；不要为这类账号伪造 JWXT 标记，
      // 否则教务启动会把缺失的教务记录当成过期会话并不断重试。
      const auth = useAuthStore();
      if (!this.authorizationExpired && !this.token && auth.token && auth.user?.studentSso !== false) {
        setJwxtToken(JWXT_COOKIE_SESSION_MARKER, { renewed: false });
        this.token = JWXT_COOKIE_SESSION_MARKER;
      }
      if (this.token) this.active = true;
      this.rememberSaved = hasCreds();
      if (!authExpiredListenerInstalled) {
        authExpiredListenerInstalled = true;
        window.addEventListener(JWXT_AUTH_EXPIRED_EVENT, (event) => {
          const store = useJwxtStore();
          store.token = "";
          store.active = false;
          store.authorizationExpired = true;
          // 哪里发现失效就在哪里恢复，不用等用户去教务页。和发起请求的重试共用同一次恢复。
          const generation = (event as CustomEvent<{ generation?: number }>).detail?.generation;
          void store.recoverSession(generation);
        });
      }
    },
    async refreshStatus() {
      if (jwxtStatusRefreshInFlight) return jwxtStatusRefreshInFlight;
      const task = (async () => {
        const auth = useAuthStore();
        // The JWXT marker is deliberately cleared after an education session
        // expires. A signed-in site account can still restore the HttpOnly
        // school cookie, so status must be probed even when the marker is
        // missing. Independent site accounts have no school session to probe.
        if (auth.token && !auth.user) await auth.fetchMe({ probe: true });
        if (!auth.isLoggedIn || auth.user?.studentSso === false) {
          this.active = false;
          return;
        }
        try {
          const r = await jwxtApi.status({ silent: true });
          const currentUsername = auth.user?.username;
          if (r.username && currentUsername && r.username !== currentUsername) {
            clearJwxtToken();
            clearJwxtDataCaches();
            this.token = "";
            this.active = false;
            return;
          }
          this.active = r.active;
          if (!r.active) {
            // 会话过期不等于本地数据失效：保留课表/成绩缓存供秒开和离线查看。
            clearJwxtToken();
            this.token = "";
            this.authorizationExpired = true;
            auth.clearAcademicIdentityUnavailable();
            // 同一轮里就开始恢复，界面不会先闪一下“授权已失效”。
            void this.recoverSession();
          } else {
            const wasExpired = this.authorizationExpired;
            // 状态检查只说明服务端还存着会话，不是新登录：不换代次。
            if (getJwxtToken() !== JWXT_COOKIE_SESSION_MARKER) setJwxtToken(JWXT_COOKIE_SESSION_MARKER, { renewed: false });
            this.token = JWXT_COOKIE_SESSION_MARKER;
            this.authorizationExpired = false;
            // 会话在别处（另一个标签页、教务页）续上了，页面也要重新加载。
            if (wasExpired) this.recoveryVersion += 1;
            await auth.detectAcademicIdentity({
              force: true,
              silent: true,
              fallback: auth.academicIdentity,
            });
            void this.refreshWidgetTokens();
          }
        } catch (error) {
          if (isJwxtAuthExpired(error)) {
            this.active = false;
            this.token = "";
            this.authorizationExpired = true;
            useAuthStore().clearAcademicIdentityUnavailable();
          } else {
            // A status probe failing because of a network outage is not proof
            // that the education session expired. Keep a known marker and do
            // not turn a transient outage into the native login state.
            const marker = getJwxtToken();
            this.token = marker;
            this.active = Boolean(marker) || this.active;
          }
        }
      })();
      jwxtStatusRefreshInFlight = task;
      try {
        await task;
      } finally {
        if (jwxtStatusRefreshInFlight === task) jwxtStatusRefreshInFlight = null;
      }
    },
    async beginLogin(options?: { silent?: boolean }) {
      // 复用 auth store：拿 lt/execution + 可能的验证码
      await useAuthStore().ssoBegin({ silent: options?.silent });
    },
    /**
     * 提交账号密码：走 auth.ssoLogin —— 一次同时完成站内登录 + 教务授权
     */
    async submitLogin(
      username: string,
      password: string,
      captcha: string | undefined,
      remember: boolean,
      options?: { silent?: boolean },
    ): Promise<boolean> {
      const auth = useAuthStore();
      const ok = await auth.ssoLogin(username, password, captcha, remember, { silent: options?.silent });
      if (ok) {
        // auth.ssoLogin 已建立服务端教务会话；这里同步不含秘密的本地状态标记。
        this.token = getJwxtToken();
        this.active = !!this.token;
        this.authorizationExpired = false;
        clearLoggedOutThisSession();
        if (remember) this.rememberSaved = hasCreds();
        this.recoveryVersion += 1;
        void this.refreshWidgetTokens();
        return true;
      }
      // 失败：auth store 已经把错误/验证码状态 setattr 好，本 store 的 getter 会代理出来
      return false;
    },
    /** 用本地保存的账号悄悄走一遍统一登录 */
    async tryAutoLogin(options?: { silent?: boolean; force?: boolean }): Promise<boolean> {
      if (!options?.force && justLoggedOutThisSession()) return false;
      const auth = useAuthStore();
      if (auth.academicIdentityUnavailable && auth.user?.studentSso) return false;
      // Agent 重启后旧会话会返回 401；拦截器会清除内存状态，避免误判为在线。
      if (!getJwxtToken()) {
        this.token = "";
        this.active = false;
      }
      if (this.active && auth.isLoggedIn) return true;
      try {
        const ok = await useAuthStore().tryAutoSsoLogin({ silent: options?.silent });
        this.rememberSaved = hasCreds();
        if (!ok) return false;
        this.token = getJwxtToken();
        this.active = !!this.token;
        if (this.active) {
          this.authorizationExpired = false;
          clearLoggedOutThisSession();
        }
        if (this.active) void this.refreshWidgetTokens();
        return this.active;
      } catch {
        return false;
      }
    },
    async ensureSession(options?: {
      refresh?: boolean;
      forceLogin?: boolean;
      silent?: boolean;
      allowAutoLogin?: boolean;
      repairUnavailableSession?: boolean;
    }): Promise<boolean> {
      if (!options?.forceLogin && jwxtEnsureSessionInFlight) return jwxtEnsureSessionInFlight;
      const task = (async () => {
        this.rememberSaved = hasCreds();
        const auth = useAuthStore();
        // 验活与 SSO 表单准备并行：真过期时可以少等一次 Agent/学校往返。
        const allowAutoLogin = options?.allowAutoLogin !== false;
        // 普通页面初始化只探测现有会话；但学校明确返回“会话过期”时，
        // 应兑现保持登录，用本机加密保存的凭据自动恢复。
        if ((options?.refresh || this.authorizationExpired) && auth.isLoggedIn) {
          await this.refreshStatus().catch(() => undefined);
        }
        if (auth.academicIdentityUnavailable && auth.user?.studentSso && !options?.forceLogin) {
          if (options?.repairUnavailableSession) {
            const repaired = await this.repairUnavailableSession({ silent: options?.silent });
            if (repaired) return true;
          }
          return false;
        }
        if (this.active && this.token && !options?.forceLogin) return true;
        if (!shouldAutoRecoverJwxtSession({
          allowAutoLogin,
          authorizationExpired: this.authorizationExpired,
          hasSavedCredentials: this.rememberSaved,
        })) return false;
        return this.recoverSession(undefined, { force: options?.forceLogin });
      })();
      if (!options?.forceLogin) jwxtEnsureSessionInFlight = task;
      try {
        return await task;
      } finally {
        if (jwxtEnsureSessionInFlight === task) jwxtEnsureSessionInFlight = null;
      }
    },
    async repairUnavailableSession(options?: { silent?: boolean }): Promise<boolean> {
      const auth = useAuthStore();
      if (!auth.user?.studentSso || !auth.academicIdentityUnavailable) return false;
      return repairUnavailableJwxtSession({
        username: auth.user.username,
        disconnect: () => jwxtApi.logout(),
        resetLocalState: () => {
          clearJwxtToken();
          this.token = "";
          this.active = false;
          this.authorizationExpired = false;
          this.rememberSaved = hasCreds();
          auth.clearAcademicIdentityUnavailable();
        },
        hasSavedCredentials: () => this.rememberSaved,
        autoLogin: () => this.tryAutoLogin({ silent: options?.silent }),
      });
    },
    async prepareManualReauthorization(): Promise<void> {
      const auth = useAuthStore();
      await prepareManualJwxtReauthorization({
        disconnect: () => jwxtApi.logout(),
        resetLocalState: () => {
          clearJwxtToken();
          this.token = "";
          this.active = false;
          this.authorizationExpired = false;
          this.rememberSaved = hasCreds();
          auth.clearAcademicIdentity();
        },
      });
    },
    async retryAuthorization(options?: { silent?: boolean }): Promise<JwxtAuthorizationRetryResult> {
      const auth = useAuthStore();
      return retryJwxtAuthorization({
        disconnect: () => jwxtApi.logout(),
        resetLocalState: () => {
          clearJwxtToken();
          this.token = "";
          this.active = false;
          this.authorizationExpired = false;
          this.rememberSaved = hasCreds();
          auth.clearAcademicIdentity();
        },
        hasSavedCredentials: () => this.rememberSaved,
        autoLogin: async () => {
          const restored = await this.tryAutoLogin({ silent: options?.silent, force: true });
          this.rememberSaved = hasCreds();
          return restored;
        },
        needsCaptcha: () => this.needCaptcha && this.rememberSaved,
        prepareLogin: () => this.beginLogin({ silent: options?.silent }),
      });
    },
    /**
     * 全站唯一的静默恢复入口：用本机加密保存的账号重新走一次统一认证。
     * 同一时间只登录一次；失败的请求发出之后会话已经被续上时，直接让它重试。
     * failedGeneration 是失败请求发出时的会话代次。
     */
    recoverSession(failedGeneration?: number, options: { force?: boolean } = {}): Promise<boolean> {
      if (failedGeneration !== undefined && failedGeneration !== getJwxtAuthGeneration() && getJwxtToken()) {
        return Promise.resolve(true);
      }
      if (jwxtSessionRecoveryInFlight) return jwxtSessionRecoveryInFlight;
      const auth = useAuthStore();
      this.rememberSaved = hasCreds();
      if (
        !this.rememberSaved
        || !auth.isLoggedIn
        || auth.user?.studentSso === false
        || (!options.force && justLoggedOutThisSession())
        || (auth.academicIdentityUnavailable && auth.user?.studentSso)
      ) return Promise.resolve(false);
      const now = Date.now();
      if (!options.force && (now - lastRecoveryFailedAt < RECOVERY_RETRY_MS || now - lastRecoveredAt < RECOVERY_REPEAT_MS)) {
        return Promise.resolve(false);
      }
      // 同步置上，调用方（包括失效事件）这一轮里界面就知道在恢复，不会先弹提示。
      this.recovering = true;
      const task = (async () => {
        try {
          this.active = false;
          const ok = await this.tryAutoLogin({ silent: true, force: options.force });
          if (ok) {
            lastRecoveredAt = Date.now();
            lastRecoveryFailedAt = 0;
            this.recoveryVersion += 1;
          } else {
            lastRecoveryFailedAt = Date.now();
          }
          return ok;
        } catch {
          lastRecoveryFailedAt = Date.now();
          return false;
        }
      })();
      jwxtSessionRecoveryInFlight = task;
      void task.finally(() => {
        if (jwxtSessionRecoveryInFlight === task) {
          jwxtSessionRecoveryInFlight = null;
          this.recovering = false;
        }
      });
      return task;
    },
    /** 等正在进行的静默恢复结束；没有在恢复时立刻返回。 */
    async waitForRecovery(): Promise<void> {
      if (jwxtSessionRecoveryInFlight) await jwxtSessionRecoveryInFlight.catch(() => false);
    },
    async withSessionRetry<T>(task: () => Promise<T>): Promise<T> {
      await this.waitForRecovery();
      const ready = await this.ensureSession();
      if (!ready) throw jwxtNotAuthorizedError();
      try {
        return await task();
      } catch (error) {
        if (!isJwxtAuthExpired(error)) throw error;
        const recovered = await this.recoverSession((error as JwxtRequestError).authGeneration);
        if (!recovered) throw error;
        return task();
      }
    },
    async refreshWidgetTokens() {
      const auth = useAuthStore();
      if (
        !this.token
        || !this.active
        || !auth.isLoggedIn
        || (auth.academicIdentityUnavailable && auth.user?.studentSso)
      ) return;
      try { await jwxtApi.refreshScheduleWidgetTokens({ silent: true }); }
      catch { /* 小组件续期是兜底能力，不影响主流程 */ }
    },
    forgetSavedCreds() {
      clearCreds();
      this.rememberSaved = false;
    },
    async logout() {
      const serverLogoutTask = this.token
        ? jwxtApi.logout().catch(() => undefined)
        : Promise.resolve();
      // Clear local state before waiting on the remote education service so a
      // pending recovery cannot immediately recreate the session.
      clearJwxtToken();
      this.token = "";
      this.active = false;
      this.authorizationExpired = false;
      markLoggedOutThisSession();
      await serverLogoutTask;
      // 默认不删 saved creds；当前标签页不再自动恢复，手动登录仍可继续使用。
      // 站内会话由 useAuthStore().logout() 单独处理（这里不动）
    },
  },
});
