import { defineStore } from "pinia";
import { authApi, type UserInfo, type RegisterPayload } from "@/api/auth";
import { clearToken, COOKIE_SESSION_MARKER, getToken, hasAuthPresence, setToken } from "@/api/request";
import { jwxtApi, setJwxtToken, clearJwxtToken, JWXT_COOKIE_SESSION_MARKER } from "@/api/jwxt";
import { clearCreds, saveCreds } from "@/utils/credCrypto";
import { encryptAgentLoginCredentials } from "@/utils/agentCredentialCrypto";
import { clearJwxtDataCaches, purgeLegacySensitiveJwxtCaches } from "@/utils/jwxtCache";
import {
  academicIdentityLabel,
  clearAcademicIdentity,
  DEFAULT_ACADEMIC_IDENTITY,
  readAcademicIdentity,
  writeAcademicIdentity,
  type AcademicIdentity,
} from "@/utils/academicIdentity";

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
  state: () => {
    const storedIdentity = readAcademicIdentity();
    return ({
    user: null as UserInfo | null,
    token: "",
    academicIdentity: storedIdentity ?? DEFAULT_ACADEMIC_IDENTITY,
    academicIdentityResolved: Boolean(storedIdentity),
    academicIdentityDetecting: false,
    ready: false,
    dataAuthAgreed: false,
    sessionVersion: 0,
    /** SSO 登录流程的临时状态 */
    ssoPendingId: "",
    ssoNeedCaptcha: false,
    ssoCaptchaImage: "",
    ssoCredentialPublicKey: "",
    ssoError: "",
    ssoLoading: false,
    _pendingFetchMe: null as Promise<void> | null,
    _pendingIdentityDetection: null as Promise<AcademicIdentity> | null,
  });
  },
  getters: {
    isLoggedIn: (s) => !!s.token && !!s.user,
    nickname: (s) => s.user?.nickname ?? "",
    isAdmin: (s) => s.user?.role === "admin",
    isMod: (s) => s.user?.role === "admin" || s.user?.role === "mod",
    isVoiceHubAdmin: (s) => s.user?.role === "admin" || s.user?.role === "mod" || !!s.user?.voiceHubRole,
    isVoiceHubSuperAdmin: (s) => s.user?.role === "admin" || s.user?.voiceHubRole === "super_admin",
    isLostFoundAdmin: (s) => s.user?.role === "admin" || s.user?.role === "mod" || !!s.user?.lostFoundRole,
    isLostFoundSuperAdmin: (s) => s.user?.role === "admin" || s.user?.lostFoundRole === "super_admin",
    canAccessModuleAdmin: (s) => s.user?.role === "admin"
      || s.user?.role === "mod"
      || s.user?.voiceHubRole === "super_admin"
      || !!s.user?.lostFoundRole,
    canAccessForum: (s) => !!s.user && (s.user.role === "admin" || s.user.role === "mod" || s.user.role === "bot" || !!s.user.forumEnabled),
    needSetupNickname: (s) => !!s.user && (!s.user.nickname || s.user.nickname.trim() === ""),
    needDataAuthAgreement: (s) => !!s.user?.studentSso && !s.dataAuthAgreed,
    isGraduateIdentity: (s) => s.academicIdentity === "graduate",
    academicIdentityLabel: (s) => academicIdentityLabel(s.academicIdentity),
  },
  actions: {
    applyAuthenticatedSession(authToken: string, user: UserInfo) {
      const previousUserId = this.user?.id ?? null;
      const wasLoggedIn = this.isLoggedIn;
      setToken(authToken);
      this.token = authToken;
      this.user = user;
      this.syncDataAuthAgreement(user);
      this.ready = true;
      if (!wasLoggedIn || previousUserId !== user.id) {
        this.sessionVersion += 1;
      }
    },

    hydrate() {
      purgeLegacySensitiveJwxtCaches();
      const legacyToken = getToken();
      this.token = legacyToken || (hasAuthPresence() ? COOKIE_SESSION_MARKER : "");
      const storedIdentity = readAcademicIdentity();
      this.academicIdentity = storedIdentity ?? DEFAULT_ACADEMIC_IDENTITY;
      this.academicIdentityResolved = Boolean(storedIdentity);
    },

    setAcademicIdentity(identity: AcademicIdentity) {
      this.academicIdentity = identity;
      this.academicIdentityResolved = true;
      writeAcademicIdentity(identity);
    },

    clearAcademicIdentity() {
      this.academicIdentity = DEFAULT_ACADEMIC_IDENTITY;
      this.academicIdentityResolved = false;
      clearAcademicIdentity();
    },

    async detectAcademicIdentity(options?: { force?: boolean; silent?: boolean; fallback?: AcademicIdentity }) {
      if (!getToken() || !this.user?.studentSso) {
        return this.academicIdentity;
      }
      if (this.academicIdentityResolved && !options?.force) {
        return this.academicIdentity;
      }
      if (this._pendingIdentityDetection) return this._pendingIdentityDetection;

      const fallback = options?.fallback ?? this.academicIdentity ?? DEFAULT_ACADEMIC_IDENTITY;
      const task = (async () => {
        this.academicIdentityDetecting = true;
        try {
          const result = await jwxtApi.identity({ silent: options?.silent ?? true });
          this.setAcademicIdentity(result.identity);
          return result.identity;
        } catch {
          this.academicIdentity = fallback;
          return fallback;
        } finally {
          this.academicIdentityDetecting = false;
          this._pendingIdentityDetection = null;
        }
      })();

      this._pendingIdentityDetection = task;
      return task;
    },

    syncDataAuthAgreement(user?: UserInfo | null) {
      if (user && user.studentSso) {
        this.dataAuthAgreed = Boolean(user.dataAuthAgreedAt) || readDataAuthAgreement(user.username);
      } else {
        this.dataAuthAgreed = false;
      }
    },

    async acceptDataAuthAgreement() {
      if (!this.user?.studentSso) {
        this.dataAuthAgreed = false;
        return;
      }
      writeDataAuthAgreement(this.user.username);
      try {
        const updated = await authApi.updateMe({ dataAuthAgreed: true } as any);
        this.user = updated;
      } catch {
        /* ignore */
      }
      this.dataAuthAgreed = true;
    },

    async login(username: string, password: string) {
      const { token, sessionAuthenticated, user } = await authApi.login({ username, password });
      clearJwxtToken();
      clearJwxtDataCaches();
      this.clearAcademicIdentity();
      const authToken = sessionAuthenticated ? COOKIE_SESSION_MARKER : (token || "");
      this.applyAuthenticatedSession(authToken, user);
    },

    async register(p: RegisterPayload) {
      const { token, sessionAuthenticated, user } = await authApi.register(p);
      clearJwxtToken();
      clearJwxtDataCaches();
      this.clearAcademicIdentity();
      const authToken = sessionAuthenticated ? COOKIE_SESSION_MARKER : (token || "");
      this.applyAuthenticatedSession(authToken, user);
    },

    async ssoBegin(options?: { silent?: boolean }) {
      this.ssoLoading = true;
      this.ssoError = "";
      try {
        const r = await authApi.ssoBegin(options?.silent ? {
          suppressAuthRedirect: true,
          suppressAuthMessage: true,
          suppressErrorMessage: true,
        } : undefined);
        this.ssoPendingId = r.pendingId;
        this.ssoNeedCaptcha = r.needCaptcha;
        this.ssoCaptchaImage = r.captchaImage ?? "";
        this.ssoCredentialPublicKey = r.credentialPublicKey ?? "";
      } finally { this.ssoLoading = false; }
    },

    /** 学校 SSO 登录：同时获得站内 JWT + 教务 jwxt token */
    async ssoLogin(username: string, password: string, captcha: string | undefined, remember: boolean, options?: { silent?: boolean }): Promise<boolean> {
      this.ssoLoading = true;
      this.ssoError = "";
      try {
        if (this.ssoPendingId.trim().length < 8) {
          await this.ssoBegin({ silent: options?.silent });
          this.ssoLoading = true;
          if (this.ssoNeedCaptcha && !captcha) {
            this.ssoError = "登录会话已刷新，请输入验证码";
            return false;
          }
        }
        const loginOptions = options?.silent ? {
          suppressAuthRedirect: true,
          suppressAuthMessage: true,
          suppressErrorMessage: true,
        } : undefined;
        const loginPayload = this.ssoCredentialPublicKey
          ? {
              pendingId: this.ssoPendingId,
              credentials: await encryptAgentLoginCredentials(
                this.ssoCredentialPublicKey,
                { username, password, ...(captcha ? { captcha } : {}) },
              ),
              remember,
            }
          : { pendingId: this.ssoPendingId, username, password, captcha, remember };
        const r = await authApi.ssoLogin(loginPayload, loginOptions);
        if (!r.ok || (!r.sessionAuthenticated && !r.siteToken) || !r.user) {
          this.ssoError = r.error || "登录失败";
          if (r.needCaptcha && r.captcha) {
            this.ssoPendingId = r.captcha.pendingId;
            this.ssoCaptchaImage = r.captcha.image;
            this.ssoNeedCaptcha = true;
          }
          return false;
        }
        const authToken = r.sessionAuthenticated ? COOKIE_SESSION_MARKER : (r.siteToken || "");
        this.applyAuthenticatedSession(authToken, r.user);
        // Cookie 会话只保留不含秘密的内存标记；兼容响应中的旧 token 也仅留在内存。
        if (r.jwxtAuthenticated || r.jwxtToken) {
          clearJwxtToken();
          clearJwxtDataCaches();
          setJwxtToken(r.jwxtAuthenticated ? JWXT_COOKIE_SESSION_MARKER : (r.jwxtToken || ""));
        }
        // 记住凭据（本地加密，下次自动登录）
        if (remember) {
          try { await saveCreds(username, password); } catch { /* ignore */ }
        } else {
          clearCreds();
        }
        this.ssoNeedCaptcha = false;
        this.ssoCaptchaImage = "";
        this.ssoPendingId = "";
        this.ssoCredentialPublicKey = "";
        this.academicIdentityResolved = false;
        await this.detectAcademicIdentity({
          force: true,
          silent: true,
          fallback: this.academicIdentity,
        });
        return true;
      } finally { this.ssoLoading = false; }
    },

    async fetchMe(options?: { probe?: boolean }) {
      if (!this.token && !options?.probe) return;
      if (this._pendingFetchMe) return this._pendingFetchMe;
      const task = (async () => {
        try {
          const user = await authApi.me(options?.probe ? {
            suppressAuthRedirect: true,
            suppressAuthMessage: true,
            suppressErrorMessage: true,
          } : undefined);
          this.applyAuthenticatedSession(COOKIE_SESSION_MARKER, user);
        } catch {
          const wasLoggedIn = this.isLoggedIn;
          this.user = null;
          if (wasLoggedIn) this.sessionVersion += 1;
        }
        finally {
          this.syncDataAuthAgreement(this.user);
          this.ready = true;
          this._pendingFetchMe = null;
        }
      })();
      this._pendingFetchMe = task;
      return task;
    },

    async updateProfile(patch: Partial<UserInfo>) {
      const u = await authApi.updateMe(patch);
      this.user = u;
      return u;
    },

    async enableForumAccess(confirmText: string) {
      const user = await authApi.enableForumAccess(confirmText);
      this.user = user;
      this.sessionVersion += 1;
      return user;
    },

    async logout() {
      try { await authApi.logout(); } catch { /* ignore */ }
      const wasLoggedIn = this.isLoggedIn;
      clearToken(); this.token = ""; this.user = null; this.dataAuthAgreed = false; this.ready = false;
      if (wasLoggedIn) this.sessionVersion += 1;
      this._pendingIdentityDetection = null;
      this.academicIdentityDetecting = false;
      clearJwxtToken();
      clearJwxtDataCaches();
      this.clearAcademicIdentity();
      // 主动退出 → 设一个本会话级标记，避免回到 /login 时被 onMounted 立即自动重登；
      // 但**保留** credCrypto 里"记住的密码"——这样关闭浏览器再打开还能自动登录，
      // 符合"记住此账号"checkbox 的字面承诺。
      // 真正想擦凭据请去 /jwxt 点"忘记账号"。
      try { sessionStorage.setItem("cpu-just-logged-out", "1"); } catch { /* ignore */ }
    },

    expireSession() {
      const wasLoggedIn = this.isLoggedIn;
      clearToken();
      this.token = "";
      this.user = null;
      this.dataAuthAgreed = false;
      this.ready = true;
      if (wasLoggedIn) this.sessionVersion += 1;
      this._pendingFetchMe = null;
      this._pendingIdentityDetection = null;
      this.academicIdentityDetecting = false;
      clearJwxtToken();
      clearJwxtDataCaches();
      this.clearAcademicIdentity();
    },
  },
});
