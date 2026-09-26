import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import originalFs from "original-fs";
import path from "node:path";
import { branding, oauthConfig } from "./config";
import {
  adviseFailure,
  classifyFailure,
  detectAntivirus,
  InstallReport,
  sendInstallReport
} from "./install-diagnostics";
import { acquireInstallLock, InstallEntry, installTree, InstallTreeError } from "./install-files";

// 自装：不用 NSIS 画界面。发出去的 exe 是 electron-builder 的 portable 目标 ——
// 它是个静默解压壳（无任何窗口），把应用解到临时目录后运行我们，
// 于是用户看到的第一个窗口就是下面这个我们自己用 HTML 画的安装页。
//
// 装完由我们把文件复制到用户目录、建快捷方式、写卸载项，再启动正式版。

// 「以管理员身份重试」时，安装页用 UAC 提权再跑一遍解压出来的同一个 exe。
// 不能提权重跑外层安装包：它一启动就会 RMDir 掉临时解压目录，把正在运行的安装页一起删了。
const ELEVATED_FLAG = "--install-elevated";
const CONTEXT_PREFIX = "--install-context=";

/** 提权进程的环境变量未必能继承，所以另认一个命令行标记 */
export const isElevatedInstallLaunch = (): boolean => process.argv.includes(ELEVATED_FLAG);

/** 便携壳设的环境变量是"我正跑在安装态"的信号；提权重试另有命令行标记 */
export const isInstallLaunch = (): boolean =>
  Boolean(process.env.PORTABLE_EXECUTABLE_FILE) || isElevatedInstallLaunch();

// 与旧 NSIS 版落点一致，让老用户就地升级而不是并存两份
const INSTALL_DIR_NAME = "cpu-web-desktop";
const UNINSTALL_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${INSTALL_DIR_NAME}`;

const localAppData = (): string =>
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

const targetDir = (): string => path.join(localAppData(), "Programs", INSTALL_DIR_NAME);

/** 解压出来的应用根目录（exe、resources、locales、*.dll 都在这一层） */
const sourceDir = (): string => path.dirname(app.getPath("exe"));

const exeName = (): string => path.basename(app.getPath("exe"));

/**
 * 装到哪、快捷方式放哪、卸载项写哪。普通安装全部取当前用户的；提权重试时由安装页
 * 算好传进来 —— 用别的管理员账号授权时，提权进程的"当前用户"已经不是装软件的那个人了。
 */
type InstallContext = {
  targetDir: string;
  shortcutDirs: string[];
  uninstallKey: string;
  /** 只在提权进程里有：进度与结果写到这个文件，安装页轮询它 */
  statusFile?: string;
};

const defaultContext = (): InstallContext => ({
  targetDir: targetDir(),
  shortcutDirs: [app.getPath("desktop"), startMenuDir()],
  uninstallKey: UNINSTALL_KEY
});

const collect = async (from: string, to: string, out: InstallEntry[]): Promise<void> => {
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
const closeRunning = async (exePath: string): Promise<boolean> => {
  if ((await countRunning(exePath)) === 0) return true;

  // Electron 有主进程和多个 renderer，旧版还可能正在完成退出前的会话落盘。
  // 不能发一次 Stop-Process、固定等 800 ms 就当它已经退出；必须以完整路径反复
  // 核对，直到所有旧进程确实消失，才允许覆盖和启动新版。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await powershell(
      `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psQuote(exePath)} }`
      + ` | Stop-Process -Force -ErrorAction SilentlyContinue`
    );
    for (let poll = 0; poll < 15; poll += 1) {
      await delay(200);
      if ((await countRunning(exePath)) === 0) return true;
    }
  }
  return false;
};

const LEFTOVER_PATTERN = /\.(old|installing)-[a-z0-9-]+$/;

// 用 original-fs 走目录：Electron 的 fs 补丁会把 app.asar（以及 app.asar.old-xxx）当成
// 包内目录解析。这里不能像复制时那样切 process.noAsar —— 递归要走一会儿，
// 期间应用正在从 app.asar 加载页面，全局开关会让它们一起读不到。
const sweepDir = async (dir: string): Promise<void> => {
  for (const item of await originalFs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await sweepDir(full);
    else if (item.isFile() && LEFTOVER_PATTERN.test(item.name)) {
      await originalFs.promises.rm(full, { force: true }).catch(() => undefined);
    }
  }
};

/** 正常启动时调用：清掉上次覆盖安装时删不掉的旧文件，以及异常退出残留的暂存文件 */
export const sweepReplacedFiles = async (): Promise<void> => {
  const dir = sourceDir();
  // 安装器正在暂存新文件时别去动它们，否则换入那一步会找不到文件
  if (await stat(path.join(dir, ".install.lock")).then(() => true, () => false)) return;
  await sweepDir(dir).catch(() => undefined);
};

const startMenuDir = (): string =>
  path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");

// Early installers used productName ("药大拾间桌面端") while the current installer uses
// windowTitle ("药大拾间"). Both links target the same executable, but Windows presents
// them as two apps. Remove every known alias during upgrade/uninstall and keep one entry.
const shortcutNames = Array.from(new Set([branding.windowTitle, branding.productName]));

const removeKnownShortcuts = async (dirs = [app.getPath("desktop"), startMenuDir()]): Promise<void> => {
  for (const dir of dirs) {
    for (const name of shortcutNames) {
      await rm(path.join(dir, `${name}.lnk`), { force: true }).catch(() => undefined);
    }
  }
};

const writeShortcuts = async (exePath: string, dirs: string[]): Promise<void> => {
  await removeKnownShortcuts(dirs);
  const options = {
    target: exePath,
    cwd: path.dirname(exePath),
    icon: exePath,
    iconIndex: 0,
    description: branding.productName
  };
  for (const dir of dirs) {
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

const writeUninstallEntry = async (key: string, exePath: string, dir: string, bytes: number): Promise<void> => {
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
    await reg(["add", key, "/v", name, "/t", type, "/d", data, "/f"]);
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

type ReportStage = InstallReport["stage"];

/** 安装流程本身的结果：只记事实，怎么跟用户说由安装页那一侧决定 */
type RawResult =
  | { ok: true; bytes: number; retries: number }
  | {
    ok: false;
    stage: ReportStage;
    code: string;
    file: string | null;
    detail: string;
    retries: number;
    /** 锁、旧版未退出这类原因明确的失败，直接给定文案 */
    message?: string;
    hint?: string;
    neededMb?: number;
  };

/** 交给安装页渲染的结果 */
type InstallResult =
  | { ok: true }
  | { ok: false; message: string; hint?: string; detail?: string; canElevate: boolean };

const WRITING_DETAIL = "正在写入文件，请不要关闭这个窗口。";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const copyTree = async (
  from: string,
  to: string,
  report: (p: Progress) => void
): Promise<RawResult> => {
  report({ percent: 1, text: "正在清点文件" });
  const entries: InstallEntry[] = [];
  await collect(from, to, entries);
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total === 0) {
    return {
      ok: false, stage: "stage", code: "EMPTY", file: null, retries: 0, detail: from,
      message: "安装包里没有找到应用文件。", hint: "请重新下载安装包后再试。"
    };
  }

  // 新文件先整套暂存在目标旁边再换入，峰值要占两份空间。先量一下，别写到一半才撞墙
  const neededMb = Math.ceil((total * 1.1) / 1024 / 1024) + 64;
  try {
    const disk = await statfs(path.dirname(to));
    if (disk.bavail * disk.bsize < neededMb * 1024 * 1024) {
      return { ok: false, stage: "stage", code: "ENOSPC", file: null, retries: 0, detail: `需要约 ${neededMb} MB`, neededMb };
    }
  } catch {
    // 量不出来就照常装，真不够时写文件会报 ENOSPC
  }

  // 目录一次性建好，省得每个文件都试一次
  const dirs = new Set(entries.map((entry) => path.dirname(entry.to)));
  for (const dir of dirs) await mkdir(dir, { recursive: true });

  report({ percent: 3, text: "正在写入文件", detail: WRITING_DETAIL });
  let lastTick = 0;
  let waiting = false;
  try {
    const result = await installTree(entries, {
      onProgress: ({ phase, bytes }) => {
        const now = Date.now();
        // 每个文件都推一次 IPC 会把渲染进程刷爆，限流到 ~25 次/秒；刚等完杀软要立刻换回原文案
        if (!waiting && now - lastTick <= 40) return;
        lastTick = now;
        waiting = false;
        // 暂存占到 80%，换入占到 90%，剩下留给快捷方式与注册表，避免卡在 100% 上不动
        const percent = phase === "stage" ? 3 + (bytes / total) * 77 : 80 + (bytes / total) * 10;
        report({ percent, text: phase === "stage" ? "正在写入文件" : "正在替换旧版本", detail: WRITING_DETAIL });
      },
      onRetry: ({ file, waitedMs }) => {
        // 头几百毫秒的重试用户察觉不到，等久了才换提示，免得文案一闪一闪
        if (waitedMs < 300 || waiting) return;
        waiting = true;
        report({
          percent: -1,
          text: "正在等待安全软件检查",
          detail: `安全软件正在检查 ${path.basename(file)}，通常几秒内结束，请稍候…`
        });
      }
    });
    return { ok: true, bytes: total, retries: result.retries };
  } catch (error) {
    const treeError = error instanceof InstallTreeError ? error : null;
    const code = treeError?.code || String((error as NodeJS.ErrnoException)?.code ?? "");
    const file = treeError ? path.basename(treeError.file) : null;
    return {
      ok: false,
      stage: treeError?.stage ?? "unknown",
      code,
      file,
      retries: 0,
      detail: file ? `${file} · ${errorText(error)}` : errorText(error)
    };
  }
};

const runInstall = async (context: InstallContext, report: (p: Progress) => void): Promise<RawResult> => {
  const from = sourceDir();
  const to = context.targetDir;
  const exePath = path.join(to, exeName());

  report({ percent: 0, text: "正在准备" });
  let installLock;
  try {
    installLock = await acquireInstallLock(to);
  } catch (error) {
    const code = String((error as NodeJS.ErrnoException)?.code ?? "");
    return {
      ok: false, stage: "lock", code, file: null, retries: 0, detail: errorText(error),
      // 权限类错误交给通用诊断（会点名安全软件、给出管理员重试），其余照旧
      ...(classifyFailure(code, "lock") === "other" ? { message: "无法准备安装目录。" } : {})
    };
  }
  if (!installLock) {
    return {
      ok: false, stage: "lock", code: "LOCKED", file: null, retries: 0, detail: path.join(to, ".install.lock"),
      message: "另一个安装或更新正在进行。",
      hint: "请只保留一个安装窗口；若此前异常退出，请稍等几秒后重试。"
    };
  }

  try {
    if (!(await closeRunning(exePath))) {
      return {
        ok: false, stage: "close-running", code: "RUNNING", file: null, retries: 0, detail: exePath,
        message: "旧版本仍在运行，暂时无法安全更新。",
        hint: "请从托盘菜单完全退出药大拾间，再重新运行安装包。"
      };
    }

    // Electron 会把路径中的 app.asar 当包内路径，复制文件本体时必须暂时关闭补丁。
    process.noAsar = true;
    let result: RawResult;
    try {
      result = await copyTree(from, to, report);
    } finally {
      process.noAsar = false;
    }
    if (!result.ok) return result;

    report({ percent: 92, text: "正在创建快捷方式" });
    await writeShortcuts(exePath, context.shortcutDirs);

    report({ percent: 96, text: "正在注册卸载信息" });
    await writeUninstallEntry(context.uninstallKey, exePath, to, result.bytes);

    report({ percent: 100, text: "安装完成" });
    return result;
  } finally {
    await installLock.release();
  }
};

/* ------------------------------------------------------------ 管理员重试 */

type ElevatedStatus = { progress?: Progress; result?: RawResult };

const decodeContext = (): InstallContext | null => {
  const arg = process.argv.find((item) => item.startsWith(CONTEXT_PREFIX));
  if (!arg) return null;
  try {
    const value = JSON.parse(Buffer.from(arg.slice(CONTEXT_PREFIX.length), "base64url").toString("utf8")) as InstallContext;
    // 提权进程会往这些位置写东西，只接受安装页自己算出来的那种形状
    const valid = typeof value.targetDir === "string"
      && path.basename(value.targetDir) === INSTALL_DIR_NAME
      && path.basename(path.dirname(value.targetDir)) === "Programs"
      && Array.isArray(value.shortcutDirs) && value.shortcutDirs.every((dir) => typeof dir === "string")
      && typeof value.uninstallKey === "string"
      && value.uninstallKey.endsWith(`\\Uninstall\\${INSTALL_DIR_NAME}`)
      && typeof value.statusFile === "string";
    return valid ? value : null;
  } catch {
    return null;
  }
};

/** 提权进程的入口：不开窗口，进度与结果都写进安装页指定的状态文件 */
export const runElevatedInstall = async (): Promise<number> => {
  const context = decodeContext();
  if (!context?.statusFile) return 2;
  const statusFile = context.statusFile;
  let writing = Promise.resolve();
  const write = (status: ElevatedStatus): Promise<void> => {
    writing = writing.then(() => writeFile(statusFile, JSON.stringify(status), "utf8")).catch(() => undefined);
    return writing;
  };
  let lastWrite = 0;
  let result: RawResult;
  try {
    result = await runInstall(context, (progress) => {
      const now = Date.now();
      if (now - lastWrite < 200 && progress.percent < 100) return;
      lastWrite = now;
      void write({ progress });
    });
  } catch (error) {
    result = { ok: false, stage: "unknown", code: "", file: null, retries: 0, detail: errorText(error) };
  }
  await write({ result });
  return result.ok ? 0 : 1;
};

const currentUserSid = async (): Promise<string | null> => {
  const sid = await powershell("[Security.Principal.WindowsIdentity]::GetCurrent().User.Value");
  return /^S-1-[\d-]+$/.test(sid) ? sid : null;
};

/** 弹 UAC 跑提权进程并等它结束。用户在 UAC 里点"否"时返回 1223（ERROR_CANCELLED） */
const startElevated = (args: string[]): Promise<number> => new Promise((resolve) => {
  const list = args.map(psQuote).join(",");
  const script = `try { $p = Start-Process -FilePath ${psQuote(app.getPath("exe"))} -ArgumentList @(${list})`
    // 先碰一下 Handle 把句柄留住，否则进程退得快时 ExitCode 可能读成空、被当成 0
    + ` -Verb RunAs -PassThru -ErrorAction Stop; $null = $p.Handle } catch { exit 1223 }; $p.WaitForExit(); exit $p.ExitCode`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
  child.on("error", () => resolve(-1));
  child.on("close", (code) => resolve(code ?? -1));
});

const runElevatedFromInstaller = async (report: (p: Progress) => void): Promise<RawResult> => {
  report({ percent: 0, text: "正在请求管理员权限", detail: "请在弹出的“用户账户控制”窗口里点“是”。" });
  const statusFile = path.join(os.tmpdir(), `cpu-web-desktop-elevated-${randomUUID()}.json`);
  const sid = await currentUserSid();
  const context: InstallContext = {
    ...defaultContext(),
    // 借别的管理员账号授权时，提权进程的 HKCU 是那个账号的；按 SID 写回装软件的这个人名下
    uninstallKey: sid ? `HKU\\${sid}\\${UNINSTALL_KEY.slice("HKCU\\".length)}` : UNINSTALL_KEY,
    statusFile
  };
  const encoded = Buffer.from(JSON.stringify(context), "utf8").toString("base64url");

  let lastPercent = -1;
  let polling = true;
  const poll = (async () => {
    while (polling) {
      await delay(300);
      try {
        const status = JSON.parse(await readFile(statusFile, "utf8")) as ElevatedStatus;
        if (status.progress && status.progress.percent !== lastPercent) {
          lastPercent = status.progress.percent;
          report(status.progress);
        }
      } catch {
        // 还没写，或正写到一半
      }
    }
  })();

  const exitCode = await startElevated([ELEVATED_FLAG, `${CONTEXT_PREFIX}${encoded}`]);
  polling = false;
  await poll;

  let status: ElevatedStatus | null = null;
  try {
    status = JSON.parse(await readFile(statusFile, "utf8")) as ElevatedStatus;
  } catch {
    status = null;
  }
  await rm(statusFile, { force: true }).catch(() => undefined);

  if (status?.result) return status.result;
  if (exitCode === 1223) {
    return {
      ok: false, stage: "elevate", code: "CANCELLED", file: null, retries: 0, detail: "UAC 被取消",
      message: "没有获得管理员权限。",
      hint: "需要在弹出的“用户账户控制”窗口里点“是”；也可以点“重试”按普通方式再装一次。"
    };
  }
  return {
    ok: false, stage: "elevate", code: `EXIT_${exitCode}`, file: null, retries: 0,
    detail: `提权进程退出码 ${exitCode}`,
    message: "管理员身份的安装没有正常结束。",
    hint: "请点“重试”；仍不行可以重启电脑后重新运行安装包。"
  };
};

/* ---------------------------------------------------------- 结果与上报 */

const readInstalledVersion = (): Promise<string | null> => new Promise((resolve) => {
  const child = spawn("reg.exe", ["query", UNINSTALL_KEY, "/v", "DisplayVersion"], { windowsHide: true });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk.toString(); });
  child.on("error", () => resolve(null));
  child.on("close", () => resolve(/DisplayVersion\s+REG_SZ\s+([\w.+-]+)/.exec(out)?.[1] ?? null));
});

/** 还在路上的上报。关窗口时稍等它们一下，别让刚看到的失败原因白白丢掉 */
const pendingReports = new Set<Promise<void>>();

const track = (report: Promise<void>): Promise<void> => {
  pendingReports.add(report);
  return report.finally(() => pendingReports.delete(report));
};

const flushReports = (limitMs: number): Promise<unknown> =>
  Promise.race([Promise.allSettled([...pendingReports]), delay(limitMs)]);

const reportArch = (): InstallReport["arch"] =>
  process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "ia32" : "x64";

/** 失败时认一下安全软件、翻译成人话；值得知道的结果匿名报给主站 */
const finishAttempt = async (
  raw: RawResult,
  meta: { elevated: boolean; startedAt: number; mode: InstallReport["mode"]; previousVersion: string | null }
): Promise<InstallResult> => {
  const base = {
    appVersion: app.getVersion(),
    previousVersion: meta.previousVersion,
    osRelease: os.release(),
    arch: reportArch(),
    mode: meta.mode,
    elevated: meta.elevated,
    durationMs: Date.now() - meta.startedAt
  };

  if (raw.ok) {
    // 一次就装好的不报；靠重试或提权才装上的要报 —— 这正是"原本会失败"的那部分。
    // 不等它：应用已经在启动了，安装页退出前再统一等一下
    if (meta.elevated || raw.retries > 0) {
      void track(detectAntivirus().then((antivirus) => sendInstallReport(oauthConfig.origin, {
        ...base,
        outcome: meta.elevated ? "elevated" : "retried",
        stage: "unknown",
        errorCode: null,
        fileName: null,
        message: null,
        antivirus,
        retries: raw.retries
      })));
    }
    return { ok: true };
  }

  const antivirus = await detectAntivirus();
  const advice = adviseFailure(classifyFailure(raw.code, raw.stage), antivirus, {
    elevated: meta.elevated,
    neededMb: raw.neededMb
  });
  // 用户在 UAC 里点了"否"不算安装失败，不必上报
  if (raw.code !== "CANCELLED") {
    void track(sendInstallReport(oauthConfig.origin, {
      ...base,
      outcome: "failed",
      stage: raw.stage,
      errorCode: raw.code || null,
      fileName: raw.file,
      message: raw.detail,
      antivirus,
      retries: raw.retries
    }));
  }
  return {
    ok: false,
    message: raw.message ?? advice.message,
    hint: raw.hint ?? (raw.message ? undefined : advice.hint),
    detail: raw.detail,
    // 取消 UAC 的人可能只是手滑，按钮留着；已经提权过还失败就不再给
    canElevate: raw.stage === "elevate" ? raw.code === "CANCELLED" : raw.message ? false : advice.canElevate
  };
};

/* ------------------------------------------------------------------ 卸载 */

// 自己删自己：进程还活着时删不掉自身目录，交给一个脱离的 cmd 等两秒再动手。
export const runUninstall = async (): Promise<void> => {
  const dir = sourceDir();
  // 本地存着校园网密码、学习通账号密码与登录凭据，卸载必须一并清掉
  const data = app.getPath("userData");
  await reg(["delete", UNINSTALL_KEY, "/f"]);
  await removeKnownShortcuts();
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

  const autoUpdate = process.argv.includes("--auto-update");
  let installPromise: Promise<InstallResult> | null = null;

  const attempt = (elevated: boolean): Promise<InstallResult> => {
    if (!installPromise) {
      installPromise = (async () => {
        const startedAt = Date.now();
        const exePath = path.join(targetDir(), exeName());
        const previousVersion = await readInstalledVersion();
        const upgrade = await stat(exePath).then((info) => info.isFile(), () => false);
        const mode: InstallReport["mode"] = autoUpdate ? "auto-update" : upgrade ? "upgrade" : "install";
        let raw: RawResult;
        try {
          raw = elevated ? await runElevatedFromInstaller(send) : await runInstall(defaultContext(), send);
        } catch (error) {
          raw = { ok: false, stage: "unknown", code: "", file: null, retries: 0, detail: errorText(error) };
        }
        const result = await finishAttempt(raw, { elevated, startedAt, mode, previousVersion });
        if (result.ok) {
          // 正式版一律由这里以普通身份启动：提权进程只管写文件，免得应用跑在管理员名下
          launchInstalled(exePath);
          // 留 1.4 秒给"安装完成"那一屏；上报没发完就再等一会儿，最多 5 秒
          void Promise.all([delay(1400), flushReports(5000)]).then(() => app.exit(0));
        }
        return result;
      })().finally(() => {
        installPromise = null;
      });
    }
    return installPromise;
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

  ipcMain.handle("install:run", () => attempt(false));
  ipcMain.handle("install:run-elevated", () => attempt(true));

  ipcMain.handle("install:close", async () => {
    // 窗口先收起来，用户感觉是立刻关了；后台再给上报最多两秒
    if (!window.isDestroyed()) window.hide();
    await flushReports(2000);
    app.exit(0);
  });

  await window.loadFile(path.join(app.getAppPath(), "src", "installer", "index.html"));
  window.show();

  // 自动更新调进来时不该再等用户点一次「立即安装」—— 用户在旧版里已经同意过了。
  // 窗口照常显示：装的过程有个进度条，比什么都不显示地闷头替换文件更让人安心。
  // portable.nsi 用 StdUtils.GetAllParameters 把参数透传给应用，所以这个标记
  // 能从外层解压壳一路传到这里。
  // loadFile 已经 await 过，did-finish-load 不会再触发，直接发即可
  if (autoUpdate) window.webContents.send("install:auto-start");
};
