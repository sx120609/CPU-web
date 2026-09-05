import { defineStore } from "pinia";
import { authApi, type UserInfo, type RegisterPayload } from "@/api/auth";
import { clearToken, COOKIE_SESSION_MARKER, getToken, hasAuthPresence, setToken } from "@/api/request";
import { jwxtApi, getJwxtToken, setJwxtToken, clearJwxtToken, JWXT_COOKIE_SESSION_MARKER } from "@/api/jwxt";
import { clearCreds, saveCreds } from "@/utils/credCrypto";
import { encryptAgentLoginCredentials } from "@/utils/agentCredentialCrypto";
import { withMediaRevision } from "@/utils/cdnMedia";
import { clearJwxtDataCaches, purgeLegacySensitiveJwxtCaches } from "@/utils/jwxtCache";
import {
  academicIdentityLabel,
  clearAcademicIdentity,
  DEFAULT_ACADEMIC_IDENTITY,
  readAcademicIdentity,
  readAcademicIdentityUnavailable,
  resolveDetectedAcademicIdentity,
  writeAcademicIdentity,
  writeAcademicIdentityUnavailable,
  type AcademicIdentity,
} from "@/utils/academicIdentity";

const DATA_AUTH_KEY_PREFIX = "cpu-data-auth-agreement-v1";

let autoSsoLoginInFlight: Promise<boolean> | null = null;

function isAcademicDataUnavailableError(error: unknown) {
  const candidate = error as {
    status?: unknown;
    message?: unknown;
    response?: { data?: { message?: unknown } };
  } | null | undefined;
  const status = Number(candidate?.status || 0);
  const message = String(candidate?.message || candidate?.response?.data?.message || "");
  return status === 400 && /没有返回可用|暂时没有返回可用|暂无可用教务|没有可用学期列表/.test(message);
}

function clearJustLoggedOutMarker() {
  try { sessionStorage.removeItem("cpu-just-logged-out"); } catch { /* ignore */ }
}

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
    // 学校账号本身可以登录成功，但教务入口暂时还没有数据；单独记录该状态，
    // 避免后台恢复把“无教务数据”误判成过期并无限重试。
    academicIdentityUnavailable: false,
    academicIdentityDetecting: false,
    ready: false,
    dataAuthAgreed: false,
    sessionVersion: 0,
    profileRevision: 0,
    /** SSO 登录流程的临时状态 */
    ssoPendingId: "",
    ssoPendingIssuedAt: 0,
    ssoNeedCaptcha: false,
    ssoCaptchaImage: "",
    ssoCredentialPublicKey: "",
    ssoError: "",
    ssoLoading: false,
    _pendingSsoBegin: null as Promise<void> | null,
    _pendingSsoLogin: null as Promise<boolean> | null,
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
    canAccessForum: () => true,
    needSetupNickname: (s) => !!s.user
      && (!s.user.nickname || s.user.nickname.trim() === "")
      && !(s.user.nicknameReview?.status === "checking" && s.user.nicknameReview.pendingNickname?.trim()),
    needDataAuthAgreement: (s) => !!s.user?.studentSso && !s.dataAuthAgreed,
    isGraduateIdentity: (s) => s.academicIdentity === "graduate",
    academicIdentityLabel: (s) => academicIdentityLabel(s.academicIdentity),
  },
  actions: {
    applyAuthenticatedSession(authToken: string, user: UserInfo) {
      const previousUserId = this.user?.id ?? null;
      const wasLoggedIn = this.isLoggedIn;
      clearJustLoggedOutMarker();
      setToken(authToken, user.id);
      this.token = authToken;
      this.user = user;
      this.syncDataAuthAgreement(user);
      this.academicIdentityUnavailable = Boolean(
        user.studentSso && readAcademicIdentityUnavailable(user.username),
      );
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
      this.clearAcademicIdentityUnavailable();
      writeAcademicIdentity(identity);
    },

    clearAcademicIdentityUnavailable() {
      this.academicIdentityUnavailable = false;
      writeAcademicIdentityUnavailable(this.user?.username, false);
    },

    clearAcademicIdentity() {
      this.academicIdentity = DEFAULT_ACADEMIC_IDENTITY;
      this.academicIdentityResolved = false;
      this.academicIdentityUnavailable = false;
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
      const requestSessionVersion = this.sessionVersion;
      const task = (async () => {
        this.academicIdentityDetecting = true;
        try {
          const result = await jwxtApi.identity({ silent: options?.silent ?? true });
          if (this.sessionVersion !== requestSessionVersion || !this.token) return fallback;
          const resolved = resolveDetectedAcademicIdentity({
            detected: result.identity,
            fallback,
            capabilities: result.capabilities,
          });
          // 两个入口都暂时不可读时不能把服务端的探测兜底值当成真实身份。
          // 保留上次成功身份，确保本科/研究生缓存仍落在原来的分区。
          if (!resolved.unavailable) this.setAcademicIdentity(resolved.identity);
          else this.academicIdentity = resolved.identity;
          this.academicIdentityUnavailable = resolved.unavailable;
          writeAcademicIdentityUnavailable(this.user?.username, this.academicIdentityUnavailable);
          return resolved.identity;
        } catch (error) {
          if (this.sessionVersion !== requestSessionVersion || !this.token) return fallback;
          // Older deployed servers report an authenticated but empty academic
          // entry as a 4000 response. Treat only that explicit no-data message
          // as unavailable; a real 401 still means the session needs recovery.
          this.academicIdentityUnavailable = isAcademicDataUnavailableError(error);
          writeAcademicIdentityUnavailable(this.user?.username, this.academicIdentityUnavailable);
          this.academicIdentity = fallback;
          return fallback;
        } finally {
          if (this.sessionVersion === requestSessionVersion) {
            this.academicIdentityDetecting = false;
            this._pendingIdentityDetection = null;
          }
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
      if (this._pendingSsoBegin) return this._pendingSsoBegin;
      const requestSessionVersion = this.sessionVersion;
      const task = (async () => {
        this.ssoLoading = true;
        this.ssoError = "";
        this.ssoPendingId = "";
        this.ssoPendingIssuedAt = 0;
        this.ssoNeedCaptcha = false;
        this.ssoCaptchaImage = "";
        this.ssoCredentialPublicKey = "";
        try {
          const r = await authApi.ssoBegin(options?.silent ? {
            suppressAuthRedirect: true,
            suppressAuthMessage: true,
            suppressErrorMessage: true,
          } : undefined);
          if (this.sessionVersion !== requestSessionVersion) return;
          this.ssoPendingId = r.pendingId;
          this.ssoPendingIssuedAt = Date.now();
          this.ssoNeedCaptcha = r.needCaptcha;
          this.ssoCaptchaImage = r.captchaImage ?? "";
          this.ssoCredentialPublicKey = r.credentialPublicKey ?? "";
        } finally {
          if (this.sessionVersion === requestSessionVersion) this.ssoLoading = false;
        }
      })();
      this._pendingSsoBegin = task;
      try {
        await task;
      } finally {
        if (this._pendingSsoBegin === task) this._pendingSsoBegin = null;
      }
    },

    /** 学校 SSO 登录：同时获得站内 JWT + 教务 jwxt token */
    async ssoLogin(username: string, password: string, captcha: string | undefined, remember: boolean, options?: { silent?: boolean }): Promise<boolean> {
      if (this._pendingSsoLogin) return this._pendingSsoLogin;
      const requestSessionVersion = this.sessionVersion;
      const task = (async () => {
        this.ssoLoading = true;
        this.ssoError = "";
        try {
        if (this.ssoPendingId.trim().length < 8) {
          await this.ssoBegin({ silent: options?.silent });
          this.ssoLoading = true;
          if (this.ssoNeedCaptcha) {
            this.ssoError = "登录会话已刷新，请输入验证码";
            return false;
          }
        }
        // pending/execution 只能提交一次。发出请求前就从共享状态中取走，避免后台恢复和手动登录复用同一个会话。
        const pendingId = this.ssoPendingId;
        const credentialPublicKey = this.ssoCredentialPublicKey;
        this.ssoPendingId = "";
        this.ssoPendingIssuedAt = 0;
        this.ssoCredentialPublicKey = "";
        const loginOptions = {
          suppressAuthRedirect: true,
          suppressAuthMessage: true,
          suppressErrorMessage: true,
          // A school SSO login can need several redirects on a slow mobile
          // connection. Let the user wait for the actual outcome.
          timeout: 95_000,
        };
        const loginPayload = credentialPublicKey
          ? {
              pendingId,
              credentials: await encryptAgentLoginCredentials(
                credentialPublicKey,
                { username, password, ...(captcha ? { captcha } : {}) },
              ),
              remember,
            }
          : { pendingId, username, password, captcha, remember };
        const r = await authApi.ssoLogin(loginPayload, loginOptions);
        // A manual or background SSO request must not resurrect a session
        // after the user has explicitly logged out while it was pending.
        if (this.sessionVersion !== requestSessionVersion) return false;
        if (!r.ok || (!r.sessionAuthenticated && !r.siteToken) || !r.user) {
          this.ssoError = r.error || "登录失败";
          if (r.needCaptcha && r.captcha) {
            this.ssoPendingId = r.captcha.pendingId;
            this.ssoPendingIssuedAt = Date.now();
            this.ssoCredentialPublicKey = credentialPublicKey;
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
        this.ssoPendingIssuedAt = 0;
        this.ssoCredentialPublicKey = "";
        this.academicIdentityResolved = false;
        await this.detectAcademicIdentity({
          force: true,
          silent: true,
          fallback: this.academicIdentity,
        });
        // No academic entry for a new student is not a failed site login.
        // Keep the station session, JWXT session marker, and saved credentials;
        // the JWXT store only pauses background recovery until data is available.
        return true;
        } catch (error) {
          this.ssoError = (error instanceof Error ? error.message : "") || "登录暂时失败，请稍后再试。";
          return false;
        } finally {
          if (this.sessionVersion === requestSessionVersion) this.ssoLoading = false;
        }
      })();
      this._pendingSsoLogin = task;
      try {
        return await task;
      } finally {
        if (this._pendingSsoLogin === task) this._pendingSsoLogin = null;
      }
    },

    /** Background recovery shares one school SSO submission. */
    async tryAutoSsoLogin(options?: { silent?: boolean }): Promise<boolean> {
      if (this.academicIdentityUnavailable && this.user?.studentSso) return false;
      if (autoSsoLoginInFlight) return autoSsoLoginInFlight;
      const task = (async () => {
        const { loadCreds } = await import("@/utils/credCrypto");
        const creds = await loadCreds().catch(() => null);
        if (!creds) return false;
        try {
          const pendingFresh = this.ssoPendingId.trim().length >= 8
            && this.ssoPendingIssuedAt > 0
            && Date.now() - this.ssoPendingIssuedAt < 45_000;
          if (!pendingFresh) await this.ssoBegin({ silent: options?.silent });
          if (this.ssoNeedCaptcha) return false;
          return await this.ssoLogin(creds.username, creds.password, undefined, true, options);
        } catch {
          return false;
        }
      })();
      autoSsoLoginInFlight = task;
      try {
        return await task;
      } finally {
        if (autoSsoLoginInFlight === task) autoSsoLoginInFlight = null;
      }
    },

    async fetchMe(options?: { probe?: boolean }) {
      if (!this.token && !options?.probe) return;
      if (this._pendingFetchMe) return this._pendingFetchMe;
      const requestSessionVersion = this.sessionVersion;
      const requestProfileRevision = this.profileRevision;
      const task = (async () => {
        try {
          const user = await authApi.me(options?.probe ? {
            suppressAuthRedirect: true,
            suppressAuthMessage: true,
            suppressErrorMessage: true,
          } : undefined);
          // A logout may finish while the probe is in flight. Do not let the
          // stale response restore the session that the user just revoked.
          if (this.sessionVersion === requestSessionVersion && this.profileRevision === requestProfileRevision && this.token) {
            this.applyAuthenticatedSession(COOKIE_SESSION_MARKER, user);
          }
        } catch {
          if (this.sessionVersion !== requestSessionVersion || this.profileRevision !== requestProfileRevision) return;
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
      const requestSessionVersion = this.sessionVersion;
      const userId = this.user?.id;
      const u = await authApi.updateMe(patch);
      if (this.sessionVersion !== requestSessionVersion || this.user?.id !== userId) return u;
      this.profileRevision += 1;
      const next = patch.avatar !== undefined && u.avatar
        ? { ...u, avatar: withMediaRevision(u.avatar, Date.now()) }
        : u;
      this.user = next;
      return next;
    },

    async refreshSelfSilently() {
      const requestSessionVersion = this.sessionVersion;
      const requestProfileRevision = this.profileRevision;
      const userId = this.user?.id;
      if (!this.token || !userId) return null;
      const user = await authApi.me({
        cacheTtlMs: 0,
        cacheStaleTtlMs: 0,
        suppressAuthRedirect: true,
        suppressAuthMessage: true,
        suppressErrorMessage: true,
      }).catch(() => null);
      if (user && this.sessionVersion === requestSessionVersion && this.profileRevision === requestProfileRevision && this.user?.id === userId) {
        this.user = user;
        this.syncDataAuthAgreement(user);
      }
      return user;
    },

    async logout() {
      // Start server-side revocation while the browser cookie/JWXT marker is
      // still available, but invalidate local state immediately. This makes
      // logout responsive and prevents late probes or SSO requests restoring
      // the session the user just ended.
      const siteLogoutTask = authApi.logout().catch(() => undefined);
      const jwxtLogoutTask = getJwxtToken()
        ? jwxtApi.logout().catch(() => undefined)
        : Promise.resolve();
      this.sessionVersion += 1;
      clearToken(); this.token = ""; this.user = null; this.dataAuthAgreed = false; this.ready = false;
      this._pendingFetchMe = null;
      this._pendingSsoBegin = null;
      this._pendingSsoLogin = null;
      this._pendingIdentityDetection = null;
      this.academicIdentityDetecting = false;
      this.ssoLoading = false;
      clearJwxtToken();
      clearJwxtDataCaches();
      this.clearAcademicIdentity();
      // 主动退出 → 设一个本会话级标记，避免回到 /login 时被 onMounted 立即自动重登；
      // 但**保留** credCrypto 里"记住的密码"——这样关闭浏览器再打开还能自动登录，
      // 符合"记住此账号"checkbox 的字面承诺。
      // 真正想擦凭据请去 /jwxt 点"忘记账号"。
      // 主动退出后，本次浏览器会话不再自动使用“记住密码”重登；凭据本身仍保留。
      try { sessionStorage.setItem("cpu-just-logged-out", "1"); } catch { /* ignore */ }
      await Promise.all([siteLogoutTask, jwxtLogoutTask]);
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
      // 临时站内会话过期时保留教务缓存和身份，自动恢复期间仍可正常查看旧数据。
    },
  },
});
