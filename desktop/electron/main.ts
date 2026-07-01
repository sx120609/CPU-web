import { app, BrowserWindow, ipcMain, session, Tray, Menu, nativeImage } from "electron";
import { join } from "path";
import { saveToken, loadToken, clearToken, saveData, loadData, clearData } from "./store";
import { setAuthToken, ssoBegin, ssoLogin, getQuota, heartbeat } from "./api";
import {
  chaoxingLogout,
  getCourses,
  getChapters,
  getCxUser,
  isLoggedIn as isCxLoggedIn,
  injectCookies,
} from "./chaoxing";
import {
  startCourseEngine,
  startCourseEngineAuto,
  stopCourseEngine,
  isEngineRunning,
  type CourseProgressEvent,
} from "./courseEngine";

let mainWindow: BrowserWindow | null = null;
let chaoxingWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let cachedToken: string | null = null;
let isQuitting = false;

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
      preload: join(__dirname, isDev() ? "preload.cjs" : "preload.js"),
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

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    stopCourseEngine();
    if (chaoxingWindow && !chaoxingWindow.isDestroyed()) chaoxingWindow.close();
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  });
}

const CX_PARTITION = "persist:chaoxing";

/** 从 BrowserWindow session 读取 cookies 注入到 chaoxing.ts 的 HTTP 客户端 */
async function syncCookiesFromSession(): Promise<boolean> {
  const ses = session.fromPartition(CX_PARTITION);
  const cookies = await ses.cookies.get({ domain: ".chaoxing.com" });
  if (cookies.length === 0) return false;

  const entries = cookies.map((c) => ({ name: c.name, value: c.value }));
  injectCookies(entries);

  const hasUid = cookies.some((c) => c.name === "_uid" && c.value && c.value !== "0");
  return hasUid;
}

/** 创建学习通工作窗口（刷课用，通常隐藏） */
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
      partition: CX_PARTITION,
    },
  });

  chaoxingWindow.on("closed", () => {
    chaoxingWindow = null;
    stopCourseEngine();
    sendProgress({ type: "stopped", message: "学习通窗口已关闭" });
  });

  return chaoxingWindow;
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

  // 创建系统托盘
  const iconPath = join(__dirname, isDev() ? "../assets/tray-icon.png" : "../assets/tray-icon.png");
  let trayImage: Electron.NativeImage;
  try {
    trayImage = nativeImage.createFromPath(iconPath);
  } catch {
    trayImage = nativeImage.createEmpty();
  }
  tray = new Tray(trayImage.resize({ width: 16, height: 16 }));
  tray.setToolTip("药大刷课助手");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示窗口", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { type: "separator" },
      { label: "退出", click: () => { isQuitting = true; app.quit(); } },
    ])
  );
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
});

app.on("before-quit", () => { isQuitting = true; });

app.on("window-all-closed", () => {
  stopCourseEngine();
  if (tray) { tray.destroy(); tray = null; }
  app.quit();
});

// ============ 平台 IPC ============

ipcMain.handle("coursebot:sso-begin", () => ssoBegin());
ipcMain.handle("coursebot:sso-login", async (_e, args) => {
  const r = await ssoLogin(args);
  if (r.ok && r.siteToken) {
    cachedToken = r.siteToken;
    setAuthToken(r.siteToken);
    saveToken(r.siteToken);
  }
  return r;
});
ipcMain.handle("coursebot:load-token", () => {
  if (cachedToken) return cachedToken;
  const t = loadToken();
  if (t) { cachedToken = t; setAuthToken(t); }
  return t;
});
ipcMain.handle("coursebot:clear-token", () => {
  cachedToken = null;
  setAuthToken(null);
  clearToken();
  stopCourseEngine();
});
ipcMain.handle("coursebot:get-quota", () => getQuota());
ipcMain.handle("coursebot:heartbeat", () => heartbeat());

// ============ 凭据持久化 ============

ipcMain.handle("coursebot:save-credentials", (_e, args: { key: string; data: any }) => {
  saveData(args.key, JSON.stringify(args.data));
});
ipcMain.handle("coursebot:load-credentials", (_e, key: string) => {
  const raw = loadData(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
});
ipcMain.handle("coursebot:clear-credentials", (_e, key: string) => {
  clearData(key);
});

// ============ 学习通登录（官方页面方式） ============

ipcMain.handle("coursebot:chaoxing-open-login", async () => {
  // 打开学习通官方登录页面，用户在里面自行登录
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 800,
    height: 700,
    title: "登录学习通",
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    modal: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: CX_PARTITION,
    },
  });

  loginWindow.loadURL("https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https://i.chaoxing.com");

  // 监听 cookie 变化，检测登录成功
  const ses = session.fromPartition(CX_PARTITION);
  const onCookieChanged = async (_event: any, cookie: any, _cause: any, removed: boolean) => {
    if (removed) return;
    if (cookie.name === "_uid" && cookie.value && cookie.value !== "0") {
      // 登录成功！
      const ok = await syncCookiesFromSession();
      if (ok && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("coursebot:chaoxing-login-success", getCxUser());
      }
      // 关闭登录窗口
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
    }
  };

  ses.cookies.on("changed", onCookieChanged);

  loginWindow.on("closed", () => {
    ses.cookies.removeListener("changed", onCookieChanged);
    loginWindow = null;
  });
});

ipcMain.handle("coursebot:chaoxing-logout", async () => {
  chaoxingLogout();
  const ses = session.fromPartition(CX_PARTITION);
  await ses.clearStorageData({ storages: ["cookies"] });
});

ipcMain.handle("coursebot:chaoxing-status", async () => {
  // 先从 session 同步一次（恢复持久化的登录态）
  if (!isCxLoggedIn()) {
    await syncCookiesFromSession();
  }
  return { loggedIn: isCxLoggedIn(), user: getCxUser() };
});

ipcMain.handle("coursebot:get-courses", () => getCourses());
ipcMain.handle("coursebot:get-chapters", async (_e, args: { courseId: string; clazzId: string; cpi: string }) => {
  // 先尝试 HTTP API
  const httpChapters = await getChapters(args.courseId, args.clazzId, args.cpi);
  if (httpChapters.length > 0) return httpChapters;

  // HTTP 失败则用 BrowserWindow 从页面提取
  console.log("[main] HTTP chapters failed, trying BrowserWindow extraction...");
  const win = await ensureChaoxingWindow(false);
  const url = `https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=&courseId=${args.courseId}&clazzid=${args.clazzId}&cpi=${args.cpi}&mooc2=1`;
  win.loadURL(url);

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 20000);
    win.webContents.once("did-finish-load", () => {
      clearTimeout(timer);
      setTimeout(resolve, 3000);
    });
  });

  try {
    const chapters = await win.webContents.executeJavaScript(`
      (function() {
        // 方式1: 从 mArrange 全局变量提取
        if (typeof mArrange !== 'undefined' && Array.isArray(mArrange)) {
          return mArrange.map(function(item) {
            return {
              id: String(item.id || ''),
              name: item.name || item.label || '',
              layer: item.layer || 0,
              status: item.status === 2 ? 'finished' : 'unfinished',
              children: [],
              taskPoints: []
            };
          });
        }

        // 方式2: 从页面 DOM 提取章节列表
        var nodes = document.querySelectorAll('.chapter_unit, .catalogFirst_level, .posCatalog_level, [class*=chapter], .prev_ul > li');
        if (nodes.length > 0) {
          var result = [];
          nodes.forEach(function(el, i) {
            var link = el.querySelector('a[href], a[onclick]');
            var title = el.querySelector('.chapter_item, .catalog_name, .posCatalog_name, span, a');
            var id = '';
            if (link) {
              var m = (link.getAttribute('href') || link.getAttribute('onclick') || '').match(/chapterId[=:]\\s*(\\d+)/i);
              if (m) id = m[1];
            }
            if (!id) id = el.getAttribute('data-id') || el.getAttribute('id') || String(i);
            result.push({
              id: id,
              name: (title ? title.textContent : el.textContent || '').trim().substring(0, 100),
              layer: 0,
              status: 'unfinished',
              children: [],
              taskPoints: []
            });
          });
          return result.filter(function(c) { return c.name.length > 0; });
        }

        // 方式3: 从 script 标签提取
        var scripts = document.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
          var text = scripts[i].textContent || '';
          var match = text.match(/mArrange\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;/);
          if (match) {
            try {
              var arr = JSON.parse(match[1]);
              return arr.map(function(item) {
                return {
                  id: String(item.id || ''),
                  name: item.name || '',
                  layer: item.layer || 0,
                  status: item.status === 2 ? 'finished' : 'unfinished',
                  children: [],
                  taskPoints: []
                };
              });
            } catch(e) {}
          }
        }

        return [];
      })();
    `, true);
    console.log("[main] BrowserWindow extraction got:", chapters?.length || 0, "chapters");
    return chapters || [];
  } catch (e) {
    console.error("[main] BrowserWindow chapter extraction failed:", String(e));
    return [];
  }
});

// ============ 刷课 IPC ============

ipcMain.handle("coursebot:open-course", async (_e, args: {
  courseId: string; clazzId: string; cpi: string;
}) => {
  const win = await ensureChaoxingWindow(true);
  // 先打开课程列表页，用户从这里点击进入具体课程的章节页
  win.loadURL("https://mooc2-ans.chaoxing.com/visit/interaction");
  return { ok: true };
});

ipcMain.handle("coursebot:start-course", async () => {
  if (isEngineRunning()) return { ok: false, message: "已有任务在运行中" };
  if (!chaoxingWindow || chaoxingWindow.isDestroyed()) {
    return { ok: false, message: "请先打开课程窗口" };
  }
  startCourseEngine(chaoxingWindow, sendProgress,
    async () => { if (cachedToken) await heartbeat(); });
  return { ok: true, message: "已开始刷课" };
});

ipcMain.handle("coursebot:stop-course", () => {
  stopCourseEngine();
  sendProgress({ type: "stopped", message: "已手动停止" });
});

ipcMain.handle("coursebot:start-course-auto", async (_e, args: {
  courseId: string; clazzId: string; cpi: string;
}) => {
  if (isEngineRunning()) return { ok: false, message: "已有任务在运行中" };
  const win = await ensureChaoxingWindow(false);
  startCourseEngineAuto(win, args.courseId, args.clazzId, args.cpi, sendProgress,
    async () => { if (cachedToken) await heartbeat(); });
  return { ok: true, message: "已开始自动刷课" };
});

ipcMain.handle("coursebot:show-chaoxing-window", () => ensureChaoxingWindow(true));
