import { app, BrowserWindow, ipcMain, session } from "electron";
import { join } from "path";
import { saveToken, loadToken, clearToken } from "./store";
import { setAuthToken, ssoBegin, ssoLogin, getQuota, heartbeat } from "./api";
import {
  chaoxingLogin,
  chaoxingLogout,
  getCourses,
  getChapters,
  getCxUser,
  isLoggedIn as isCxLoggedIn,
  getCookieEntries,
} from "./chaoxing";
import {
  startCourseEngine,
  stopCourseEngine,
  isEngineRunning,
  type CourseProgressEvent,
} from "./courseEngine";

let mainWindow: BrowserWindow | null = null;
let chaoxingWindow: BrowserWindow | null = null;
let cachedToken: string | null = null;

function isDev() {
  return process.env.NODE_ENV === "development";
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 780,
    minWidth: 420,
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
    stopCourseEngine();
    if (chaoxingWindow && !chaoxingWindow.isDestroyed()) chaoxingWindow.close();
  });
}

/** 创建/复用学习通浏览器窗口（自动注入 cookies） */
async function ensureChaoxingWindow(show = false): Promise<BrowserWindow> {
  if (chaoxingWindow && !chaoxingWindow.isDestroyed()) {
    if (show) chaoxingWindow.show();
    return chaoxingWindow;
  }

  chaoxingWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show,
    title: "学习通",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:chaoxing",
    },
  });

  chaoxingWindow.on("closed", () => {
    chaoxingWindow = null;
    stopCourseEngine();
    sendProgress({ type: "stopped", message: "学习通窗口已关闭" });
  });

  // 把 API 登录拿到的 cookies 注入到 BrowserWindow session
  await syncCookiesToSession();

  return chaoxingWindow;
}

/** 将 chaoxing.ts 中的 cookies 同步到 Electron session */
async function syncCookiesToSession() {
  const ses = session.fromPartition("persist:chaoxing");
  const entries = getCookieEntries();
  const domains = [
    "chaoxing.com",
    ".chaoxing.com",
  ];
  for (const { name, value } of entries) {
    for (const domain of domains) {
      try {
        await ses.cookies.set({
          url: `https://${domain.replace(/^\./, "")}`,
          name,
          value,
          domain,
          path: "/",
        });
      } catch { /* 某些 cookie 写入可能失败，忽略 */ }
    }
  }
}

function sendProgress(e: CourseProgressEvent) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("coursebot:progress", e);
  }
}

app.whenReady().then(async () => {
  const t = loadToken();
  if (t) {
    cachedToken = t;
    setAuthToken(t);
  }
  createMainWindow();
});

app.on("window-all-closed", () => {
  stopCourseEngine();
  app.quit();
});

// ============ 平台 IPC（保留原有） ============

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
  stopCourseEngine();
});

ipcMain.handle("coursebot:get-quota", async () => {
  return await getQuota();
});

ipcMain.handle("coursebot:heartbeat", async () => {
  return await heartbeat();
});

// ============ 学习通 IPC（新增） ============

ipcMain.handle("coursebot:chaoxing-login", async (_e, args: { phone: string; password: string }) => {
  const result = await chaoxingLogin(args.phone, args.password);
  if (result.ok) {
    await syncCookiesToSession();
  }
  return result;
});

ipcMain.handle("coursebot:chaoxing-logout", async () => {
  chaoxingLogout();
  // 清除 session cookies
  const ses = session.fromPartition("persist:chaoxing");
  await ses.clearStorageData({ storages: ["cookies"] });
});

ipcMain.handle("coursebot:chaoxing-status", async () => {
  return { loggedIn: isCxLoggedIn(), user: getCxUser() };
});

ipcMain.handle("coursebot:get-courses", async () => {
  return await getCourses();
});

ipcMain.handle("coursebot:get-chapters", async (_e, args: { courseId: string; clazzId: string; cpi: string }) => {
  return await getChapters(args.courseId, args.clazzId, args.cpi);
});

ipcMain.handle("coursebot:start-course", async (_e, args: {
  courseId: string;
  clazzId: string;
  cpi: string;
  chapters: any[];
}) => {
  if (isEngineRunning()) {
    return { ok: false, message: "已有任务在运行中" };
  }

  const win = await ensureChaoxingWindow(false);

  startCourseEngine(
    win,
    args.courseId,
    args.clazzId,
    args.cpi,
    args.chapters,
    sendProgress,
    async () => {
      if (cachedToken) await heartbeat();
    }
  );

  return { ok: true, message: "已开始刷课" };
});

ipcMain.handle("coursebot:stop-course", async () => {
  stopCourseEngine();
  sendProgress({ type: "stopped", message: "已手动停止" });
});

ipcMain.handle("coursebot:show-chaoxing-window", async () => {
  await ensureChaoxingWindow(true);
});
