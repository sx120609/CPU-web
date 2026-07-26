import { contextBridge, ipcRenderer } from "electron";

// 全局名同时出现在 src/home/renderer.js，改名要两边一起改。
contextBridge.exposeInMainWorld("cpuDesktopHome", {
  getOAuthStatus: () => ipcRenderer.invoke("oauth:status"),
  login: () => ipcRenderer.invoke("oauth:login"),
  logout: () => ipcRenderer.invoke("oauth:logout"),
  openLearning: () => ipcRenderer.invoke("learning:open"),
  getAppInfo: () => ipcRenderer.invoke("app:info")
});
