import { contextBridge, ipcRenderer } from "electron";

/**
 * preload：在 contextIsolation 下安全暴露 IPC 桥接给渲染进程
 * 渲染进程通过 window.courseBot.* 调用，无法直接访问 Node / Electron API
 */
contextBridge.exposeInMainWorld("courseBot", {
  ssoBegin: () => ipcRenderer.invoke("coursebot:sso-begin"),
  ssoLogin: (args) => ipcRenderer.invoke("coursebot:sso-login", args),
  loadToken: () => ipcRenderer.invoke("coursebot:load-token"),
  clearToken: () => ipcRenderer.invoke("coursebot:clear-token"),
  getQuota: () => ipcRenderer.invoke("coursebot:get-quota"),
  heartbeat: () => ipcRenderer.invoke("coursebot:heartbeat"),
  openChaoxing: () => ipcRenderer.invoke("coursebot:open-chaoxing"),
  startAutoPlay: () => ipcRenderer.invoke("coursebot:start-auto-play"),
  stopAutoPlay: () => ipcRenderer.invoke("coursebot:stop-auto-play"),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("coursebot:progress", handler);
    return () => ipcRenderer.removeListener("coursebot:progress", handler);
  },
});
