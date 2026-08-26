import { createServer } from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { ensureBuiltinBoards } from "./services/defaultBoards";
import { startScheduler } from "./services/schoolCrawler";
import { loadFeatures } from "./services/siteSettings";
import { loadStorageConfig } from "./services/storageConfig";
import { attachJwxtAgentGateway } from "./services/jwxtAgentGateway";
import { loadJwxtAgentRuntimeConfig } from "./services/jwxtAgentConfig";
import { attachVoiceHubGateway, voiceHubProxyConfig } from "./services/voiceHubProxy";
import { attachQqBotWebSocketGateway } from "./services/qqbot/connection";

async function start() {
  await loadJwxtAgentRuntimeConfig().catch((error) => {
    console.warn("[jwxt-agent] 加载后台配置失败，暂时使用环境变量配置", error);
  });
  const createdBoards = await ensureBuiltinBoards().catch((e) => {
    console.warn("ensureBuiltinBoards failed:", e?.message);
    return [];
  });
  if (createdBoards.length) {
    console.log(`🏛️  已同步默认板块: ${createdBoards.map((board) => board.name).join("、")}`);
  }
  // 首页摘要依赖功能开关和全局置顶的内存快照。必须在开始接收请求前完成加载，
  // 否则重启后的首个请求会把空置顶列表写进共享首页缓存。
  await loadFeatures().catch((e) => console.warn("loadFeatures failed:", e?.message));
  await loadStorageConfig().catch((e) => console.warn("loadStorageConfig failed:", e?.message));

  const app = createApp();
  const server = createServer(app);
  attachJwxtAgentGateway(server);
  attachQqBotWebSocketGateway(server);
  attachVoiceHubGateway(server);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[lifecycle] 收到 ${signal}，等待现有请求完成后退出`);
    const forceExit = setTimeout(() => {
      console.error("[lifecycle] 优雅退出超时，强制结束进程");
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    server.close((error) => {
      clearTimeout(forceExit);
      if (error) {
        console.error("[lifecycle] 服务关闭失败", error);
        process.exit(1);
        return;
      }
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  server.listen(config.port, () => {
    console.log(`🚀 CPU-web 后端已启动:  http://localhost:${config.port}`);
    console.log(`   健康检查:           http://localhost:${config.port}/api/health`);
    console.log(`   药苑之声:           http://localhost:${config.port}${voiceHubProxyConfig.path}`);
    console.log("   宿舍电费查询:       远程校园 Agent");
    startScheduler();
  });
}

start().catch((error) => {
  console.error("CPU-web 后端启动失败", error);
  process.exit(1);
});
