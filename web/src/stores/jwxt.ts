import { defineStore } from "pinia";
import { jwxtApi, getJwxtToken, setJwxtToken, clearJwxtToken } from "@/api/jwxt";
import { saveCreds, loadCreds, clearCreds, hasCreds } from "@/utils/credCrypto";

export const useJwxtStore = defineStore("jwxt", {
  state: () => ({
    token: "",
    active: false,
    pendingId: "",
    needCaptcha: false,
    captchaImage: "",
    error: "",
    loading: false,
    autoLoginTried: false,
    rememberSaved: false, // 是否本地已保存账号
  }),
  getters: {
    isLoggedIn: (s) => s.active && !!s.token,
  },
  actions: {
    hydrate() {
      this.token = getJwxtToken();
      if (this.token) this.active = true;
      this.rememberSaved = hasCreds();
    },
    async refreshStatus() {
      if (!this.token) {
        this.active = false;
        return;
      }
      try {
        const r = await jwxtApi.status({ silent: true });
        this.active = r.active;
        if (!r.active) { clearJwxtToken(); this.token = ""; }
      } catch { this.active = false; }
    },
    async beginLogin() {
      this.loading = true;
      this.error = "";
      try {
        const r = await jwxtApi.beginLogin({ silent: true });
        this.pendingId = r.pendingId;
        this.needCaptcha = r.needCaptcha;
        this.captchaImage = r.captchaImage ?? "";
      } finally { this.loading = false; }
    },
    async submitLogin(username: string, password: string, captcha: string | undefined, remember: boolean) {
      this.loading = true;
      this.error = "";
      try {
        const r = await jwxtApi.login({ pendingId: this.pendingId, username, password, captcha });
        if (r.token) {
          setJwxtToken(r.token);
          this.token = r.token;
          this.active = true;
          this.needCaptcha = false;
          this.captchaImage = "";
          this.pendingId = "";
          if (remember) {
            try {
              await saveCreds(username, password);
              this.rememberSaved = true;
            } catch (e) {
              console.warn("[jwxt] 保存登录失败:", e);
            }
          } else {
            // 如果之前记住过但这次取消勾选，清掉旧的
            if (this.rememberSaved) {
              clearCreds();
              this.rememberSaved = false;
            }
          }
          return true;
        }
        this.error = r.error || "登录失败";
        if (r.needCaptcha && r.captcha) {
          this.pendingId = r.captcha.pendingId;
          this.captchaImage = r.captcha.image;
          this.needCaptcha = true;
        }
        return false;
      } catch (e: any) {
        this.error = e?.message || "教务数据授权失败，请稍后重试";
        return false;
      } finally { this.loading = false; }
    },
    /** 尝试自动登录：用本地保存的账号悄悄走一遍代登录 */
    async tryAutoLogin(options?: { force?: boolean }): Promise<boolean> {
      if (this.autoLoginTried && !options?.force) return false;
      this.autoLoginTried = true;
      if (this.active) return true;
      const creds = await loadCreds().catch(() => null);
      if (!creds) return false;
      try {
        await this.beginLogin();
        if (this.needCaptcha) {
          // 自动登录无法过验证码，留给用户手工补
          return false;
        }
        return await this.submitLogin(creds.username, creds.password, undefined, true);
      } catch {
        return false;
      }
    },
    forgetSavedCreds() {
      clearCreds();
      this.rememberSaved = false;
    },
    async logout() {
      try { await jwxtApi.logout(); } catch { /* ignore */ }
      clearJwxtToken();
      this.token = "";
      this.active = false;
      // 注意：默认不删 saved creds，下次还能自动登录
    },
  },
});
