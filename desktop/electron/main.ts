import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "path";
import { saveToken, loadToken, clearToken } from "./store";
import { setAuthToken, ssoBegin, ssoLogin, getQuota, heartbeat } from "./api";
import { startAutoPlay, stopAutoPlay, type ProgressEvent } from "./autoPlay";

let mainWindow: BrowserWindow | null = null;
let chaoxingWindow: BrowserWindow | null = null;
let cachedToken: string | null = null;

function isDev() {
  return process.env.NODE_ENV === "development";
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 400,
    minHeight: 600,
    title: "药大刷课助手",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev()) {
    mainWindow.loadURL("http://localhost:5174");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    stopAutoPlay();
    if (chaoxingWindow && !chaoxingWindow.isDestroyed()) chaoxingWindow.close();
  });
}

function createChaoxingWindow() {
  if (chaoxingWindow && !chaoxingWindow.isDestroyed()) {
    chaoxingWindow.focus();
    return;
  }
  chaoxingWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "学习通 · 请登录并打开课程",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:chaoxing", // 独立 cookie 空间，持久化学习通登录态
    },
  });
  chaoxingWindow.loadURL("https://i.chaoxing.com/");
  chaoxingWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  chaoxingWindow.on("closed", () => {
    chaoxingWindow = null;
    stopAutoPlay();
    sendProgress({ type: "stopped", message: "学习通窗口已关闭" });
  });
}

function sendProgress(e: ProgressEvent) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("coursebot:progress", e);
  }
}

app.whenReady().then(async () => {
  // 启动时尝试恢复会话
  const t = loadToken();
  if (t) {
    cachedToken = t;
    setAuthToken(t);
  }
  createMainWindow();
});

app.on("window-all-closed", () => {
  stopAutoPlay();
  app.quit();
});

// ============ IPC ============

ipcMain.handle("coursebot:sso-begin", async () => {
  return await ssoBegin();
});

ipcMain.handle("coursebot:sso-login", async (_e, args) => {
  const r = await ssoLogin(args);
  if (r.ok && r.siteToken) {
    cachedToken = r.siteToken;
    setAuthToken(r.siteToken);
    saveToken(r.siteToken);
  }
  return r;
});

ipcMain.handle("coursebot:load-token", async () => {
  if (cachedToken) return cachedToken;
  const t = loadToken();
  if (t) {
    cachedToken = t;
    setAuthToken(t);
  }
  return t;
});

ipcMain.handle("coursebot:clear-token", async () => {
  cachedToken = null;
  setAuthToken(null);
  clearToken();
  stopAutoPlay();
});

ipcMain.handle("coursebot:get-quota", async () => {
  return await getQuota();
});

ipcMain.handle("coursebot:heartbeat", async () => {
  return await heartbeat();
});

ipcMain.handle("coursebot:open-chaoxing", async () => {
  createChaoxingWindow();
});

ipcMain.handle("coursebot:start-auto-play", async () => {
  if (!chaoxingWindow || chaoxingWindow.isDestroyed()) {
    return { ok: false, message: "请先打开学习通窗口并登录" };
  }
  startAutoPlay(
    chaoxingWindow,
    sendProgress,
    async () => {
      if (!cachedToken) throw new Error("no token");
      await heartbeat();
    }
  );
  return { ok: true, message: "已开始" };
});

ipcMain.handle("coursebot:stop-auto-play", async () => {
  stopAutoPlay();
  sendProgress({ type: "stopped", message: "已手动停止" });
});
