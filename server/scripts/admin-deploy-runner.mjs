#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

const [root, statusDir, id, requestedAt, rawOperatorId] = process.argv.slice(2);
const operatorId = Number(rawOperatorId);
const startedAt = new Date().toISOString();
const statusPath = path.join(statusDir || "", "status.json");
const lockPath = path.join(statusDir || "", "deploy.lock");
const logPath = path.join(statusDir || "", "deploy.log");
let logFd = null;
let finished = false;

function writeStatus(state) {
  mkdirSync(statusDir, { recursive: true, mode: 0o700 });
  const temporary = `${statusPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, statusPath);
}

function appendLog(message) {
  if (logFd === null) return;
  writeSync(logFd, `${message}\n`);
}

function currentCommit() {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 3_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function finish(phase, exitCode, message) {
  if (finished) return;
  finished = true;
  const deployedCommit = currentCommit();
  try {
    appendLog(`[admin-deploy] ${message}${deployedCommit ? ` (${deployedCommit.slice(0, 12)})` : ""}`);
    writeStatus({
      id,
      phase,
      requestedAt,
      startedAt,
      finishedAt: new Date().toISOString(),
      operatorId,
      pid: process.pid,
      exitCode,
      deployedCommit,
      message,
    });
  } finally {
    rmSync(lockPath, { force: true });
    if (logFd !== null) closeSync(logFd);
  }
  process.exitCode = phase === "success" ? 0 : 1;
}

try {
  if (!root || !statusDir || !id || !requestedAt || !Number.isInteger(operatorId) || operatorId <= 0) {
    throw new Error("runner 参数不完整");
  }
  const deployScript = path.join(root, "deploy.sh");
  if (!existsSync(deployScript)) throw new Error("deploy.sh 不存在");
  const bashPath = existsSync("/usr/bin/bash") ? "/usr/bin/bash" : "/bin/bash";
  if (!existsSync(bashPath)) throw new Error("Bash 不存在");

  mkdirSync(statusDir, { recursive: true, mode: 0o700 });
  logFd = openSync(logPath, "w", 0o600);
  appendLog(`[admin-deploy] ${startedAt} 管理员 #${operatorId} 发起更新部署`);
  appendLog(`[admin-deploy] 执行固定命令: bash deploy.sh update`);
  writeStatus({
    id,
    phase: "running",
    requestedAt,
    startedAt,
    finishedAt: null,
    operatorId,
    pid: process.pid,
    exitCode: null,
    deployedCommit: "",
    message: "正在拉取代码并执行增量部署",
  });

  const child = spawn(bashPath, [deployScript, "update"], {
    cwd: root,
    env: { ...process.env, CPU_WEB_ADMIN_DEPLOY: "1" },
    stdio: ["ignore", logFd, logFd],
  });
  child.once("error", (error) => finish("failed", 1, `部署命令启动失败：${error.message}`));
  child.once("close", (code, signal) => {
    if (code === 0) finish("success", 0, "更新部署完成");
    else finish("failed", Number.isInteger(code) ? code : 1, `更新部署失败${signal ? `（${signal}）` : ""}`);
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    if (logFd === null && statusDir) {
      mkdirSync(statusDir, { recursive: true, mode: 0o700 });
      logFd = openSync(logPath, "a", 0o600);
    }
    finish("failed", 1, `部署 runner 启动失败：${message}`);
  } catch {
    rmSync(lockPath, { force: true });
    process.exitCode = 1;
  }
}
