import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function validateRepositoryRoot(value: string | undefined) {
  const repositoryRoot = path.resolve(value || "");
  if (
    !value
    || !existsSync(path.join(repositoryRoot, "deploy.sh"))
    || !existsSync(path.join(repositoryRoot, "deploy-agent.ps1"))
  ) {
    throw new Error("Agent 更新执行器收到的仓库目录无效");
  }
  return repositoryRoot;
}

function updateLogPath(repositoryRoot: string) {
  const logDirectory = path.join(repositoryRoot, "server", "logs");
  mkdirSync(logDirectory, { recursive: true });
  return path.join(logDirectory, "agent-remote-update.log");
}

function validateLockPath(repositoryRoot: string, value: string | undefined) {
  const expected = path.join(repositoryRoot, "server", "logs", "agent-remote-update.lock");
  if (!value || path.resolve(value) !== expected) {
    throw new Error("Agent 更新执行器收到的锁文件路径无效");
  }
  return expected;
}

async function launchWorker(repositoryRoot: string, lockPath: string) {
  const logPath = updateLogPath(repositoryRoot);
  await delay(1_500);
  appendFileSync(
    logPath,
    `\n[${new Date().toISOString()}] 收到主服务远程更新指令，正在启动独立 worker，平台=${process.platform}\n`,
    "utf8",
  );

  const worker = spawn(process.execPath, [__filename, "--worker", repositoryRoot, lockPath], {
    cwd: repositoryRoot,
    detached: true,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("spawn", resolve);
  });
  worker.unref();
}

async function runWorker(repositoryRoot: string, lockPath: string) {
  const logPath = updateLogPath(repositoryRoot);
  await delay(300);
  appendFileSync(logPath, `[${new Date().toISOString()}] 独立 worker 已启动\n`, "utf8");

  const output = openSync(logPath, "a");
  const command = process.platform === "win32" ? "powershell.exe" : "bash";
  const args = process.platform === "win32"
    ? [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(repositoryRoot, "deploy-agent.ps1"),
        "update",
      ]
    : [path.join(repositoryRoot, "deploy.sh"), "agent-update"];

  try {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", output, output],
      windowsHide: true,
    });
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    appendFileSync(logPath, `[${new Date().toISOString()}] 更新脚本退出，code=${exitCode}\n`, "utf8");
    process.exitCode = exitCode;
  } finally {
    closeSync(output);
    try {
      unlinkSync(lockPath);
    } catch {
      // 锁已被手动清理或超过失效时间。
    }
  }
}

async function run() {
  if (process.argv[2] === "--worker") {
    const repositoryRoot = validateRepositoryRoot(process.argv[3]);
    const lockPath = validateLockPath(repositoryRoot, process.argv[4]);
    await runWorker(repositoryRoot, lockPath);
    return;
  }
  const repositoryRoot = validateRepositoryRoot(process.argv[2]);
  const lockPath = validateLockPath(repositoryRoot, process.argv[3]);
  await launchWorker(repositoryRoot, lockPath);
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  try {
    const isWorker = process.argv[2] === "--worker";
    const repositoryRoot = path.resolve((isWorker ? process.argv[3] : process.argv[2]) || process.cwd());
    const lockPath = validateLockPath(repositoryRoot, isWorker ? process.argv[4] : process.argv[3]);
    appendFileSync(
      updateLogPath(repositoryRoot),
      `[${new Date().toISOString()}] 更新执行器失败: ${message}\n`,
      "utf8",
    );
    if (lockPath) unlinkSync(lockPath);
  } catch {
    // 此时没有可用的仓库路径，保持非零退出即可。
  }
  process.exitCode = 1;
});
