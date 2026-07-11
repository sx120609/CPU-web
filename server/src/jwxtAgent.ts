import { config } from "./config";
import { startJwxtAgentClient } from "./services/jwxtAgentClient";

if (!config.jwxtAgentServer || !config.jwxtAgentId || !config.jwxtAgentToken) {
  throw new Error("请配置 JWXT_AGENT_SERVER、JWXT_AGENT_ID 和 JWXT_AGENT_TOKEN");
}
if (config.nodeEnv === "production" && config.jwxtAgentServer.startsWith("ws://")) {
  console.warn("[jwxt-agent] 警告：生产环境正在使用明文 ws://，账号密码可能被窃听，请改用 wss://");
}

const client = startJwxtAgentClient({
  serverUrl: config.jwxtAgentServer,
  agentId: config.jwxtAgentId,
  token: config.jwxtAgentToken,
  reconnectMs: config.jwxtAgentReconnectMs,
});

const shutdown = () => {
  client.stop();
  setTimeout(() => process.exit(0), 50).unref?.();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
