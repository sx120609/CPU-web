import { createApp } from "./app";
import { config } from "./config";
import { startScheduler } from "./services/schoolCrawler";
import { loadFeatures } from "./services/siteSettings";

const app = createApp();

app.listen(config.port, async () => {
  console.log(`🚀 CPU-web 后端已启动:  http://localhost:${config.port}`);
  console.log(`   健康检查:           http://localhost:${config.port}/api/health`);
  await loadFeatures().catch((e) => console.warn("loadFeatures failed:", e?.message));
  startScheduler();
});
