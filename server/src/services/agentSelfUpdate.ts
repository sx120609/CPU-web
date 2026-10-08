import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const UPDATE_LOCK_STALE_MS = 30 * 60_000;

// A root-owned systemd.path unit handles artifact-only installations. The Agent
// writes only a request marker; neither payloads nor commands cross this boundary.
export function queueManagedAgentUpdate(requestFile: string, now = Date.now()) {
  if (!path.isAbsolute(requestFile) || path.basename(requestFile) !== "agent-remote-update.request") {
    throw new Error("Agent 托管更新请求路径无效");
  }
  const requestedAt = new Date(now).toISOString();
  if (existsSync(requestFile)) {
    if (now - statSync(requestFile).mtimeMs < UPDATE_LOCK_STALE_MS) {
      return { accepted: true as const, alreadyScheduled: true, requestedAt };
    }
    unlinkSync(requestFile);
  }
  try {
    writeFileSync(requestFile, `${requestedAt}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      return { accepted: true as const, alreadyScheduled: true, requestedAt };
    }
    throw error;
  }
  return { accepted: true as const, alreadyScheduled: false, requestedAt };
}

function findRepositoryRoot() {
  const starts = [
    process.cwd(),
    path.resolve(__dirname, "..", ".."),
  ];

  for (const start of starts) {
    let current = path.resolve(start);
    for (let depth = 0; depth < 8; depth += 1) {
      if (existsSync(path.join(current, "deploy.sh")) && existsSync(path.join(current, "deploy-agent.ps1"))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  throw new Error("无法定位 Agent 仓库目录，远程更新未启动");
}

export function scheduleAgentSelfUpdate() {
  const managedRequestFile = process.env.JWXT_AGENT_UPDATE_REQUEST_FILE;
  if (managedRequestFile) {
    if (process.platform !== "linux") throw new Error("Agent 托管更新只支持 Linux systemd");
    return queueManagedAgentUpdate(managedRequestFile);
  }
  const requestedAt = new Date().toISOString();
  const repositoryRoot = findRepositoryRoot();
  const runnerPath = path.resolve(__dirname, "..", "agentUpdateRunner.js");
  if (!existsSync(runnerPath)) {
    throw new Error(`缺少 Agent 更新执行器: ${runnerPath}`);
  }
  const logDirectory = path.join(repositoryRoot, "server", "logs");
  const lockPath = path.join(logDirectory, "agent-remote-update.lock");
  mkdirSync(logDirectory, { recursive: true });

  if (existsSync(lockPath)) {
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (ageMs < UPDATE_LOCK_STALE_MS) {
      return { accepted: true as const, alreadyScheduled: true, requestedAt };
    }
    unlinkSync(lockPath);
  }

  try {
    writeFileSync(lockPath, `${requestedAt}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      return { accepted: true as const, alreadyScheduled: true, requestedAt };
    }
    throw error;
  }

  const child = spawn(process.execPath, [runnerPath, repositoryRoot, lockPath], {
    cwd: repositoryRoot,
    detached: true,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", (error) => {
    try {
      unlinkSync(lockPath);
    } catch {
      // 更新 worker 已接管或锁文件已经清理。
    }
    console.error(`[jwxt-agent] 远程更新执行器启动失败: ${error.message}`);
  });
  child.unref();

  return { accepted: true as const, alreadyScheduled: false, requestedAt };
}
