import { contextBridge, ipcRenderer } from "electron";

// 主站窗口的原生桥，全局名 CPUDesktop。
// 沿用 web/src/utils/nativeBridge.ts 对 CPUAndroid / CPUHarmony 的约定：
// 同步方法用 additionalArguments 传进来的值，不走 IPC；异步能力才用 invoke。
//
// 注意：这个桥只挂在主站窗口上。学习平台窗口用的是 learning-preload.ts 的
// cpuDesktopBridge，两者互不可见 —— 主站拿不到脚本代理，学习平台也拿不到这里的能力。

const argumentValue = (name: string): string => {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
};

const versionName = argumentValue("cpu-desktop-version");
// clientInfo.ts 的 getVersionCode 语义是整数，用主版本号
const versionCode = Number.parseInt(versionName.split(".")[0] || "0", 10) || 0;

contextBridge.exposeInMainWorld("CPUDesktop", {
  platform: "desktop",
  getVersionName: () => versionName,
  getVersionCode: () => versionCode,

  openExternalUrl: (url: string) => {
    void ipcRenderer.invoke("site:open-external", url);
  },
  copyText: (text: string) => {
    void ipcRenderer.invoke("site:copy-text", text);
    return true;
  },

  // 桌面端独有能力
  openLearning: () => ipcRenderer.invoke("learning:open"),
  reloadSite: () => ipcRenderer.invoke("site:reload"),
  getAuthStatus: () => ipcRenderer.invoke("oauth:status"),
  login: () => ipcRenderer.invoke("oauth:login"),
  logout: () => ipcRenderer.invoke("oauth:logout"),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  getPreferences: () => ipcRenderer.invoke("app:get-preferences"),
  setPreferences: (patch: Record<string, unknown>) => ipcRenderer.invoke("app:set-preferences", patch),

  checkUpdate: () => ipcRenderer.invoke("app:check-update"),
  openUpdate: (url: string) => ipcRenderer.invoke("app:open-update", url),
  onUpdateAvailable: (callback: (info: unknown) => void) => {
    ipcRenderer.on("app:update-available", (_event, info) => callback(info));
  },

  // 校园网自动认证。密码只单向进主进程 —— getState 永远不会把它带回来。
  campusNet: {
    getState: () => ipcRenderer.invoke("campus:state"),
    getSettings: () => ipcRenderer.invoke("campus:settings"),
    saveCredential: (studentId: string, password: string) => ipcRenderer.invoke("campus:save-credential", studentId, password),
    clearCredential: () => ipcRenderer.invoke("campus:clear-credential"),
    updateSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke("campus:update-settings", patch),
    loginNow: () => ipcRenderer.invoke("campus:login-now"),
    checkNow: () => ipcRenderer.invoke("campus:check-now"),
    getLogs: (limit?: number) => ipcRenderer.invoke("campus:logs", limit),
    onState: (callback: (state: unknown) => void) => {
      ipcRenderer.on("campus:state-changed", (_event, state) => callback(state));
    },
    onLog: (callback: (entry: unknown) => void) => {
      ipcRenderer.on("campus:log", (_event, entry) => callback(entry));
    }
  }
});
