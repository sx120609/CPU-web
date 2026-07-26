import { contextBridge, ipcRenderer } from "electron";

// 安装页的桥。全局名同时出现在 src/installer/renderer.js。
// 只有安装态的窗口会加载它 —— 正常运行时这个 preload 根本不参与。

contextBridge.exposeInMainWorld("cpuInstaller", {
  getInfo: () => ipcRenderer.invoke("install:info"),
  install: () => ipcRenderer.invoke("install:run"),
  close: () => ipcRenderer.invoke("install:close"),
  onProgress: (callback: (payload: unknown) => void) => {
    ipcRenderer.on("install:progress", (_event, payload) => callback(payload));
  },
  // 自动更新调起时主进程会发这个，界面直接开始装，不等用户点按钮
  onAutoStart: (callback: () => void) => {
    ipcRenderer.on("install:auto-start", () => callback());
  }
});
