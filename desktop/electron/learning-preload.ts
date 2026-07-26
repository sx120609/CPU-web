import { contextBridge, ipcRenderer } from "electron";

// 全局名同时出现在 electron/main.ts 的 createInjection() 里，改名要两边一起改
// （sandbox:true 的 preload 不能 require 本地模块，所以只能重复这个字面量）。
//
// 每次调用都必须带上主进程注入时下发的一次性 nonce：仅仅暴露这个对象不构成授权，
// 主进程会同时校验 nonce、发起 frame 的 URL 与 webContents 归属。
contextBridge.exposeInMainWorld("cpuDesktopBridge", {
  fetchText: (nonce: string, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; responseType?: string; timeout?: number }) =>
    ipcRenderer.invoke("userscript:fetch-text", nonce, url, options),
  requestAi: (nonce: string, body: string) => ipcRenderer.invoke("userscript:request-ai", nonce, body),
  // 脚本改了自己的配置时回传，让客户端界面与脚本保持同一份真相
  setValue: (nonce: string, key: string, json: string) => ipcRenderer.invoke("userscript:set-value", nonce, key, json),
  // 脚本的运行状态与日志，转发到客户端显示
  report: (nonce: string, payload: string) => ipcRenderer.invoke("userscript:report", nonce, payload)
});
