import { defineStore } from "pinia";
import { authApi, type UserInfo, type RegisterPayload } from "@/api/auth";
import { clearToken, getToken, setToken } from "@/api/request";
import { setJwxtToken, clearJwxtToken } from "@/api/jwxt";
import { saveCreds } from "@/utils/credCrypto";
import { clearJwxtDataCaches } from "@/utils/jwxtCache";

const DATA_AUTH_KEY_PREFIX = "cpu-data-auth-agreement-v1";

function dataAuthKey(username: string) {
  return `${DATA_AUTH_KEY_PREFIX}:${username}`;
}

function readDataAuthAgreement(username?: string | null) {
  if (!username) return false;
  try {
    return localStorage.getItem(dataAuthKey(username)) !== null;
  } catch {
    return false;
  }
}

function writeDataAuthAgreement(username?: string | null) {
  if (!username) return;
  try {
    localStorage.setItem(dataAuthKey(username), String(Date.now()));
  } catch {
    /* ignore */
  }
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as UserInfo | null,
    token: "",
    ready: false,
    dataAuthAgreed: false,
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
    canAccessForum: (s) => !!s.user && (s.user.role === "admin" || s.user.role === "mod" || s.user.role === "bot" || !!s.user.forumEnabled),
    needSetupNickname: (s) => !!s.user && (!s.user.nickname || s.user.nickname.trim() === ""),
    needDataAuthAgreement: (s) => !!s.user?.studentSso && !s.dataAuthAgreed,
  },
  actions: {
    hydrate() { this.token = getToken(); },

    syncDataAuthAgreement(user?: UserInfo | null) {
      if (user && user.studentSso) {
        this.dataAuthAgreed = readDataAuthAgreement(user.username);
      } else {
        this.dataAuthAgreed = false;
      }
    },

    acceptDataAuthAgreement() {
      if (!this.user?.studentSso) {
        this.dataAuthAgreed = false;
        return;
      }
      writeDataAuthAgreement(this.user.username);
      this.dataAuthAgreed = true;
    },

    async login(username: string, password: string) {
      const { token, user } = await authApi.login({ username, password });
      clearJwxtToken();
      clearJwxtDataCaches();
      setToken(token); this.token = token; this.user = user; this.syncDataAuthAgreement(user); this.ready = true;
    },

    async register(p: RegisterPayload) {
      const { token, user } = await authApi.register(p);
      clearJwxtToken();
      clearJwxtDataCaches();
      setToken(token); this.token = token; this.user = user; this.syncDataAuthAgreement(user); this.ready = true;
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
        this.syncDataAuthAgreement(r.user);
        this.ready = true;
        // 教务 token 同步存到 sessionStorage（用户进入 /jwxt /services 自动可用）
        if (r.jwxtToken) {
          clearJwxtToken();
          clearJwxtDataCaches();
          setJwxtToken(r.jwxtToken);
        }
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
      finally {
        this.syncDataAuthAgreement(this.user);
        this.ready = true;
      }
    },

    async updateProfile(patch: Partial<UserInfo>) {
      const u = await authApi.updateMe(patch);
      this.user = u;
      return u;
    },

    async enableForumAccess(confirmText: string) {
      const user = await authApi.enableForumAccess(confirmText);
      this.user = user;
      return user;
    },

    async logout() {
      try { await authApi.logout(); } catch { /* ignore */ }
      clearToken(); this.token = ""; this.user = null; this.dataAuthAgreed = false; this.ready = false;
      clearJwxtToken();
      clearJwxtDataCaches();
      // 主动退出 → 设一个本会话级标记，避免回到 /login 时被 onMounted 立即自动重登；
      // 但**保留** credCrypto 里"记住的密码"——这样关闭浏览器再打开还能自动登录，
      // 符合"记住此账号"checkbox 的字面承诺。
      // 真正想擦凭据请去 /jwxt 点"忘记账号"。
      try { sessionStorage.setItem("cpu-just-logged-out", "1"); } catch { /* ignore */ }
    },
  },
});
