import { execFile, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { config } from "../config";

const execFileAsync = promisify(execFile);
const DEPLOY_CONFIRMATION = "UPDATE_AND_DEPLOY";
const STATUS_FILE_NAME = "status.json";
const LOG_FILE_NAME = "deploy.log";
const LOCK_FILE_NAME = "deploy.lock";
const MAX_LOG_BYTES = 160 * 1024;
const MAX_LOG_LINES = 240;
const FRESH_LOCK_MS = 2 * 60_000;
const CONTEXT_CACHE_MS = 3_000;

export type DeploymentPhase = "idle" | "running" | "success" | "failed";

type StoredDeploymentState = {
  version: 1;
  id: string;
  phase: Exclude<DeploymentPhase, "idle">;
  requestedAt: string;
  startedAt: string;
  finishedAt: string | null;
  operatorId: number;
  pid: number | null;
  exitCode: number | null;
  deployedCommit: string;
  message: string;
};

export type AdminDeploymentStatus = {
  available: boolean;
  unavailableReason: string;
  phase: DeploymentPhase;
  id: string;
  requestedAt: string;
  startedAt: string;
  finishedAt: string | null;
  operatorId: number | null;
  pid: number | null;
  exitCode: number | null;
  currentCommit: string;
  successfulDeployCommit: string;
  branch: string;
  deployedCommit: string;
  message: string;
  logs: string[];
};

type DeploymentContext = {
  root: string | null;
  gitDir: string | null;
  statusDir: string | null;
  runnerPath: string | null;
  available: boolean;
  unavailableReason: string;
  currentCommit: string;
  successfulDeployCommit: string;
  branch: string;
};

export class DeploymentUnavailableError extends Error {}
export class DeploymentAlreadyRunningError extends Error {}

let deploymentContextCache: { expiresAt: number; value: DeploymentContext } | null = null;

function projectRootCandidates() {
  return Array.from(new Set([
    String(process.env.CPU_WEB_DEPLOY_ROOT || "").trim(),
    path.resolve(process.cwd(), ".."),
    process.cwd(),
    path.resolve(__dirname, "../../.."),
  ].filter(Boolean)));
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveProjectRoot() {
  for (const candidate of projectRootCandidates()) {
    if (
      await fileExists(path.join(candidate, "deploy.sh"))
      && await fileExists(path.join(candidate, "server", "package.json"))
      && await fileExists(path.join(candidate, "web", "package.json"))
    ) {
      return candidate;
    }
  }
  return null;
}

async function gitValue(root: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      timeout: 3_000,
      windowsHide: true,
      maxBuffer: 128 * 1024,
    });
    return String(stdout).trim();
  } catch {
    return "";
  }
}

async function readSuccessfulDeployCommit(root: string) {
  const stateFile = await gitValue(root, ["rev-parse", "--git-path", "cpu-web-last-successful-deploy"]);
  if (!stateFile) return "";
  const absolute = path.isAbsolute(stateFile) ? stateFile : path.resolve(root, stateFile);
  try {
    return (await readFile(absolute, "utf8")).trim();
  } catch {
    return "";
  }
}

async function buildDeploymentContext(): Promise<DeploymentContext> {
  const root = await resolveProjectRoot();
  if (!root) {
    return {
      root: null,
      gitDir: null,
      statusDir: null,
      runnerPath: null,
      available: false,
      unavailableReason: "未找到 CPU-web 部署目录或 deploy.sh",
      currentCommit: "",
      successfulDeployCommit: "",
      branch: "",
    };
  }

  const [gitDirRaw, currentCommit, successfulDeployCommit, branch] = await Promise.all([
    gitValue(root, ["rev-parse", "--absolute-git-dir"]),
    gitValue(root, ["rev-parse", "HEAD"]),
    readSuccessfulDeployCommit(root),
    gitValue(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  const gitDir = gitDirRaw ? path.resolve(gitDirRaw) : null;
  const statusDir = gitDir ? path.join(gitDir, "cpu-web-admin-deploy") : null;
  const runnerPath = path.join(root, "server", "scripts", "admin-deploy-runner.mjs");

  let unavailableReason = "";
  if (!config.adminDeployEnabled) unavailableReason = "后台部署功能已通过 ADMIN_DEPLOY_ENABLED 关闭";
  else if (config.nodeEnv !== "production") unavailableReason = "后台部署仅在生产环境开放";
  else if (process.platform !== "linux") unavailableReason = "后台部署仅支持 Linux 主站部署机";
  else if (!gitDir || !currentCommit) unavailableReason = "当前目录不是可更新的 Git 工作区";
  else if (!await fileExists(runnerPath)) unavailableReason = "部署 runner 缺失，请先完成一次常规部署";
  else if (!await fileExists("/usr/bin/bash") && !await fileExists("/bin/bash")) unavailableReason = "服务器未安装 Bash";

  return {
    root,
    gitDir,
    statusDir,
    runnerPath,
    available: !unavailableReason,
    unavailableReason,
    currentCommit,
    successfulDeployCommit,
    branch,
  };
}

async function resolveDeploymentContext(): Promise<DeploymentContext> {
  if (deploymentContextCache && deploymentContextCache.expiresAt > Date.now()) {
    return deploymentContextCache.value;
  }
  const value = await buildDeploymentContext();
  deploymentContextCache = { expiresAt: Date.now() + CONTEXT_CACHE_MS, value };
  return value;
}

function normalizeStoredState(value: unknown): StoredDeploymentState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<StoredDeploymentState>;
  if (
    input.version !== 1
    || typeof input.id !== "string"
    || !["running", "success", "failed"].includes(String(input.phase))
    || typeof input.requestedAt !== "string"
    || typeof input.startedAt !== "string"
    || !Number.isInteger(input.operatorId)
  ) return null;
  return {
    version: 1,
    id: input.id,
    phase: input.phase as StoredDeploymentState["phase"],
    requestedAt: input.requestedAt,
    startedAt: input.startedAt,
    finishedAt: typeof input.finishedAt === "string" ? input.finishedAt : null,
    operatorId: Number(input.operatorId),
    pid: Number.isInteger(input.pid) && Number(input.pid) > 0 ? Number(input.pid) : null,
    exitCode: Number.isInteger(input.exitCode) ? Number(input.exitCode) : null,
    deployedCommit: typeof input.deployedCommit === "string" ? input.deployedCommit : "",
    message: typeof input.message === "string" ? input.message : "",
  };
}

async function readStoredState(statusDir: string | null) {
  if (!statusDir) return null;
  try {
    return normalizeStoredState(JSON.parse(await readFile(path.join(statusDir, STATUS_FILE_NAME), "utf8")));
  } catch {
    return null;
  }
}

async function writeStoredState(statusDir: string, state: StoredDeploymentState) {
  await mkdir(statusDir, { recursive: true, mode: 0o700 });
  const target = path.join(statusDir, STATUS_FILE_NAME);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

function processIsRunning(pid: number | null) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === "EPERM") return true;
    return false;
  }
}

export function sanitizeDeploymentLog(raw: string) {
  const cleaned = raw
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1***")
    .replace(/((?:token|secret|password|database_url|redis_url|api_key)\s*=\s*)[^\s]+/gi, "$1***")
    .replace(/(https?:\/\/[^:/\s]+:)[^@\s]+@/gi, "$1***@")
    .replace(/[^\t\n\r\x20-\x7e\u0080-\uffff]/g, "");
  return cleaned
    .split(/\r?\n/)
    .map((line) => line.slice(0, 2_000))
    .filter((line, index, lines) => line || index < lines.length - 1)
    .slice(-MAX_LOG_LINES);
}

async function readDeploymentLog(statusDir: string | null) {
  if (!statusDir) return [];
  const logPath = path.join(statusDir, LOG_FILE_NAME);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(logPath, "r");
    const info = await handle.stat();
    const length = Math.min(info.size, MAX_LOG_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, info.size - length));
    return sanitizeDeploymentLog(buffer.toString("utf8"));
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function statusFrom(
  context: DeploymentContext,
  stored: StoredDeploymentState | null,
  logs: string[],
): AdminDeploymentStatus {
  let phase: DeploymentPhase = stored?.phase ?? "idle";
  let message = stored?.message ?? "尚未通过后台执行部署";
  const startedAt = stored ? Date.parse(stored.startedAt) : Number.NaN;
  const runnerIsStarting = Boolean(
    stored?.pid === null
    && Number.isFinite(startedAt)
    && Date.now() - startedAt < FRESH_LOCK_MS,
  );
  if (phase === "running" && stored && !runnerIsStarting && !processIsRunning(stored.pid)) {
    phase = "failed";
    message = "部署 runner 已中断，请查看日志后重试";
  }
  return {
    available: context.available,
    unavailableReason: context.unavailableReason,
    phase,
    id: stored?.id ?? "",
    requestedAt: stored?.requestedAt ?? "",
    startedAt: stored?.startedAt ?? "",
    finishedAt: stored?.finishedAt ?? null,
    operatorId: stored?.operatorId ?? null,
    pid: stored?.pid ?? null,
    exitCode: stored?.exitCode ?? null,
    currentCommit: context.currentCommit,
    successfulDeployCommit: context.successfulDeployCommit,
    branch: context.branch,
    deployedCommit: stored?.deployedCommit ?? "",
    message,
    logs,
  };
}

export async function getAdminDeploymentStatus() {
  const context = await resolveDeploymentContext();
  const [stored, logs] = await Promise.all([
    readStoredState(context.statusDir),
    readDeploymentLog(context.statusDir),
  ]);
  return statusFrom(context, stored, logs);
}

async function acquireDeploymentLock(statusDir: string) {
  await mkdir(statusDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(statusDir, LOCK_FILE_NAME);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ createdAt: new Date().toISOString(), ownerPid: process.pid })}\n`);
      } catch (error) {
        await unlink(lockPath).catch(() => undefined);
        throw error;
      } finally {
        await handle.close().catch(() => undefined);
      }
      return lockPath;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const [stored, lockStat] = await Promise.all([
        readStoredState(statusDir),
        stat(lockPath).catch(() => null),
      ]);
      const freshLock = Boolean(lockStat && Date.now() - lockStat.mtimeMs < FRESH_LOCK_MS);
      if ((stored?.phase === "running" && processIsRunning(stored.pid)) || freshLock) {
        throw new DeploymentAlreadyRunningError("已有更新部署任务正在执行");
      }
      await unlink(lockPath).catch(() => undefined);
    }
  }
  throw new DeploymentAlreadyRunningError("部署锁正在被占用，请稍后重试");
}

export async function startAdminDeploymentUpdate(input: { operatorId: number; confirmation: string }) {
  if (input.confirmation !== DEPLOY_CONFIRMATION) {
    throw new DeploymentUnavailableError("部署确认信息不正确");
  }
  const context = await resolveDeploymentContext();
  if (!context.available || !context.root || !context.statusDir || !context.runnerPath) {
    throw new DeploymentUnavailableError(context.unavailableReason || "当前环境不能执行后台部署");
  }

  const lockPath = await acquireDeploymentLock(context.statusDir);
  const now = new Date().toISOString();
  const id = randomUUID();
  const initialState: StoredDeploymentState = {
    version: 1,
    id,
    phase: "running",
    requestedAt: now,
    startedAt: now,
    finishedAt: null,
    operatorId: input.operatorId,
    pid: null,
    exitCode: null,
    deployedCommit: "",
    message: "已提交更新部署任务，等待 runner 启动",
  };

  try {
    await writeStoredState(context.statusDir, initialState);
    const child = spawn(process.execPath, [
      context.runnerPath,
      context.root,
      context.statusDir,
      id,
      now,
      String(input.operatorId),
    ], {
      cwd: context.root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, CPU_WEB_ADMIN_DEPLOY: "1" },
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    initialState.pid = child.pid ?? null;
    initialState.message = "正在拉取代码并执行增量部署";
    // runner 会自行持久化状态。这里不再覆盖文件，避免极快任务已经成功后
    // 被父进程迟到的 running 状态写回。
    return statusFrom(context, initialState, []);
  } catch (error) {
    await unlink(lockPath).catch(() => undefined);
    initialState.phase = "failed";
    initialState.finishedAt = new Date().toISOString();
    initialState.message = "部署 runner 启动失败";
    await writeStoredState(context.statusDir, initialState).catch(() => undefined);
    throw error;
  }
}
