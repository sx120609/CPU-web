import { config } from "./config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { startJwxtAgentClient } from "./services/jwxtAgentClient";
import { loadOrCreateAgentReplicaIdentity } from "./services/jwxtAgentReplicaCrypto";

if (!config.jwxtAgentServer || !config.jwxtAgentId || !config.jwxtAgentToken) {
  throw new Error("请配置 JWXT_AGENT_SERVER、JWXT_AGENT_ID 和 JWXT_AGENT_TOKEN");
}
if (config.nodeEnv === "production" && config.jwxtAgentServer.startsWith("ws://")) {
  console.warn("[jwxt-agent] 警告：生产环境正在使用明文 ws://，账号密码可能被窃听，请改用 wss://");
}

let buildCommit = "";
try {
  const value = readFileSync(path.join(__dirname, "deployment-commit.txt"), "utf8").trim();
  if (/^[a-f0-9]{40}$/.test(value)) buildCommit = value;
} catch {
  // 开发运行或旧制品没有提交标记，不把仓库 HEAD 当成实际运行版本。
}

const client = startJwxtAgentClient({
  serverUrl: config.jwxtAgentServer,
  agentId: config.jwxtAgentId,
  token: config.jwxtAgentToken,
  reconnectMs: config.jwxtAgentReconnectMs,
  replicaIdentity: loadOrCreateAgentReplicaIdentity(config.jwxtAgentKeyFile),
  buildCommit,
});

const shutdown = () => {
  client.stop();
  setTimeout(() => process.exit(0), 50).unref?.();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
