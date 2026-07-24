import { appendFileSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
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

async function run() {
  const repositoryRoot = validateRepositoryRoot(process.argv[2]);
  const logDirectory = path.join(repositoryRoot, "server", "logs");
  const logPath = path.join(logDirectory, "agent-remote-update.log");
  mkdirSync(logDirectory, { recursive: true });

  await delay(1_500);
  appendFileSync(
    logPath,
    `\n[${new Date().toISOString()}] 收到主服务远程更新指令，平台=${process.platform}\n`,
    "utf8",
  );

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
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  try {
    const repositoryRoot = path.resolve(process.argv[2] || process.cwd());
    const logDirectory = path.join(repositoryRoot, "server", "logs");
    mkdirSync(logDirectory, { recursive: true });
    appendFileSync(
      path.join(logDirectory, "agent-remote-update.log"),
      `[${new Date().toISOString()}] 更新执行器失败: ${message}\n`,
      "utf8",
    );
  } catch {
    // 此时没有可用的仓库路径，保持非零退出即可。
  }
  process.exitCode = 1;
});
