import { contextBridge, ipcRenderer } from "electron";

// 应用外壳（标签栏 + 工具页）的桥。全局名同时出现在 src/shell/renderer.js。
//
// 这个桥只挂在窗口自身的外壳页面上。站点内容与学习通各自跑在 WebContentsView 里，
// 用的是 site-preload / learning-preload，拿不到这里的任何东西。

const on = (channel: string, callback: (payload: any) => void) => {
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
};

contextBridge.exposeInMainWorld("cpuShell", {
  getBootInfo: () => ipcRenderer.invoke("shell:boot"),
  completeOnboarding: (patch: Record<string, unknown>) => ipcRenderer.invoke("app:complete-onboarding", patch),

  tabs: {
    getState: () => ipcRenderer.invoke("tabs:state"),
    activate: (id: string) => ipcRenderer.invoke("tabs:activate", id),
    close: (id: string) => ipcRenderer.invoke("tabs:close", id),
    reload: (id: string) => ipcRenderer.invoke("tabs:reload", id),
    goBack: (id: string) => ipcRenderer.invoke("tabs:go-back", id),
    openLearning: () => ipcRenderer.invoke("tabs:open-learning"),
    onChange: (callback: (state: any) => void) => on("tabs:changed", callback)
  },

  auth: {
    getStatus: () => ipcRenderer.invoke("oauth:status"),
    login: () => ipcRenderer.invoke("oauth:login"),
    logout: () => ipcRenderer.invoke("oauth:logout")
  },

  campusNet: {
    getState: () => ipcRenderer.invoke("campus:state"),
    getSettings: () => ipcRenderer.invoke("campus:settings"),
    saveCredential: (studentId: string, password: string) => ipcRenderer.invoke("campus:save-credential", studentId, password),
    clearCredential: () => ipcRenderer.invoke("campus:clear-credential"),
    updateSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke("campus:update-settings", patch),
    loginNow: () => ipcRenderer.invoke("campus:login-now"),
    checkNow: () => ipcRenderer.invoke("campus:check-now"),
    getLogs: (limit?: number) => ipcRenderer.invoke("campus:logs", limit),
    onState: (callback: (state: any) => void) => on("campus:state-changed", callback),
    onLog: (callback: (entry: any) => void) => on("campus:log", callback)
  },

  script: {
    getConfig: () => ipcRenderer.invoke("script:get-config"),
    setConfig: (patch: Record<string, unknown>) => ipcRenderer.invoke("script:set-config", patch),
    getActivity: (limit?: number) => ipcRenderer.invoke("script:get-activity", limit),
    onActivity: (callback: (entry: any) => void) => on("script:activity", callback)
  },

  preferences: {
    get: () => ipcRenderer.invoke("app:get-preferences"),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke("app:set-preferences", patch)
  },

  update: {
    check: () => ipcRenderer.invoke("app:check-update"),
    open: (url: string) => ipcRenderer.invoke("app:open-update", url),
    onAvailable: (callback: (info: any) => void) => on("app:update-available", callback)
  },

  openExternal: (url: string) => ipcRenderer.invoke("site:open-external", url),
  retrySite: () => ipcRenderer.invoke("site:reload")
});
