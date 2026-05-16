import express from "express";
import morgan from "morgan";
import { config, isDev } from "./config";
import { errorHandler } from "./middleware/error";
import { proxyJwxtRouter } from "./routes/proxyJwxt";

const app = express();
const port = Number(process.env.PROXY_PORT ?? 23334);

app.use(express.json({ limit: "1mb" }));
if (isDev) app.use(morgan("dev"));

app.use("/", proxyJwxtRouter);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`教务代理服务已启动: http://localhost:${port}`);
  console.log(`健康检查: http://localhost:${port}/health`);
  if (!config.proxyAuth) {
    console.warn("警告：PROXY_AUTH 未设置，代理鉴权已跳过。生产环境请务必配置共享密钥。");
  }
});
