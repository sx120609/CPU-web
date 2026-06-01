import { spawn } from "node:child_process";
import path from "node:path";
import { beginDatabaseMaintenance, endDatabaseMaintenance, getDatabaseMaintenanceMessage, isDatabaseMaintenanceActive } from "./maintenance";

export type DatabaseMigrationRunRecord = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  clearTarget: boolean;
  batchSize: number;
  success: boolean;
  output: string;
};

export type DatabaseMigrationStatus = {
  supported: boolean;
  sourceProvider: "sqlite-file" | "unsupported";
  targetConfigured: boolean;
  targetDisplay: string | null;
  running: boolean;
  maintenanceActive: boolean;
  maintenanceMessage: string;
  reason: string | null;
  lastRun: DatabaseMigrationRunRecord | null;
};

type DatabaseMigrationOptions = {
  batchSize: number;
  clearTarget: boolean;
  dryRun: boolean;
};

const MAX_OUTPUT_CHARS = 240_000;

let migrationRunning = false;
let lastRun: DatabaseMigrationRunRecord | null = null;

function currentDatabaseUrl() {
  return String(process.env.DATABASE_URL ?? "").trim().replace(/^"(.*)"$/, "$1");
}

function targetDatabaseUrl() {
  return String(process.env.POSTGRES_DATABASE_URL ?? "").trim().replace(/^"(.*)"$/, "$1");
}

function trimOutput(value: string) {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `[output truncated, showing last ${MAX_OUTPUT_CHARS} chars]\n${value.slice(-MAX_OUTPUT_CHARS)}`;
}

function appendOutput(current: string, chunk: string) {
  return trimOutput(current + chunk);
}

function targetDisplayLabel(raw: string) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const user = decodeURIComponent(url.username || "");
    const auth = user ? `${user}@` : "";
    const dbName = url.pathname.replace(/^\/+/, "");
    const search = url.search || "";
    return `${url.protocol}//${auth}${url.host}/${dbName}${search}`;
  } catch {
    return raw.replace(/:[^:@/]+@/, ":***@");
  }
}

function migrationSupportState() {
  const source = currentDatabaseUrl();
  const target = targetDatabaseUrl();
  const sourceProvider = source.startsWith("file:") ? "sqlite-file" : "unsupported";
  return {
    sourceProvider,
    targetConfigured: Boolean(target),
    targetDisplay: targetDisplayLabel(target),
    reason:
      sourceProvider === "sqlite-file"
        ? null
        : "当前 DATABASE_URL 不是 SQLite 文件数据库，无法执行 SQLite -> PostgreSQL 迁移",
  } as const;
}

export function getDatabaseMigrationStatus(): DatabaseMigrationStatus {
  const support = migrationSupportState();
  return {
    supported: support.sourceProvider === "sqlite-file",
    sourceProvider: support.sourceProvider,
    targetConfigured: support.targetConfigured,
    targetDisplay: support.targetDisplay,
    running: migrationRunning,
    maintenanceActive: isDatabaseMaintenanceActive(),
    maintenanceMessage: getDatabaseMaintenanceMessage(),
    reason:
      support.reason ??
      (support.targetConfigured
        ? null
        : "未配置 POSTGRES_DATABASE_URL。可先在服务器执行 ./deploy.sh postgres-init，或手动 ./deploy.sh postgres-config 'postgresql://...'；正式迁移暂不可用，但 dry-run 仍可使用"),
    lastRun,
  };
}

export async function runDatabaseMigration(options: DatabaseMigrationOptions): Promise<DatabaseMigrationRunRecord> {
  const support = migrationSupportState();
  if (migrationRunning) {
    throw new Error("已有数据库迁移任务正在进行，请稍后再试");
  }
  if (support.sourceProvider !== "sqlite-file") {
    throw new Error(support.reason || "当前数据库不支持迁移");
  }
  if (!options.dryRun && !support.targetConfigured) {
    throw new Error("未配置 POSTGRES_DATABASE_URL，无法开始正式迁移");
  }

  const startedAt = new Date();
  const scriptPath = path.resolve(process.cwd(), "scripts", "migrate-sqlite-to-postgres.mjs");
  const args = [scriptPath, `--batch-size=${options.batchSize}`];
  if (options.clearTarget) args.push("--clear-target");
  if (options.dryRun) args.push("--dry-run");

  migrationRunning = true;
  let maintenanceStarted = false;
  if (!options.dryRun) {
    maintenanceStarted = beginDatabaseMaintenance("数据库正在迁移到 PostgreSQL，请稍后再试");
    if (!maintenanceStarted) {
      migrationRunning = false;
      throw new Error("当前数据库正处于维护状态，暂时无法开始迁移");
    }
  }

  try {
    const record = await new Promise<DatabaseMigrationRunRecord>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      child.stdout.on("data", (chunk) => {
        output = appendOutput(output, String(chunk));
      });
      child.stderr.on("data", (chunk) => {
        output = appendOutput(output, String(chunk));
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code) => {
        const finishedAt = new Date();
        const result: DatabaseMigrationRunRecord = {
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          dryRun: options.dryRun,
          clearTarget: options.clearTarget,
          batchSize: options.batchSize,
          success: code === 0,
          output: trimOutput(output.trim()),
        };
        lastRun = result;
        if (code === 0) resolve(result);
        else reject(Object.assign(new Error(`数据库迁移失败，退出码 ${code ?? "unknown"}`), { result }));
      });
    });
    return record;
  } finally {
    migrationRunning = false;
    if (maintenanceStarted) endDatabaseMaintenance();
  }
}
