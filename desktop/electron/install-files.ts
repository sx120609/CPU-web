import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export type InstallEntry = { from: string; to: string; size: number };

const errorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as NodeJS.ErrnoException).code ?? "")
    : "";

const withPhase = (phase: string, error: unknown): NodeJS.ErrnoException => {
  const detail = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(`${phase}：${detail}`, { cause: error }) as NodeJS.ErrnoException;
  wrapped.code = errorCode(error);
  return wrapped;
};

/**
 * New bytes are staged beside the destination before the old file moves. This keeps an
 * interrupted upgrade from leaving a loaded Electron DLL missing or half-written.
 */
export const placeInstallFile = async (entry: InstallEntry): Promise<void> => {
  const nonce = `${process.pid}-${Date.now().toString(36)}-${randomUUID()}`;
  const staged = `${entry.to}.installing-${nonce}`;
  const parked = `${entry.to}.old-${nonce}`;
  let parkedOld = false;

  try {
    await copyFile(entry.from, staged).catch((error) => {
      throw withPhase("准备新文件失败", error);
    });

    try {
      const current = await lstat(entry.to);
      if (!current.isFile()) throw new Error(`目标路径不是普通文件：${entry.to}`);
      await rename(entry.to, parked);
      parkedOld = true;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw withPhase("旧文件让路失败", error);
    }

    try {
      await rename(staged, entry.to);
    } catch (error) {
      if (parkedOld) {
        try {
          await rename(parked, entry.to);
          parkedOld = false;
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `写入新文件失败，旧文件保存在 ${parked}，自动恢复也失败`
          );
        }
      }
      throw withPhase("写入新文件失败", error);
    }

    if (parkedOld) {
      await rm(parked, { force: true }).catch(() => undefined);
    }
  } finally {
    await rm(staged, { force: true }).catch(() => undefined);
  }
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
