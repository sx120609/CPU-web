import { createApp } from "./app";
import { config } from "./config";
import { startScheduler } from "./services/schoolCrawler";
import { loadFeatures } from "./services/siteSettings";

const app = createApp();

app.listen(config.port, async () => {
  console.log(`🚀 CPU-web 后端已启动:  http://localhost:${config.port}`);
  console.log(`   健康检查:           http://localhost:${config.port}/api/health`);
  console.log(`   电费 API base:       ${process.env.DORM_ELECTRIC_BASE || "(未设，使用默认 http://10.200.13.18:8899)"}`);
  await loadFeatures().catch((e) => console.warn("loadFeatures failed:", e?.message));
  startScheduler();
});
