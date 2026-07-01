const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("courseBot", {
  // 平台登录
  ssoBegin: () => ipcRenderer.invoke("coursebot:sso-begin"),
  ssoLogin: (args) => ipcRenderer.invoke("coursebot:sso-login", args),
  loadToken: () => ipcRenderer.invoke("coursebot:load-token"),
  clearToken: () => ipcRenderer.invoke("coursebot:clear-token"),
  getQuota: () => ipcRenderer.invoke("coursebot:get-quota"),
  heartbeat: () => ipcRenderer.invoke("coursebot:heartbeat"),

  // 凭据持久化
  saveCredentials: (key, data) =>
    ipcRenderer.invoke("coursebot:save-credentials", { key, data }),
  loadCredentials: (key) => ipcRenderer.invoke("coursebot:load-credentials", key),
  clearCredentials: (key) => ipcRenderer.invoke("coursebot:clear-credentials", key),

  // 学习通 - 官方页面登录
  chaoxingOpenLogin: () => ipcRenderer.invoke("coursebot:chaoxing-open-login"),
  onChaoxingLoginSuccess: (cb) => {
    const handler = (_e, user) => cb(user);
    ipcRenderer.on("coursebot:chaoxing-login-success", handler);
    return () => ipcRenderer.removeListener("coursebot:chaoxing-login-success", handler);
  },
  // 学习通 - 通用
  chaoxingLogout: () => ipcRenderer.invoke("coursebot:chaoxing-logout"),
  chaoxingStatus: () => ipcRenderer.invoke("coursebot:chaoxing-status"),
  getCourses: () => ipcRenderer.invoke("coursebot:get-courses"),
  getChapters: (courseId, clazzId, cpi) =>
    ipcRenderer.invoke("coursebot:get-chapters", { courseId, clazzId, cpi }),

  // 刷课控制
  openCourse: (courseId, clazzId, cpi) =>
    ipcRenderer.invoke("coursebot:open-course", { courseId, clazzId, cpi }),
  startCourse: () => ipcRenderer.invoke("coursebot:start-course"),
  startCourseAuto: (courseId, clazzId, cpi) =>
    ipcRenderer.invoke("coursebot:start-course-auto", { courseId, clazzId, cpi }),
  stopCourse: () => ipcRenderer.invoke("coursebot:stop-course"),
  showChaoxingWindow: () => ipcRenderer.invoke("coursebot:show-chaoxing-window"),

  // 进度监听
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("coursebot:progress", handler);
    return () => ipcRenderer.removeListener("coursebot:progress", handler);
  },
});
