import { defineStore } from "pinia";
import { jwxtApi, getJwxtToken, clearJwxtToken, JWXT_AUTH_EXPIRED_EVENT } from "@/api/jwxt";
import { clearCreds, hasCreds, loadCreds } from "@/utils/credCrypto";
import { useAuthStore } from "@/stores/auth";
import { clearJwxtDataCaches } from "@/utils/jwxtCache";

let authExpiredListenerInstalled = false;

/**
 * 教务 jwxt store —— 现在是 auth store 的薄包装。
 *
 * 原本两套登录（/auth/sso-login 与 /jwxt/login）是分开的：在教务页登录后，
 * 站内账号并不会同步登录，用户得再去 /login 走一次，体验割裂。
 * 现在统一改成 **复用 useAuthStore 的 ssoLogin** —— 一次操作同时拿到：
 *   • 站内 JWT（auth.token）+ 自动建/查 User
 *   • 教务 session token（写到 sessionStorage 由 jwxt API 拦截器自动带）
 * 本 store 保留主要是为了让 /jwxt 页面、SchedulePane、IServicePane 等老组件
 * 不用大改：它们读 jwxt.isLoggedIn / jwxt.error / jwxt.needCaptcha / jwxt.captchaImage
 * 等状态，本 store 把这些代理到 auth store。
 */
export const useJwxtStore = defineStore("jwxt", {
  state: () => ({
    token: "",
    active: false,
    autoLoginTried: false,
    rememberSaved: false,
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
      if (this.token) this.active = true;
      this.rememberSaved = hasCreds();
      if (!authExpiredListenerInstalled) {
        authExpiredListenerInstalled = true;
        window.addEventListener(JWXT_AUTH_EXPIRED_EVENT, () => {
          const store = useJwxtStore();
          store.token = "";
          store.active = false;
          store.autoLoginTried = false;
        });
      }
    },
    async refreshStatus() {
      if (!this.token) {
        this.active = false;
        return;
      }
      try {
        const auth = useAuthStore();
        if (auth.token && !auth.user) await auth.fetchMe();
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
          clearJwxtToken();
          clearJwxtDataCaches();
          this.token = "";
        } else {
          await auth.detectAcademicIdentity({
            force: true,
            silent: true,
            fallback: auth.academicIdentity,
          });
          void this.refreshWidgetTokens();
        }
      } catch {
        this.active = false;
        if (!getJwxtToken()) {
          this.token = "";
          this.autoLoginTried = false;
        }
      }
    },
    async beginLogin() {
      // 复用 auth store：拿 lt/execution + 可能的验证码
      await useAuthStore().ssoBegin();
    },
    /**
     * 提交账号密码：走 auth.ssoLogin —— 一次同时完成站内登录 + 教务授权
     */
    async submitLogin(
      username: string,
      password: string,
      captcha: string | undefined,
      remember: boolean,
    ): Promise<boolean> {
      const auth = useAuthStore();
      const ok = await auth.ssoLogin(username, password, captcha, remember);
      if (ok) {
        // jwxt token 已经被 auth.ssoLogin 写入 sessionStorage；这里同步本地 state
        this.token = getJwxtToken();
        this.active = !!this.token;
        if (remember) this.rememberSaved = hasCreds();
        void this.refreshWidgetTokens();
        return true;
      }
      // 失败：auth store 已经把错误/验证码状态 setattr 好，本 store 的 getter 会代理出来
      return false;
    },
    /** 用本地保存的账号悄悄走一遍统一登录 */
    async tryAutoLogin(options?: { force?: boolean }): Promise<boolean> {
      // Agent 重启后旧会话会返回 401；拦截器已清除 sessionStorage，
      // 这里同步 Pinia 状态，避免把已失效 token 误判成仍然在线。
      if (!getJwxtToken()) {
        this.token = "";
        this.active = false;
      }
      if (this.autoLoginTried && !options?.force) return false;
      this.autoLoginTried = true;
      if (this.active && useAuthStore().isLoggedIn) return true;
      const creds = await loadCreds().catch(() => null);
      if (!creds) return false;
      try {
        await this.beginLogin();
        if (this.needCaptcha) {
          // 自动登录无法过验证码，让用户手工补
          return false;
        }
        return await this.submitLogin(creds.username, creds.password, undefined, true);
      } catch {
        return false;
      }
    },
    async refreshWidgetTokens() {
      if (!this.token || !this.active || !useAuthStore().isLoggedIn) return;
      try { await jwxtApi.refreshScheduleWidgetTokens({ silent: true }); }
      catch { /* 小组件续期是兜底能力，不影响主流程 */ }
    },
    forgetSavedCreds() {
      clearCreds();
      this.rememberSaved = false;
    },
    async logout() {
      try { await jwxtApi.logout(); } catch { /* ignore */ }
      clearJwxtToken();
      clearJwxtDataCaches();
      this.token = "";
      this.active = false;
      // 注意：默认不删 saved creds，下次还能自动登录
      // 站内会话由 useAuthStore().logout() 单独处理（这里不动）
    },
  },
});
