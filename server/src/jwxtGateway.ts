import { createServer } from "node:http";
import crypto from "node:crypto";
import { config } from "./config";
import { attachJwxtAgentGateway, getJwxtAgentReplicaRecipients, getJwxtAgentState, requestJwxtAgent } from "./services/jwxtAgentGateway";
import { getJwxtAgentRuntimeConfig, loadJwxtAgentRuntimeConfig } from "./services/jwxtAgentConfig";
import { createGatewayRpc, gatewayCredentials } from "./services/jwxtGatewayTransport";
import { onRedisBroadcast, startRedisSubscriptions } from "./services/redis";
import type { JwxtAgentAction } from "./services/jwxtAgentProtocol";

async function start() {
  if (process.env.CPU_WEB_AGENT_GATEWAY_ROLE !== "owner") throw new Error("Gateway owner role is required");
  const { port, secret } = gatewayCredentials();
  await loadJwxtAgentRuntimeConfig();
  const instance = crypto.randomUUID();
  const app = createGatewayRpc(secret, {
    snapshot: () => ({ protocol: 1, instance,
      agents: Object.fromEntries(getJwxtAgentRuntimeConfig().agents.map(agent => [agent.id, getJwxtAgentState(agent.id)])),
      recipients: getJwxtAgentReplicaRecipients(),
    }),
    request: (agent, action, payload, timeout) => requestJwxtAgent(agent, action as JwxtAgentAction, payload, timeout),
  });
  const server = createServer(app);
  attachJwxtAgentGateway(server);
  let reloading = false;
  const reload = async () => {
    if (reloading) return;
    reloading = true;
    try { await loadJwxtAgentRuntimeConfig(); }
    catch { console.warn("[jwxt-gateway] Configuration reload failed; keeping the last working configuration"); }
    finally { reloading = false; }
  };
  onRedisBroadcast("jwxt-agent-config-reload", reload);
  await startRedisSubscriptions();
  setInterval(reload, 10000).unref();
  server.listen(port, "127.0.0.1", () => console.log(`[jwxt-gateway] Listening on loopback:${port}; Agent path ${config.jwxtAgentPath}`));
}
start().catch(() => { console.error("[jwxt-gateway] Startup failed"); process.exitCode = 1; });
