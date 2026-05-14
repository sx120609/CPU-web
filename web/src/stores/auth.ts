import { defineStore } from "pinia";
import { authApi, type UserInfo, type RegisterPayload } from "@/api/auth";
import { clearToken, getToken, setToken } from "@/api/request";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as UserInfo | null,
    token: "",
    ready: false,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token && !!s.user,
    nickname: (s) => s.user?.nickname ?? "",
    isAdmin: (s) => s.user?.role === "admin",
    isMod: (s) => s.user?.role === "admin" || s.user?.role === "mod",
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
    async fetchMe() {
      if (!this.token) return;
      try { this.user = await authApi.me(); } catch { /* 401 由拦截器处理 */ }
      finally { this.ready = true; }
    },
    async logout() {
      try { await authApi.logout(); } catch { /* ignore */ }
      clearToken(); this.token = ""; this.user = null; this.ready = false;
    },
  },
});
