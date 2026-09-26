import { spawn } from "node:child_process";
import os from "node:os";

// 安装失败时的"诊断"：认出是哪款安全软件在拦、把技术错误翻译成用户能照做的话，
// 并把结果匿名报给主站，让我们知道"装不上"到底都是些什么原因。

export const windowsDefender = "Windows 安全中心";

/** 进程名 → 产品名。只收常见的；认不出的不影响安装，只是提示更笼统一些 */
const ANTIVIRUS_PROCESSES: Record<string, string> = {
  "360tray.exe": "360安全卫士",
  "360safe.exe": "360安全卫士",
  "zhudongfangyu.exe": "360安全卫士",
  "360sd.exe": "360杀毒",
  "360rp.exe": "360杀毒",
  "hipstray.exe": "火绒安全",
  "hipsdaemon.exe": "火绒安全",
  "hipsmain.exe": "火绒安全",
  "usysdiag.exe": "火绒安全",
  "qqpctray.exe": "腾讯电脑管家",
  "qqpcrtp.exe": "腾讯电脑管家",
  "kxetray.exe": "金山毒霸",
  "kxescore.exe": "金山毒霸",
  "2345safetray.exe": "2345安全卫士",
  "2345mpcsafe.exe": "2345安全卫士",
  "avp.exe": "卡巴斯基",
  "ekrn.exe": "ESET",
  "mcshield.exe": "McAfee",
  "avastsvc.exe": "Avast",
  "avgsvc.exe": "AVG",
  "nortonsecurity.exe": "诺顿",
  "msmpeng.exe": windowsDefender
};

/** 从 tasklist 的 CSV 输出里认出安全软件，按出现顺序去重 */
export const parseAntivirus = (tasklistCsv: string): string[] => {
  const found = new Set<string>();
  for (const line of tasklistCsv.split(/\r?\n/)) {
    const image = /^"([^"]+)"/.exec(line.trim())?.[1]?.toLowerCase();
    const product = image ? ANTIVIRUS_PROCESSES[image] : undefined;
    if (product) found.add(product);
  }
  // Defender 几乎每台机器都在跑，排在第三方后面，界面只在没有别家时才点它的名
  return [...found].sort((a, b) => Number(a === windowsDefender) - Number(b === windowsDefender));
};

export const detectAntivirus = (): Promise<string[]> => new Promise((resolve) => {
  const child = spawn("tasklist.exe", ["/fo", "csv", "/nh"], { windowsHide: true });
  let out = "";
  const timer = setTimeout(() => child.kill(), 5000);
  child.stdout.on("data", (chunk) => { out += chunk.toString(); });
  child.on("error", () => { clearTimeout(timer); resolve([]); });
  child.on("close", () => { clearTimeout(timer); resolve(parseAntivirus(out)); });
});

/** 错误里带着 C:\Users\<用户名>\…，上报前换成 ~，不把用户名送出去 */
export const scrubUserPaths = (text: string): string => {
  let result = text;
  const home = os.homedir();
  if (home) result = result.split(home).join("~");
  return result.replace(/[A-Za-z]:\\Users\\[^\\'"\s]+/gi, "~");
};

export type FailureKind = "blocked" | "no-space" | "rollback" | "other";

export type FailureAdvice = { message: string; hint: string; canElevate: boolean };

const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES", "UNKNOWN"]);

export const classifyFailure = (code: string, stage: string): FailureKind => {
  if (stage === "rollback") return "rollback";
  if (code === "ENOSPC") return "no-space";
  if (TRANSIENT.has(code)) return "blocked";
  return "other";
};

/**
 * 把一次失败翻译成两行人话：标题说发生了什么，提示说现在该点哪里。
 * 技术细节另放在折叠的"详细信息"里，不在这里拼。
 */
export const adviseFailure = (
  kind: FailureKind,
  antivirus: string[],
  context: { elevated: boolean; neededMb?: number }
): FailureAdvice => {
  const thirdParty = antivirus.filter((name) => name !== windowsDefender);
  const culprit = thirdParty.length > 0 ? thirdParty.join("、") : antivirus[0];
  // 已经是管理员身份了还失败，就别再给同一个按钮
  const canElevate = !context.elevated;
  switch (kind) {
    case "blocked":
      if (culprit) {
        return {
          message: `安装文件被${culprit}拦住了。`,
          hint: `请在${culprit}弹出的提示里选择“允许”或“信任”，也可以先暂时退出${culprit}，再点“重试”。`,
          canElevate
        };
      }
      return {
        message: "文件被其他程序占用，暂时无法写入。",
        hint: canElevate
          ? "请关掉打开着安装目录的窗口，稍等片刻点“重试”；仍不行就点“以管理员身份重试”。"
          : "请关掉打开着安装目录的窗口，稍等片刻点“重试”；仍不行可以重启电脑后再装。",
        canElevate
      };
    case "no-space":
      return {
        message: "磁盘空间不足。",
        hint: context.neededMb
          ? `C 盘至少需要 ${context.neededMb} MB 空闲空间，清理后点“重试”。`
          : "请清理 C 盘空间后点“重试”。",
        canElevate: false
      };
    case "rollback":
      return {
        message: "安装没有完成，部分旧文件也没能恢复。",
        hint: "点“重试”重新安装一遍即可修复；若有安全软件弹窗，请先选择“允许”。",
        canElevate
      };
    default:
      return {
        message: "安装文件写入失败。",
        hint: canElevate ? "请点“重试”；仍不行可以点“以管理员身份重试”。" : "请重启电脑后重新运行安装包。",
        canElevate
      };
  }
};

export type InstallReport = {
  appVersion: string;
  previousVersion: string | null;
  osRelease: string;
  arch: "x64" | "arm64" | "ia32";
  mode: "install" | "upgrade" | "auto-update";
  elevated: boolean;
  outcome: "failed" | "retried" | "elevated";
  stage: "lock" | "close-running" | "stage" | "swap" | "rollback" | "shortcuts" | "registry" | "elevate" | "unknown";
  errorCode: string | null;
  fileName: string | null;
  message: string | null;
  antivirus: string[];
  retries: number;
  durationMs: number;
};

const clip = (value: string | null, max: number): string | null =>
  value === null ? null : value.length > max ? value.slice(0, max) : value;

/** 匿名上报；网络不通或主站拒收都无所谓，绝不能拖住安装器退出 */
export const sendInstallReport = async (origin: string, report: InstallReport): Promise<void> => {
  const body: InstallReport = {
    ...report,
    errorCode: clip(report.errorCode && /^[\w-]+$/.test(report.errorCode) ? report.errorCode : null, 24),
    fileName: clip(report.fileName && scrubUserPaths(report.fileName), 160),
    message: clip(report.message && scrubUserPaths(report.message), 600),
    antivirus: report.antivirus.slice(0, 12),
    retries: Math.min(Math.max(Math.round(report.retries), 0), 100_000),
    durationMs: Math.min(Math.max(Math.round(report.durationMs), 0), 3_600_000)
  };
  try {
    await fetch(new URL("/api/app-clients/desktop/install-report", origin).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000)
    });
  } catch {
    // 上报失败不影响任何东西
  }
};
