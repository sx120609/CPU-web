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
//
// 不按错误码筛：被内存映射的文件（icudtl.dat、*.dll 这些）复制失败时
// Windows 给的是 UNKNOWN，按 EBUSY/EPERM 判断会直接漏掉，正是这个兜底最该
// 生效的场合。所以只要目标已存在就一律试一次改名，改名再失败才算真失败。
const placeFile = async (entry: Entry): Promise<void> => {
  try {
    await copyFile(entry.from, entry.to);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
  }
  const parked = `${entry.to}.old-${Date.now().toString(36)}`;
  await rename(entry.to, parked);
  await copyFile(entry.from, entry.to);
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const powershell = (script: string): Promise<string> => new Promise((resolve) => {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk.toString(); });
  child.on("error", () => resolve(""));
  child.on("close", () => resolve(out.trim()));
});

// 按可执行文件的完整路径匹配，不按进程名 —— 安装态自己跑的是临时目录里的同名 exe，
// 用 taskkill /IM 会把自己一起杀掉。
const countRunning = async (exePath: string): Promise<number> => {
  const out = await powershell(
    `@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psQuote(exePath)} }).Count`
  );
  return Number.parseInt(out, 10) || 0;
};

// 升级前必须真的关掉旧版，光靠改名让路不够：旧进程还活着就还占着单实例锁，
// 装完启动新版只会把旧窗口顶到前面，看起来像"更新了个寂寞"。
const closeRunning = async (exePath: string): Promise<void> => {
  if ((await countRunning(exePath)) === 0) return;
  await powershell(
    `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psQuote(exePath)} }`
    + ` | Stop-Process -Force -ErrorAction SilentlyContinue`
  );
  // 进程退出后系统还要一会儿才真正释放文件映射
  await delay(800);
};

/** 正常启动时调用：清掉上次覆盖安装留下的、当时删不掉的旧文件 */
export const sweepReplacedFiles = async (): Promise<void> => {
  const dir = sourceDir();
  // 让路的文件里会有 app.asar.old-xxx，路径含 .asar 就可能被 Electron 的
  // fs 补丁拦去包内解析。清理期间同样把补丁关掉。
  process.noAsar = true;
  try {
    for (const base of [dir, path.join(dir, "resources")]) {
      for (const item of await readdir(base, { withFileTypes: true }).catch(() => [])) {
        if (item.isFile() && /\.old-[a-z0-9]+$/.test(item.name)) {
          await rm(path.join(base, item.name), { force: true }).catch(() => undefined);
        }
      }
    }
  } catch {
    // 清理失败无所谓，下次再来
  } finally {
    process.noAsar = false;
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

// 从旧 NSIS 版升级过来的机器，注册表里还留着 electron-builder 生成的那条卸载项
// （键名是一串 GUID），不清掉就会在「程序和功能」里看到两个同名的药大拾间桌面端。
// 按 InstallLocation 指向同一个目录来认，避免误删别人的东西。
const removeLegacyUninstallEntry = async (dir: string): Promise<void> => {
  await powershell(
    `$root='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';`
    + ` Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {`
    + ` $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;`
    + ` if ($_.PSChildName -ne ${psQuote(INSTALL_DIR_NAME)} -and $p.InstallLocation -and`
    + ` $p.InstallLocation.TrimEnd('\\') -eq ${psQuote(dir)})`
    + ` { Remove-Item $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue } }`
  );
  // 旧向导的卸载器本体也一并删掉：留着只会让人点到一个已经不对应任何东西的入口
  for (const item of await readdir(dir).catch(() => [])) {
    if (/^Uninstall .+\.exe$/i.test(item)) {
      await rm(path.join(dir, item), { force: true }).catch(() => undefined);
    }
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

type InstallResult = { ok: true; bytes?: number } | { ok: false; message: string; detail?: string };

const copyTree = async (from: string, to: string, report: (p: Progress) => void): Promise<InstallResult> => {
  report({ percent: 1, text: "正在清点文件" });
  const entries: Entry[] = [];
  await collect(from, to, entries);
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total === 0) {
    return { ok: false, message: "安装包里没有找到应用文件。", detail: "请重新下载安装包后再试。" };
  }

  // 目录一次性建好，省得每个文件都试一次
  const dirs = new Set(entries.map((entry) => path.dirname(entry.to)));
  for (const dir of dirs) await mkdir(dir, { recursive: true });

  report({ percent: 3, text: "正在写入文件", detail: "正在写入文件，请不要关闭这个窗口。" });
  let done = 0;
  let lastTick = 0;
  for (const entry of entries) {
    try {
      await placeFile(entry);
    } catch (error) {
      return {
        ok: false,
        message: "有文件正在被占用，写不进去。",
        detail: `${path.basename(entry.to)} · ${error instanceof Error ? error.message : String(error)}`
      };
    }
    done += entry.size;
    // 每个文件都推一次 IPC 会把渲染进程刷爆，限流到 ~25 次/秒
    const now = Date.now();
    if (now - lastTick > 40) {
      lastTick = now;
      // 复制只占到 90%，剩下留给快捷方式与注册表，避免卡在 100% 上不动
      report({ percent: 3 + (done / total) * 87, text: "正在写入文件" });
    }
  }
  return { ok: true, bytes: total };
};

const runInstall = async (report: (p: Progress) => void): Promise<InstallResult> => {
  const from = sourceDir();
  const to = targetDir();
  const exePath = path.join(to, exeName());

  report({ percent: 0, text: "正在准备" });
  await closeRunning(exePath);

  // 整个复制过程必须关掉 asar 补丁。Electron 给 fs 打过补丁：路径里只要含
  // ".asar" 就被当成"压缩包内的路径"去解析，于是 resources/app.asar 这个文件
  // 本身既复制不了（补丁跑去包内找一个空路径，必然 ENOENT），readdir 还会
  // 把它当目录递归进去。noAsar 期间 fs 恢复成普通行为。
  //
  // 只包住复制：安装页自己是从 app.asar 里加载的，长期关掉会影响别处。
  process.noAsar = true;
  let result: InstallResult;
  try {
    result = await copyTree(from, to, report);
  } finally {
    process.noAsar = false;
  }
  if (!result.ok) return result;

  report({ percent: 92, text: "正在创建快捷方式" });
  writeShortcuts(exePath);

  report({ percent: 96, text: "正在注册卸载信息" });
  await writeUninstallEntry(exePath, to, result.bytes ?? 0);

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
    const exePath = path.join(targetDir(), exeName());
    let upgrade = false;
    try {
      upgrade = (await stat(exePath)).isFile();
    } catch {
      upgrade = false;
    }
    // 旧版正开着时提前说清楚会关掉它，别让用户以为是崩了
    const running = upgrade ? (await countRunning(exePath)) > 0 : false;
    return { targetLabel: targetDir(), upgrade, running };
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
