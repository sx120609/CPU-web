import { copyFile, mkdtemp, open, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { prisma } from "../prisma";
import { beginDatabaseMaintenance, endDatabaseMaintenance, getDatabaseMaintenanceMessage, isDatabaseMaintenanceActive } from "./maintenance";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");

export type DatabaseBackupStatus = {
  supported: boolean;
  provider: "sqlite-file" | "unsupported";
  exists: boolean;
  maintenanceActive: boolean;
  maintenanceMessage: string;
  databasePathLabel: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  downloadFileName: string | null;
  reason: string | null;
};

function databaseUrl() {
  return String(process.env.DATABASE_URL ?? "").trim().replace(/^"(.*)"$/, "$1");
}

function decodeFilePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveSqliteDatabasePath() {
  const raw = databaseUrl();
  if (!raw.startsWith("file:")) return null;

  let target = raw.slice("file:".length).split("?")[0].split("#")[0].trim();
  if (!target) return null;
  if (target.startsWith("//")) target = target.slice(2);
  target = decodeFilePath(target);

  if (path.isAbsolute(target)) return path.normalize(target);
  return path.resolve(process.cwd(), "prisma", target);
}

function displayPathLabel(filePath: string) {
  const relative = path.relative(process.cwd(), filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  return filePath;
}

function backupStamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function backupFileName(date = new Date()) {
  return `cpu-web-db-backup-${backupStamp(date)}.sqlite`;
}

function sqliteLiteral(value: string) {
  return value.replace(/'/g, "''");
}

async function removeIfExists(filePath: string) {
  await unlink(filePath).catch(() => undefined);
}

async function assertSqliteFile(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(buf, 0, SQLITE_HEADER.length, 0);
    if (bytesRead < SQLITE_HEADER.length) {
      throw new Error("上传文件过小，无法识别为 SQLite 数据库");
    }
    if (!buf.equals(SQLITE_HEADER)) {
      throw new Error("上传文件不是有效的 SQLite 数据库");
    }
  } finally {
    await handle.close();
  }
}

async function verifyQuickCheck() {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>("PRAGMA quick_check");
  const ok = rows.some((row) => Object.values(row).includes("ok"));
  if (!ok) throw new Error("恢复后的数据库未通过 quick_check 校验");
}

export async function getDatabaseBackupStatus(): Promise<DatabaseBackupStatus> {
  const dbPath = resolveSqliteDatabasePath();
  if (!dbPath) {
    return {
      supported: false,
      provider: "unsupported",
      exists: false,
      maintenanceActive: isDatabaseMaintenanceActive(),
      maintenanceMessage: getDatabaseMaintenanceMessage(),
      databasePathLabel: null,
      sizeBytes: null,
      updatedAt: null,
      downloadFileName: null,
      reason: "当前 DATABASE_URL 不是可直接下载的 SQLite 文件路径",
    };
  }

  const fileStat = await stat(dbPath).catch(() => null);
  return {
    supported: true,
    provider: "sqlite-file",
    exists: Boolean(fileStat),
    maintenanceActive: isDatabaseMaintenanceActive(),
    maintenanceMessage: getDatabaseMaintenanceMessage(),
    databasePathLabel: displayPathLabel(dbPath),
    sizeBytes: fileStat?.size ?? null,
    updatedAt: fileStat?.mtime.toISOString() ?? null,
    downloadFileName: backupFileName(),
    reason: fileStat ? null : "数据库文件当前不存在",
  };
}

export async function createDatabaseBackupSnapshot() {
  const dbPath = resolveSqliteDatabasePath();
  if (!dbPath) throw new Error("当前不是 SQLite 文件数据库，无法下载备份");
  await stat(dbPath).catch(() => {
    throw new Error("数据库文件不存在，无法下载备份");
  });

  const tempDir = await mkdtemp(path.join(tmpdir(), "cpu-web-db-backup-"));
  const snapshotPath = path.join(tempDir, `${path.basename(dbPath, path.extname(dbPath))}-${randomUUID()}.sqlite`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${sqliteLiteral(snapshotPath)}'`);
  return {
    filePath: snapshotPath,
    tempDir,
    fileName: backupFileName(),
  };
}

export async function cleanupDatabaseBackupSnapshot(snapshot: { filePath: string; tempDir: string }) {
  await removeIfExists(snapshot.filePath);
  await rm(snapshot.tempDir, { recursive: true, force: true }).catch(() => undefined);
}

export async function restoreDatabaseFromUpload(uploadPath: string) {
  const dbPath = resolveSqliteDatabasePath();
  if (!dbPath) throw new Error("当前不是 SQLite 文件数据库，无法执行恢复");
  if (!beginDatabaseMaintenance("数据库正在恢复，请稍后再试")) {
    throw new Error("已有数据库恢复任务正在进行，请稍后再试");
  }

  const stamp = backupStamp();
  const dbDir = path.dirname(dbPath);
  const ext = path.extname(dbPath) || ".sqlite";
  const base = path.basename(dbPath, ext);
  const token = randomUUID();
  const incomingPath = path.join(dbDir, `${base}.restore-${stamp}-${token}${ext}`);
  const safetyCopyPath = path.join(dbDir, `${base}.before-restore-${stamp}-${token}${ext}`);
  let movedCurrent = false;
  let installedIncoming = false;

  try {
    await assertSqliteFile(uploadPath);
    await copyFile(uploadPath, incomingPath);
    await assertSqliteFile(incomingPath);

    await prisma.$disconnect().catch(() => undefined);
    await removeIfExists(`${dbPath}-journal`);
    await removeIfExists(`${dbPath}-wal`);
    await removeIfExists(`${dbPath}-shm`);

    const currentStat = await stat(dbPath).catch(() => null);
    if (currentStat) {
      await rename(dbPath, safetyCopyPath);
      movedCurrent = true;
    }

    await rename(incomingPath, dbPath);
    installedIncoming = true;
    await verifyQuickCheck();

    const restoredStat = await stat(dbPath);
    return {
      restoredAt: new Date().toISOString(),
      databasePathLabel: displayPathLabel(dbPath),
      sizeBytes: restoredStat.size,
      safetyCopyPathLabel: movedCurrent ? displayPathLabel(safetyCopyPath) : null,
    };
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    if (installedIncoming) await removeIfExists(dbPath);
    if (movedCurrent) {
      await rename(safetyCopyPath, dbPath).catch(() => undefined);
    }
    throw error;
  } finally {
    await removeIfExists(incomingPath);
    endDatabaseMaintenance();
  }
}
