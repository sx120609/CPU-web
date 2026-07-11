import { config } from "./config";
import { startJwxtAgentClient } from "./services/jwxtAgentClient";

if (!config.loginAgentServer || !config.loginAgentId || !config.loginAgentToken) {
  throw new Error("请配置 LOGIN_AGENT_SERVER、LOGIN_AGENT_ID 和 LOGIN_AGENT_TOKEN");
}
if (config.nodeEnv === "production" && config.loginAgentServer.startsWith("ws://")) {
  console.warn("[jwxt-agent] 警告：生产环境正在使用明文 ws://，账号密码可能被窃听，请改用 wss://");
}

const client = startJwxtAgentClient({
  serverUrl: config.loginAgentServer,
  agentId: config.loginAgentId,
  token: config.loginAgentToken,
  reconnectMs: config.loginAgentReconnectMs,
});

const shutdown = () => {
  client.stop();
  setTimeout(() => process.exit(0), 50).unref?.();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
