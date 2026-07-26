import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { branding } from "./config";

// 自装：不用 NSIS 画界面。发出去的 exe 是 electron-builder 的 portable 目标 ——
// 它是个静默解压壳（无任何窗口），把应用解到临时目录后运行我们，
// 于是用户看到的第一个窗口就是下面这个我们自己用 HTML 画的安装页。
//
// 装完由我们把文件复制到用户目录、建快捷方式、写卸载项，再启动正式版。

/** 便携壳设的环境变量，是"我正跑在安装态"的唯一信号 */
export const isInstallLaunch = (): boolean => Boolean(process.env.PORTABLE_EXECUTABLE_FILE);

// 与旧 NSIS 版落点一致，让老用户就地升级而不是并存两份
const INSTALL_DIR_NAME = "cpu-web-desktop";
const UNINSTALL_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${INSTALL_DIR_NAME}`;

const localAppData = (): string =>
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

const targetDir = (): string => path.join(localAppData(), "Programs", INSTALL_DIR_NAME);

/** 解压出来的应用根目录（exe、resources、locales、*.dll 都在这一层） */
const sourceDir = (): string => path.dirname(app.getPath("exe"));

const exeName = (): string => path.basename(app.getPath("exe"));

type Entry = { from: string; to: string; size: number };

const collect = async (from: string, to: string, out: Entry[]): Promise<void> => {
  for (const item of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, item.name);
    const target = path.join(to, item.name);
    if (item.isDirectory()) {
      await collect(source, target, out);
    } else if (item.isFile()) {
      out.push({ from: source, to: target, size: (await stat(source)).size });
    }
    // 符号链接等一律跳过：Windows 上的 Electron 包里不该有，出现了也不该跟着复制
  }
};

// 覆盖安装时旧版可能正开着。Windows 允许改名正在运行的文件，但不允许删除 ——
// 所以覆盖失败就把旧文件改名让路，残留的 .old- 由下次正常启动清理。
const placeFile = async (entry: Entry): Promise<void> => {
  try {
    await copyFile(entry.from, entry.to);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EBUSY" && code !== "EPERM" && code !== "EACCES") throw error;
  }
  const parked = `${entry.to}.old-${Date.now().toString(36)}`;
  await rename(entry.to, parked);
  await copyFile(entry.from, entry.to);
};

/** 正常启动时调用：清掉上次覆盖安装留下的、当时删不掉的旧文件 */
export const sweepReplacedFiles = async (): Promise<void> => {
  const dir = sourceDir();
  try {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isFile() && /\.old-[a-z0-9]+$/.test(item.name)) {
        await rm(path.join(dir, item.name), { force: true }).catch(() => undefined);
      }
    }
  } catch {
    // 清理失败无所谓，下次再来
  }
};

const startMenuDir = (): string =>
  path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");

const writeShortcuts = (exePath: string): void => {
  const options = {
    target: exePath,
    cwd: path.dirname(exePath),
    icon: exePath,
    iconIndex: 0,
    description: branding.productName
  };
  for (const dir of [app.getPath("desktop"), startMenuDir()]) {
    try {
      shell.writeShortcutLink(path.join(dir, `${branding.windowTitle}.lnk`), "create", options);
    } catch (error) {
      // 快捷方式建不出来不该让整个安装失败 —— 应用本身已经能用了
      console.error(`快捷方式创建失败：${dir}`, error);
    }
  }
};

// 用 reg.exe 而不是原生模块：加一个 node-gyp 依赖只为写六个字符串不值得。
const reg = (args: string[]): Promise<void> => new Promise((resolve) => {
  const child = spawn("reg.exe", args, { windowsHide: true, stdio: "ignore" });
  child.on("error", () => resolve());
  child.on("close", () => resolve());
});

const writeUninstallEntry = async (exePath: string, dir: string, bytes: number): Promise<void> => {
  const values: [string, string, string][] = [
    ["DisplayName", "REG_SZ", branding.productName],
    ["DisplayVersion", "REG_SZ", app.getVersion()],
    ["Publisher", "REG_SZ", branding.windowTitle],
    ["DisplayIcon", "REG_SZ", exePath],
    ["InstallLocation", "REG_SZ", dir],
    ["UninstallString", "REG_SZ", `"${exePath}" --uninstall`],
    ["NoModify", "REG_DWORD", "1"],
    ["NoRepair", "REG_DWORD", "1"],
    // 控制面板按 KB 显示
    ["EstimatedSize", "REG_DWORD", String(Math.round(bytes / 1024))]
  ];
  for (const [name, type, data] of values) {
    await reg(["add", UNINSTALL_KEY, "/v", name, "/t", type, "/d", data, "/f"]);
  }
};

/** 启动装好的正式版。必须剥掉便携环境变量，否则它会以为自己也是安装态，无限套娃。 */
const launchInstalled = (exePath: string): void => {
  const env = { ...process.env };
  delete env.PORTABLE_EXECUTABLE_FILE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.PORTABLE_EXECUTABLE_APP_FILENAME;
  const child = spawn(exePath, [], {
    detached: true,
    stdio: "ignore",
    cwd: path.dirname(exePath),
    env
  });
  child.unref();
};

type Progress = { percent: number; text?: string; detail?: string };

const runInstall = async (report: (p: Progress) => void): Promise<{ ok: true } | { ok: false; message: string }> => {
  const from = sourceDir();
  const to = targetDir();

  report({ percent: 0, text: "正在清点文件" });
  const entries: Entry[] = [];
  await collect(from, to, entries);
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total === 0) return { ok: false, message: "没有找到要安装的文件，安装包可能已损坏。" };

  // 目录一次性建好，省得每个文件都试一次
  const dirs = new Set(entries.map((entry) => path.dirname(entry.to)));
  for (const dir of dirs) await mkdir(dir, { recursive: true });

  report({ percent: 2, text: "正在写入文件", detail: "正在写入文件，请不要关闭这个窗口。" });
  let done = 0;
  let lastTick = 0;
  for (const entry of entries) {
    try {
      await placeFile(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: `写入 ${path.basename(entry.to)} 失败：${message}\n如果药大拾间正在运行，请先退出后重试。` };
    }
    done += entry.size;
    // 每个文件都推一次 IPC 会把渲染进程刷爆，限流到 ~25 次/秒
    const now = Date.now();
    if (now - lastTick > 40) {
      lastTick = now;
      // 复制只占到 92%，剩下留给快捷方式与注册表，避免卡在 100% 上不动
      report({ percent: 2 + (done / total) * 90, text: "正在写入文件" });
    }
  }

  const exePath = path.join(to, exeName());
  report({ percent: 94, text: "正在创建快捷方式" });
  writeShortcuts(exePath);

  report({ percent: 97, text: "正在注册卸载信息" });
  await writeUninstallEntry(exePath, to, total);

  report({ percent: 100, text: "安装完成" });
  launchInstalled(exePath);
  return { ok: true };
};

/* ------------------------------------------------------------------ 卸载 */

// 自己删自己：进程还活着时删不掉自身目录，交给一个脱离的 cmd 等两秒再动手。
export const runUninstall = async (): Promise<void> => {
  const dir = sourceDir();
  // 本地存着校园网密码、学习通账号密码与登录凭据，卸载必须一并清掉
  const data = app.getPath("userData");
  await reg(["delete", UNINSTALL_KEY, "/f"]);
  for (const base of [app.getPath("desktop"), startMenuDir()]) {
    await rm(path.join(base, `${branding.windowTitle}.lnk`), { force: true }).catch(() => undefined);
  }
  // 必须整条命令交给 shell：`&` 与 `>` 若作为独立 argv 传给 cmd.exe，
  // Node 会把它们当普通参数加引号，链接与重定向双双失效，rmdir 根本不会执行。
  const child = spawn(
    `ping 127.0.0.1 -n 3 >nul & rmdir /s /q "${data}" & rmdir /s /q "${dir}"`,
    { shell: true, detached: true, stdio: "ignore", windowsHide: true }
  );
  child.unref();
};

/* -------------------------------------------------------------- 安装窗口 */

export const openInstallerWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 560,
    height: 380,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    // 整窗界面自己画，系统边框与标题栏一概不要
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    title: `安装${branding.windowTitle}`,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "installer-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  const send = (payload: Progress): void => {
    if (!window.isDestroyed()) window.webContents.send("install:progress", payload);
  };

  ipcMain.handle("install:info", async () => {
    let upgrade = false;
    try {
      upgrade = (await stat(path.join(targetDir(), exeName()))).isFile();
    } catch {
      upgrade = false;
    }
    return { targetLabel: targetDir(), upgrade };
  });

  ipcMain.handle("install:run", async () => {
    const result = await runInstall(send);
    if (result.ok) {
      // 让"安装完成"那一屏留一下再退，直接消失像是崩了
      setTimeout(() => app.exit(0), 1400);
    }
    return result;
  });

  ipcMain.handle("install:close", () => app.exit(0));

  await window.loadFile(path.join(app.getAppPath(), "src", "installer", "index.html"));
  window.show();
};
