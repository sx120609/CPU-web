import { defineStore } from "pinia";
import { authApi, type UserInfo, type RegisterPayload } from "@/api/auth";
import { clearToken, getToken, setToken } from "@/api/request";
import { setJwxtToken, clearJwxtToken } from "@/api/jwxt";
import { saveCreds, clearCreds } from "@/utils/credCrypto";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as UserInfo | null,
    token: "",
    ready: false,
    /** SSO 登录流程的临时状态 */
    ssoPendingId: "",
    ssoNeedCaptcha: false,
    ssoCaptchaImage: "",
    ssoError: "",
    ssoLoading: false,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token && !!s.user,
    nickname: (s) => s.user?.nickname ?? "",
    isAdmin: (s) => s.user?.role === "admin",
    isMod: (s) => s.user?.role === "admin" || s.user?.role === "mod",
    needSetupNickname: (s) => !!s.user && (!s.user.nickname || s.user.nickname.trim() === ""),
  },
  actions: {
    hydrate() { this.token = getToken(); },

    async login(username: string, password: string) {
      const { token, user } = await authApi.login({ username, password });
      setToken(token); this.token = token; this.user = user; this.ready = true;
    },

    async register(p: RegisterPayload) {
      const { token, user } = await authApi.register(p);
      setToken(token); this.token = token; this.user = user; this.ready = true;
    },

    async ssoBegin() {
      this.ssoLoading = true;
      this.ssoError = "";
      try {
        const r = await authApi.ssoBegin();
        this.ssoPendingId = r.pendingId;
        this.ssoNeedCaptcha = r.needCaptcha;
        this.ssoCaptchaImage = r.captchaImage ?? "";
      } finally { this.ssoLoading = false; }
    },

    /** 学校 SSO 登录：同时获得站内 JWT + 教务 jwxt token */
    async ssoLogin(username: string, password: string, captcha: string | undefined, remember: boolean): Promise<boolean> {
      this.ssoLoading = true;
      this.ssoError = "";
      try {
        const r = await authApi.ssoLogin({
          pendingId: this.ssoPendingId, username, password, captcha,
        });
        if (!r.ok || !r.siteToken || !r.user) {
          this.ssoError = r.error || "登录失败";
          if (r.needCaptcha && r.captcha) {
            this.ssoPendingId = r.captcha.pendingId;
            this.ssoCaptchaImage = r.captcha.image;
            this.ssoNeedCaptcha = true;
          }
          return false;
        }
        setToken(r.siteToken);
        this.token = r.siteToken;
        this.user = r.user;
        this.ready = true;
        // 教务 token 同步存到 sessionStorage（用户进入 /jwxt /services 自动可用）
        if (r.jwxtToken) setJwxtToken(r.jwxtToken);
        // 记住凭据（本地加密，下次自动登录）
        if (remember) {
          try { await saveCreds(username, password); } catch { /* ignore */ }
        }
        this.ssoNeedCaptcha = false;
        this.ssoCaptchaImage = "";
        this.ssoPendingId = "";
        return true;
      } finally { this.ssoLoading = false; }
    },

    async fetchMe() {
      if (!this.token) return;
      try { this.user = await authApi.me(); } catch { /* 401 由拦截器处理 */ }
      finally { this.ready = true; }
    },

    async updateProfile(patch: Partial<UserInfo>) {
      const u = await authApi.updateMe(patch);
      this.user = u;
      return u;
    },

    async logout() {
      try { await authApi.logout(); } catch { /* ignore */ }
      clearToken(); this.token = ""; this.user = null; this.ready = false;
      // 同时清掉本地保存的学校账号凭据 + 教务 token，
      // 否则回到 /login 时 onMounted 会读 hasCreds() 立刻自动登录
      clearCreds();
      clearJwxtToken();
    },
  },
});
