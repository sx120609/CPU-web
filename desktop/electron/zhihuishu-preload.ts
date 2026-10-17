import { contextBridge, ipcRenderer } from "electron";

// This bridge is loaded only by the bundled workbench, never by course websites.
contextBridge.exposeInMainWorld("cpuZhihuishu", {
  request: (action: string, input?: unknown) => ipcRenderer.invoke("zhihuishu:request", action, input),
});
