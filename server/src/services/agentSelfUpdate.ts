import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

let updateScheduled = false;

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
  const requestedAt = new Date().toISOString();
  if (updateScheduled) {
    return { accepted: true as const, alreadyScheduled: true, requestedAt };
  }

  const repositoryRoot = findRepositoryRoot();
  const runnerPath = path.resolve(__dirname, "..", "agentUpdateRunner.js");
  if (!existsSync(runnerPath)) {
    throw new Error(`缺少 Agent 更新执行器: ${runnerPath}`);
  }

  const child = spawn(process.execPath, [runnerPath, repositoryRoot], {
    cwd: repositoryRoot,
    detached: true,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", (error) => {
    updateScheduled = false;
    console.error(`[jwxt-agent] 远程更新执行器启动失败: ${error.message}`);
  });
  child.unref();
  updateScheduled = true;

  return { accepted: true as const, alreadyScheduled: false, requestedAt };
}
