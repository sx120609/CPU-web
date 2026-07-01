const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("courseBot", {
  // 平台登录
  ssoBegin: () => ipcRenderer.invoke("coursebot:sso-begin"),
  ssoLogin: (args) => ipcRenderer.invoke("coursebot:sso-login", args),
  loadToken: () => ipcRenderer.invoke("coursebot:load-token"),
  clearToken: () => ipcRenderer.invoke("coursebot:clear-token"),
  getQuota: () => ipcRenderer.invoke("coursebot:get-quota"),
  heartbeat: () => ipcRenderer.invoke("coursebot:heartbeat"),

  // 学习通
  chaoxingLogin: (phone, password) =>
    ipcRenderer.invoke("coursebot:chaoxing-login", { phone, password }),
  chaoxingLogout: () => ipcRenderer.invoke("coursebot:chaoxing-logout"),
  chaoxingStatus: () => ipcRenderer.invoke("coursebot:chaoxing-status"),
  getCourses: () => ipcRenderer.invoke("coursebot:get-courses"),
  getChapters: (courseId, clazzId, cpi) =>
    ipcRenderer.invoke("coursebot:get-chapters", { courseId, clazzId, cpi }),

  // 刷课控制
  startCourse: (courseId, clazzId, cpi, chapters) =>
    ipcRenderer.invoke("coursebot:start-course", { courseId, clazzId, cpi, chapters }),
  stopCourse: () => ipcRenderer.invoke("coursebot:stop-course"),
  showChaoxingWindow: () => ipcRenderer.invoke("coursebot:show-chaoxing-window"),

  // 进度监听
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("coursebot:progress", handler);
    return () => ipcRenderer.removeListener("coursebot:progress", handler);
  },
});
