import { createApp } from "./app";
import { config } from "./config";
import { ensureBuiltinBoards } from "./services/defaultBoards";
import { startScheduler } from "./services/schoolCrawler";
import { loadFeatures } from "./services/siteSettings";
import { loadStorageConfig } from "./services/storageConfig";
import { startWeiwallSyncScheduler } from "./services/weiwallSync";

const app = createApp();

app.listen(config.port, async () => {
  console.log(`🚀 CPU-web 后端已启动:  http://localhost:${config.port}`);
  console.log(`   健康检查:           http://localhost:${config.port}/api/health`);
  console.log(`   电费 API base:       ${process.env.DORM_ELECTRIC_BASE || "(未设，使用默认 http://sz.weicheng.wang:8899)"}`);
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
  startWeiwallSyncScheduler();
});
