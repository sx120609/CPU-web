"use strict";

// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("courseBot", {
  // ── 平台登录 ──
  ssoBegin: () => import_electron.ipcRenderer.invoke("coursebot:sso-begin"),
  ssoLogin: (args) => import_electron.ipcRenderer.invoke("coursebot:sso-login", args),
  loadToken: () => import_electron.ipcRenderer.invoke("coursebot:load-token"),
  clearToken: () => import_electron.ipcRenderer.invoke("coursebot:clear-token"),
  getQuota: () => import_electron.ipcRenderer.invoke("coursebot:get-quota"),
  heartbeat: () => import_electron.ipcRenderer.invoke("coursebot:heartbeat"),
  // ── 凭据持久化 ──
  saveCredentials: (key, data) => import_electron.ipcRenderer.invoke("coursebot:save-credentials", { key, data }),
  loadCredentials: (key) => import_electron.ipcRenderer.invoke("coursebot:load-credentials", key),
  clearCredentials: (key) => import_electron.ipcRenderer.invoke("coursebot:clear-credentials", key),
  // ── 学习通 - 官方页面登录 ──
  chaoxingOpenLogin: () => import_electron.ipcRenderer.invoke("coursebot:chaoxing-open-login"),
  onChaoxingLoginSuccess: (cb) => {
    const handler = (_e, user) => cb(user);
    import_electron.ipcRenderer.on("coursebot:chaoxing-login-success", handler);
    return () => import_electron.ipcRenderer.removeListener("coursebot:chaoxing-login-success", handler);
  },
  // ── 学习通 - 通用 ──
  chaoxingLogout: () => import_electron.ipcRenderer.invoke("coursebot:chaoxing-logout"),
  chaoxingStatus: () => import_electron.ipcRenderer.invoke("coursebot:chaoxing-status"),
  getCourses: () => import_electron.ipcRenderer.invoke("coursebot:get-courses"),
  getChapters: (courseId, clazzId, cpi) => import_electron.ipcRenderer.invoke("coursebot:get-chapters", { courseId, clazzId, cpi }),
  // ── 刷课控制 ──
  openCourse: (courseId, clazzId, cpi) => import_electron.ipcRenderer.invoke("coursebot:open-course", { courseId, clazzId, cpi }),
  startCourse: () => import_electron.ipcRenderer.invoke("coursebot:start-course"),
  startCourseAuto: (courseId, clazzId, cpi) => import_electron.ipcRenderer.invoke("coursebot:start-course-auto", { courseId, clazzId, cpi }),
  stopCourse: () => import_electron.ipcRenderer.invoke("coursebot:stop-course"),
  showChaoxingWindow: () => import_electron.ipcRenderer.invoke("coursebot:show-chaoxing-window"),
  // ── 进度监听 ──
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    import_electron.ipcRenderer.on("coursebot:progress", handler);
    return () => import_electron.ipcRenderer.removeListener("coursebot:progress", handler);
  }
});
