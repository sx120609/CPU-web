import { app } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { oauthConfig } from "./config";
import { compareVersions } from "./updater";

// 自动更新：静默检测 → 后台下载 → 下好了告诉用户 → 退出时静默装上。
//
// 没有代码签名，所以不用 electron-updater：它在 Windows 上靠签名里的发布者信息
// 验证更新包，未签名就只能关掉校验，那等于开了一条不可验真的代码执行通道。
// 这里的信任链是另一套：
//   · 版本号与文件哈希来自主站的 HTTPS 接口（证书是信任锚点）
//   · 安装包字节来自阿里云的临时地址
//   · 落盘后按哈希校验，不匹配就删掉，绝不执行
// 要骗过去得同时控制主站证书和阿里云的对象，比"关掉签名校验"强得多。
//
// 装的动作复用我们自己的安装器：给它传 --auto-update，跳过"立即安装"按钮直接装。
// portable.nsi 会用 StdUtils.GetAllParameters 把命令行参数透传给应用，所以这个
// 参数能从外层的解压壳一路传到里面的主进程。

export type UpdateStage = "idle" | "checking" | "downloading" | "ready" | "error";

export type UpdateState = {
  stage: UpdateStage;
  current: string;
  latest: string;
  /** 0–100，仅 downloading 阶段有意义 */
  percent: number;
  receivedBytes: number;
  totalBytes: number;
  message: string;
  /** 下好并校验通过的安装包路径，重启时执行它 */
  readyPath: string;
};

type Remote = {
  available?: boolean;
  version?: string;
  url?: string;
  size?: number;
  fileName?: string;
  contentHash?: string;
  contentHashName?: string;
};

let state: UpdateState = {
  stage: "idle",
  current: app.getVersion(),
  latest: "",
  percent: 0,
  receivedBytes: 0,
  totalBytes: 0,
  message: "",
  readyPath: ""
};

let listener: ((value: UpdateState) => void) | undefined;
let running = false;

export const getUpdateState = (): UpdateState => state;
export const onUpdateState = (callback: (value: UpdateState) => void): void => { listener = callback; };

const emit = (patch: Partial<UpdateState>): void => {
  state = { ...state, ...patch };
  listener?.(state);
};

const updatesDir = (): string => path.join(app.getPath("userData"), "updates");

/** 下过的旧安装包留着白占几十 MB，每次开始新下载前先清空 */
const clearDownloads = async (): Promise<void> => {
  try {
    for (const name of await readdir(updatesDir())) {
      await rm(path.join(updatesDir(), name), { force: true }).catch(() => undefined);
    }
  } catch {
    // 目录还不存在
  }
};

const fetchRemote = async (): Promise<Remote | null> => {
  try {
    const response = await fetch(new URL("/api/site/downloads/desktop", oauthConfig.origin).toString(), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: Remote };
    return payload.data ?? null;
  } catch {
    return null;
  }
};

const hashFile = async (filePath: string, algorithm: string): Promise<string> => {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex").toLowerCase();
};

/**
 * 下载并校验。任何一步失败都要把半成品删掉 —— 留着一个残缺的 exe 在更新目录里，
 * 下次可能被当成"已就绪"直接执行。
 */
const download = async (remote: Remote): Promise<string> => {
  await clearDownloads();
  await mkdir(updatesDir(), { recursive: true });

  // 文件名只取 basename，且不信任服务端给的路径分隔符
  const safeName = path.basename(remote.fileName || "setup.exe").replace(/[^\w.\-一-龥]/g, "_");
  const target = path.join(updatesDir(), safeName.endsWith(".exe") ? safeName : `${safeName}.exe`);

  const response = await fetch(new URL(remote.url!, oauthConfig.origin).toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(30 * 60 * 1000)
  });
  if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）`);

  const total = Number(response.headers.get("content-length")) || remote.size || 0;
  let received = 0;
  let lastTick = 0;

  const source = Readable.fromWeb(response.body as never);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    const now = Date.now();
    // 每个数据块都推一次 IPC 会把渲染进程刷爆
    if (now - lastTick > 200) {
      lastTick = now;
      emit({
        receivedBytes: received,
        totalBytes: total,
        percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0
      });
    }
  });

  try {
    await pipeline(source, createWriteStream(target));
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }

  // 大小对不上说明传输被截断了，这种文件跑起来只会是个损坏的安装包
  const written = (await stat(target)).size;
  if (total > 0 && written !== total) {
    await rm(target, { force: true }).catch(() => undefined);
    throw new Error(`下载不完整（${written}/${total} 字节）`);
  }

  const expected = (remote.contentHash || "").toLowerCase();
  const algorithm = (remote.contentHashName || "").toLowerCase();
  if (expected && (algorithm === "sha1" || algorithm === "sha256")) {
    const actual = await hashFile(target, algorithm);
    if (actual !== expected) {
      await rm(target, { force: true }).catch(() => undefined);
      throw new Error("安装包校验未通过，已丢弃");
    }
  } else {
    // 校验不了就说清楚，不要让人以为验过了
    console.warn("服务端未提供可用的内容哈希，本次更新包未做完整性校验");
  }

  return target;
};

/** 静默检查；有新版就直接下。全程不打扰用户，下好了才提示。 */
export const checkAndDownload = async (): Promise<UpdateState> => {
  if (running) return state;
  if (state.stage === "ready") return state;
  running = true;
  try {
    emit({ stage: "checking", message: "正在检查更新" });
    const remote = await fetchRemote();
    const latest = String(remote?.version ?? "").trim();
    if (!remote?.available || !latest || !remote.url) {
      emit({ stage: "idle", message: "" });
      return state;
    }
    if (compareVersions(latest, app.getVersion()) <= 0) {
      emit({ stage: "idle", latest, message: "" });
      return state;
    }

    emit({ stage: "downloading", latest, percent: 0, receivedBytes: 0, totalBytes: remote.size ?? 0, message: `正在下载 v${latest}` });
    const readyPath = await download(remote);
    emit({ stage: "ready", percent: 100, readyPath, message: `v${latest} 已下载，重启后自动安装` });
  } catch (error) {
    emit({ stage: "error", message: error instanceof Error ? error.message : "更新失败", readyPath: "" });
  } finally {
    running = false;
  }
  return state;
};

/**
 * 执行更新。安装器会先把正在运行的旧版关掉，所以调用方紧接着退出即可。
 * 返回 false 表示没有可执行的更新包。
 */
export const runPendingUpdate = (): boolean => {
  if (state.stage !== "ready" || !state.readyPath) return false;
  try {
    const child = spawn(state.readyPath, ["--auto-update"], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return true;
  } catch (error) {
    console.error("启动更新安装器失败", error);
    return false;
  }
};

export const hasPendingUpdate = (): boolean => state.stage === "ready" && Boolean(state.readyPath);
