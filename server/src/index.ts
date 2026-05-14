import { createApp } from "./app";
import { config } from "./config";
import { startScheduler } from "./services/schoolCrawler";

const app = createApp();

app.listen(config.port, () => {
  console.log(`🚀 CPU-web 后端已启动:  http://localhost:${config.port}`);
  console.log(`   健康检查:           http://localhost:${config.port}/api/health`);
  startScheduler();
});
