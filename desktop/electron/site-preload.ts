import { contextBridge, ipcRenderer } from "electron";

// 主站内容视图的原生桥，全局名 CPUDesktop。
// 沿用 web/src/utils/nativeBridge.ts 对 CPUAndroid / CPUHarmony 的约定：
// 同步方法用 additionalArguments 传进来的值，不走 IPC。
//
// 这里刻意只暴露"站点自己需要知道的事"。校园网、刷题设置、运行日志这些
// 都归应用外壳（shell-preload.ts）管，站点页面拿不到 —— 那些是客户端的能力，
// 不该从一个网页里操作。

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

  // 站点可以请求打开受支持的网课平台标签，但不能读写客户端设置或凭据。
  // 平台 ID 仍由主进程白名单校验，网页不能借此导航到任意地址。
  openLearning: (platformId?: string) => ipcRenderer.invoke("learning:open", platformId),
  getAuthStatus: () => ipcRenderer.invoke("oauth:status")
});
