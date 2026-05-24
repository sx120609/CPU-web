import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "node:path";
import { existsSync } from "node:fs";
import { errorHandler } from "./middleware/error";
import { router } from "./routes";
import { shareRouter } from "./routes/share";
import { isDev } from "./config";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  if (isDev) app.use(morgan("dev"));

  const uploadDir = path.resolve(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadDir, { maxAge: "30d", index: false }));

  app.get("/api/health", (_req, res) => {
    res.json({ code: 0, data: { ok: true, ts: Date.now() }, message: "" });
  });

  app.get("/10b0f912e73a202f7040913a82166673.txt", (_req, res) => {
    res.type("text/plain; charset=utf-8");
    res.send("9abfb616e9ac54f49df77561d1d73d364e38f9a4");
  });

  app.use("/share", shareRouter);
  app.use("/api", router);

  app.use("/api/*", (_req, res) => {
    res.status(404).json({ code: 4004, data: null, message: "接口不存在" });
  });

  // 生产模式：直接 serve 前端 dist（避免再起 nginx）
  if (!isDev) {
    // 候选 dist 路径（兼容从 server/ 或项目根启动）
    const candidates = [
      path.resolve(process.cwd(), "../web/dist"),
      path.resolve(process.cwd(), "web/dist"),
      path.resolve(__dirname, "../../web/dist"),
    ];
    const dist = candidates.find((p) => existsSync(p));
    if (dist) {
      console.log(`📦 静态资源目录: ${dist}`);
      app.use(express.static(dist, { maxAge: "7d", index: false }));
      // SPA fallback：非 /api 路径全部返回 index.html
      app.get(/^\/(?!api).*/, (_req, res) => {
        res.sendFile(path.join(dist, "index.html"));
      });
    } else {
      console.warn("⚠️  未找到 web/dist，前端可能未构建");
    }
  }

  app.use(errorHandler);
  return app;
}
