import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export type InstallEntry = { from: string; to: string; size: number };

const errorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as NodeJS.ErrnoException).code ?? "")
    : "";

/** 安全软件扫描新写入的 DLL 时会短暂锁住它，这几类错误值得等一等再试 */
const TRANSIENT_CODES = new Set(["EPERM", "EBUSY", "EACCES", "UNKNOWN"]);

export const isTransientFsError = (error: unknown): boolean => TRANSIENT_CODES.has(errorCode(error));

export type InstallFs = {
  copyFile: (from: string, to: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (target: string, options: { force: true }) => Promise<void>;
  lstat: (target: string) => Promise<{ isFile: () => boolean }>;
};

const nodeFs: InstallFs = { copyFile, rename, rm, lstat };

export type RetryEvent = { file: string; attempt: number; waitedMs: number; code: string };

export type InstallTreeOptions = {
  /** 单个文件操作最多等多久。杀软扫一个 DLL 通常不到一秒，偶尔要十几秒 */
  retryBudgetMs?: number;
  onRetry?: (event: RetryEvent) => void;
  onProgress?: (event: { phase: "stage" | "swap"; bytes: number; total: number }) => void;
  fs?: InstallFs;
  sleep?: (ms: number) => Promise<void>;
};

export type InstallTreeStage = "stage" | "swap" | "rollback";

/** 带上失败阶段与文件，界面据此给出对症的提示，上报也靠它归类 */
export class InstallTreeError extends Error {
  constructor(
    message: string,
    readonly stage: InstallTreeStage,
    readonly file: string,
    readonly code: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Node 的 rename/copyFile 在 Windows 上一次失败就放弃；graceful-fs 为了同一个原因
 * （杀软扫描时文件被锁）会对 EPERM/EBUSY 重试一分钟。这里做同样的事，但预算短一些，
 * 并把每次等待报给界面，让用户知道是在等安全软件而不是卡死了。
 */
const retryTransient = async <T>(
  file: string,
  op: () => Promise<T>,
  options: InstallTreeOptions,
  counter: { retries: number }
): Promise<T> => {
  const budget = options.retryBudgetMs ?? 20_000;
  const sleep = options.sleep ?? defaultSleep;
  const started = Date.now();
  let wait = 50;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await op();
    } catch (error) {
      const waitedMs = Date.now() - started;
      if (!isTransientFsError(error) || waitedMs >= budget) throw error;
      counter.retries += 1;
      options.onRetry?.({ file, attempt, waitedMs, code: errorCode(error) });
      await sleep(Math.min(wait, Math.max(budget - waitedMs, 0)));
      wait = Math.min(wait * 2, 1000);
    }
  }
};

type PlanItem = InstallEntry & { staged: string; parked: string; parkedOld: boolean; placed: boolean };

export type InstallTreeResult = { retries: number; leftovers: string[] };

/**
 * 整棵目录当作一次事务：
 *   1. 所有新文件先以 .installing-* 写在各自目标旁边。最耗时的复制与杀软扫描都发生在
 *      这一步，此时旧版一个字节都没动，失败了直接清掉临时文件即可。
 *   2. 逐个把旧文件改名让路（运行中被加载的 DLL 只能改名不能覆盖），再把新文件换进来。
 *   3. 任何一步失败，把已经换进去的全部换回旧文件 —— 不会留下一半新一半旧、
 *      连旧版都打不开的目录。
 * 成功后才删掉让路的旧文件；删不掉的（仍被占用）留给下次启动的 sweepReplacedFiles。
 */
export const installTree = async (
  entries: InstallEntry[],
  options: InstallTreeOptions = {}
): Promise<InstallTreeResult> => {
  const fs = options.fs ?? nodeFs;
  const counter = { retries: 0 };
  const retry = <T>(file: string, op: () => Promise<T>) => retryTransient(file, op, options, counter);
  const nonce = `${process.pid}-${Date.now().toString(36)}-${randomUUID()}`;
  const plan: PlanItem[] = entries.map((entry) => ({
    ...entry,
    staged: `${entry.to}.installing-${nonce}`,
    parked: `${entry.to}.old-${nonce}`,
    parkedOld: false,
    placed: false
  }));
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);

  const fail = (stage: InstallTreeStage, item: InstallEntry, phase: string, error: unknown): InstallTreeError => {
    const detail = error instanceof Error ? error.message : String(error);
    return new InstallTreeError(`${phase}：${detail}`, stage, item.to, errorCode(error), { cause: error });
  };

  try {
    let staged = 0;
    for (const item of plan) {
      await retry(item.to, () => fs.copyFile(item.from, item.staged)).catch((error) => {
        throw fail("stage", item, "准备新文件失败", error);
      });
      staged += item.size;
      options.onProgress?.({ phase: "stage", bytes: staged, total });
    }

    let swapped = 0;
    for (const item of plan) {
      try {
        const current = await fs.lstat(item.to);
        if (!current.isFile()) throw new Error(`目标路径不是普通文件：${item.to}`);
        await retry(item.to, () => fs.rename(item.to, item.parked));
        item.parkedOld = true;
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw fail("swap", item, "旧文件让路失败", error);
      }

      try {
        await retry(item.to, () => fs.rename(item.staged, item.to));
      } catch (renameError) {
        // 暂存文件一直被扫描器攥着时，改为直接从安装包复制一份到正式位置
        try {
          await retry(item.to, () => fs.copyFile(item.from, item.to));
        } catch {
          throw fail("swap", item, "写入新文件失败", renameError);
        }
      }
      item.placed = true;
      swapped += item.size;
      options.onProgress?.({ phase: "swap", bytes: swapped, total });
    }
  } catch (error) {
    const unrestored: string[] = [];
    for (const item of [...plan].reverse()) {
      try {
        // Windows 上 rename 会替换已存在的目标，所以旧文件可以直接盖回去
        if (item.parkedOld) await retry(item.to, () => fs.rename(item.parked, item.to));
        else if (item.placed) await retry(item.to, () => fs.rm(item.to, { force: true }));
      } catch {
        unrestored.push(item.parkedOld ? item.parked : item.to);
      }
    }
    if (unrestored.length > 0) {
      const first = error instanceof InstallTreeError ? error : null;
      throw new InstallTreeError(
        `安装中断且有 ${unrestored.length} 个旧文件未能恢复（${path.basename(unrestored[0])}）：`
          + (error instanceof Error ? error.message : String(error)),
        "rollback",
        first?.file ?? unrestored[0],
        first?.code ?? errorCode(error),
        { cause: error }
      );
    }
    throw error;
  } finally {
    for (const item of plan) await fs.rm(item.staged, { force: true }).catch(() => undefined);
  }

  const leftovers: string[] = [];
  for (const item of plan) {
    if (!item.parkedOld) continue;
    await fs.rm(item.parked, { force: true }).catch(() => leftovers.push(item.parked));
  }
  return { retries: counter.retries, leftovers };
};

type LockOwner = { pid: number; createdAt: number };

export type InstallLock = { release: () => Promise<void> };

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
};

const readLockOwner = async (lockPath: string): Promise<LockOwner | null> => {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Partial<LockOwner>;
    const pid = Number(value.pid);
    const createdAt = Number(value.createdAt);
    return Number.isInteger(pid) && pid > 0 && Number.isFinite(createdAt) && createdAt > 0
      ? { pid, createdAt }
      : null;
  } catch {
    return null;
  }
};

const lockIsStale = async (lockPath: string): Promise<boolean> => {
  const owner = await readLockOwner(lockPath);
  if (owner) {
    if (Date.now() - owner.createdAt > 2 * 60 * 60 * 1000) return true;
    return !processExists(owner.pid);
  }
  const age = Date.now() - (await stat(lockPath)).mtimeMs;
  return age > 5_000;
};

/** A target-directory lock also coordinates separately launched copies of the portable installer. */
export const acquireInstallLock = async (directory: string): Promise<InstallLock | null> => {
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, ".install.lock");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }), "utf8");
        await handle.sync();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }

      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          await handle.close().catch(() => undefined);
          await rm(lockPath, { force: true }).catch(() => undefined);
        }
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (!(await lockIsStale(lockPath).catch(() => false))) return null;

      const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
      try {
        await rename(lockPath, stalePath);
        await rm(stalePath, { force: true }).catch(() => undefined);
      } catch (reclaimError) {
        if (errorCode(reclaimError) !== "ENOENT") return null;
      }
    }
  }
  return null;
};
