import { defineStore } from "pinia";
import {
  jwxtApi,
  getJwxtToken,
  setJwxtToken,
  clearJwxtToken,
  isJwxtAuthExpiredResponse,
  JWXT_AUTH_EXPIRED_EVENT,
  JWXT_COOKIE_SESSION_MARKER,
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
  const candidate = error as {
    status?: number;
    message?: string;
    response?: { status?: number; data?: { message?: string } };
  };
  const status = Number(candidate?.status || candidate?.response?.status || 0);
  const message = String(candidate?.message || candidate?.response?.data?.message || "");
  return isJwxtAuthExpiredResponse(status, message);
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
  }),
  getters: {
    isLoggedIn: (s) => s.active && !!s.token,
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
      if (!this.token && auth.token && auth.user?.studentSso !== false) {
        setJwxtToken(JWXT_COOKIE_SESSION_MARKER);
        this.token = JWXT_COOKIE_SESSION_MARKER;
      }
      if (this.token) this.active = true;
      this.rememberSaved = hasCreds();
      if (!authExpiredListenerInstalled) {
        authExpiredListenerInstalled = true;
        window.addEventListener(JWXT_AUTH_EXPIRED_EVENT, () => {
          const store = useJwxtStore();
          store.token = "";
          store.active = false;
          store.authorizationExpired = true;
        });
      }
    },
    async refreshStatus() {
      if (jwxtStatusRefreshInFlight) return jwxtStatusRefreshInFlight;
      const task = (async () => {
        if (!this.token) {
          this.active = false;
          return;
        }
        try {
          const auth = useAuthStore();
          if (auth.token && !auth.user) await auth.fetchMe({ probe: true });
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
          } else {
            setJwxtToken(JWXT_COOKIE_SESSION_MARKER);
            this.token = JWXT_COOKIE_SESSION_MARKER;
            this.authorizationExpired = false;
            await auth.detectAcademicIdentity({
              force: true,
              silent: true,
              fallback: auth.academicIdentity,
            });
            void this.refreshWidgetTokens();
          }
        } catch (error) {
          if (isJwxtAuthExpired(error) || !getJwxtToken()) {
            this.active = false;
            this.token = "";
            this.authorizationExpired = true;
            useAuthStore().clearAcademicIdentityUnavailable();
          } else {
            // 网络抖动时继续乐观使用现有会话；真实查询若返回 401 会触发自动恢复。
            this.token = getJwxtToken();
            this.active = Boolean(this.token);
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
        if (options?.refresh && this.token) {
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
        const recoveryPreparation = auth.ssoPendingId.trim().length < 8
          && !auth.ssoNeedCaptcha
          ? auth.ssoBegin({ silent: true }).catch(() => undefined)
          : null;
        if (recoveryPreparation) await recoveryPreparation;
        return this.tryAutoLogin({ silent: options?.silent });
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
    async recoverSession(): Promise<boolean> {
      if (jwxtSessionRecoveryInFlight) return jwxtSessionRecoveryInFlight;
      const task = (async () => {
        const auth = useAuthStore();
        if (auth.academicIdentityUnavailable && auth.user?.studentSso) return false;
        clearJwxtToken();
        this.token = "";
        this.active = false;
        this.rememberSaved = hasCreds();
        if (!this.rememberSaved) return false;
        return this.tryAutoLogin({ silent: true });
      })();
      jwxtSessionRecoveryInFlight = task;
      try {
        return await task;
      } finally {
        if (jwxtSessionRecoveryInFlight === task) jwxtSessionRecoveryInFlight = null;
      }
    },
    async withSessionRetry<T>(task: () => Promise<T>): Promise<T> {
      const ready = await this.ensureSession();
      if (!ready) throw new Error("请先登录教务系统");
      try {
        return await task();
      } catch (error) {
        if (!isJwxtAuthExpired(error)) throw error;
        const recovered = await this.recoverSession();
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
