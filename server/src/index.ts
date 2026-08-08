import { createServer } from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { ensureBuiltinBoards } from "./services/defaultBoards";
import { startScheduler } from "./services/schoolCrawler";
import { loadFeatures } from "./services/siteSettings";
import { loadStorageConfig } from "./services/storageConfig";
import { attachJwxtAgentGateway } from "./services/jwxtAgentGateway";
import { loadJwxtAgentRuntimeConfig } from "./services/jwxtAgentConfig";
import { bootstrapMarket } from "./services/marketBootstrap";
import { attachVoiceHubGateway, voiceHubProxyConfig } from "./services/voiceHubProxy";

async function start() {
  await loadJwxtAgentRuntimeConfig().catch((error) => {
    console.warn("[jwxt-agent] 加载后台配置失败，暂时使用环境变量配置", error);
  });
  const marketBootstrap = await bootstrapMarket().catch((error) => {
    console.warn("[market] 启动初始化失败，服务将继续启动", error);
    return null;
  });
  if (marketBootstrap?.migrated) {
    console.log(`🛒 已迁移 ${marketBootstrap.migrated} 条旧二手帖子到商城`);
  }
  const app = createApp();
  const server = createServer(app);
  attachJwxtAgentGateway(server);
  attachVoiceHubGateway(server);

  server.listen(config.port, async () => {
    console.log(`🚀 CPU-web 后端已启动:  http://localhost:${config.port}`);
    console.log(`   健康检查:           http://localhost:${config.port}/api/health`);
    console.log(`   药苑之声:           http://localhost:${config.port}${voiceHubProxyConfig.path}`);
    console.log("   宿舍电费查询:       远程校园 Agent");
    const createdBoards = await ensureBuiltinBoards().catch((e) => {
      console.warn("ensureBuiltinBoards failed:", e?.message);
      return [];
    });
    if (createdBoards.length) {
      console.log(`🏛️  已补齐默认板块: ${createdBoards.map((board) => board.name).join("、")}`);
    }
    await loadFeatures().catch((e) => console.warn("loadFeatures failed:", e?.message));
    await loadStorageConfig().catch((e) => console.warn("loadStorageConfig failed:", e?.message));
    startScheduler();
  });
}

start().catch((error) => {
  console.error("CPU-web 后端启动失败", error);
  process.exit(1);
});
