import express from "express";
import morgan from "morgan";
import compression from "compression";
import path from "node:path";
import { existsSync } from "node:fs";
import { errorHandler } from "./middleware/error";
import { router } from "./routes";
import { shareRouter } from "./routes/share";
import { isDev } from "./config";
import { getDatabaseMaintenanceMessage, isDatabaseMaintenanceActive } from "./services/maintenance";
import { filestoreHandler } from "./services/filestore";
import { startForumImageModerationPoller } from "./services/imageModeration";
import { startForumVideoModerationPoller } from "./services/videoModeration";
import { uploadAssetHandler } from "./services/mediaStorage";
import { startQqNotificationPoller } from "./services/qqbot";
import { startSponsorOrderExpiryPoller } from "./services/sponsor";
import { startRuntimeSync } from "./services/runtimeSync";
import { fail } from "./utils/response";
import { browserSessionMiddleware, requestOriginAndCsrfProtection } from "./middleware/browserSession";
import { receiveCspReport, securityHeaders } from "./middleware/securityHeaders";
import { securityRateLimit } from "./middleware/securityRateLimit";

export function createApp() {
  const app = express();

  // 部署脚本的反向代理位于本机/私网；不要信任公网客户端伪造的 X-Forwarded-For。
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
  app.use(securityHeaders);
  app.use(compression({
    threshold: 1024,
  }));
  app.use((req, res, next) => {
    if (!isDatabaseMaintenanceActive()) return next();
    if (req.path === "/api/health") return next();
    return fail(res, 5030, getDatabaseMaintenanceMessage(), 503);
  });
  app.use(
    "/filestore",
    browserSessionMiddleware,
    requestOriginAndCsrfProtection,
    (req, res, next) => {
      if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
      next();
    },
    filestoreHandler,
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.post(
    "/api/security/csp-report",
    express.json({ type: ["application/csp-report", "application/reports+json"], limit: "32kb" }),
    receiveCspReport,
  );
  app.use("/api", browserSessionMiddleware, requestOriginAndCsrfProtection);
  app.use(["/api/auth", "/api/user", "/api/jwxt", "/api/admin", "/api/courses/sync"], (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });
  app.use(["/api/auth/sso-login", "/api/auth/login", "/api/jwxt/login"], securityRateLimit("login-submit", 10, 10 * 60_000));
  app.use(["/api/auth/sso-begin", "/api/jwxt/begin-login"], securityRateLimit("login-begin", 30, 10 * 60_000));
  if (isDev) app.use(morgan("dev"));

  app.use("/uploads", uploadAssetHandler);

  app.get("/api/health", (_req, res) => {
    res.json({ code: 0, data: { ok: true, ts: Date.now() }, message: "" });
  });

  app.get("/10b0f912e73a202f7040913a82166673.txt", (_req, res) => {
    res.type("text/plain; charset=utf-8");
    res.send("9abfb616e9ac54f49df77561d1d73d364e38f9a4");
  });

  app.use("/share", shareRouter);
  app.use("/api", router);
  startRuntimeSync();
  startForumImageModerationPoller();
  startForumVideoModerationPoller();
  startQqNotificationPoller();
  startSponsorOrderExpiryPoller();

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
