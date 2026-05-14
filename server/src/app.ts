import express from "express";
import cors from "cors";
import morgan from "morgan";
import { errorHandler } from "./middleware/error";
import { router } from "./routes";
import { isDev } from "./config";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  if (isDev) app.use(morgan("dev"));

  app.get("/api/health", (_req, res) => {
    res.json({ code: 0, data: { ok: true, ts: Date.now() }, message: "" });
  });

  app.use("/api", router);

  app.use("/api/*", (_req, res) => {
    res.status(404).json({ code: 4004, data: null, message: "接口不存在" });
  });

  app.use(errorHandler);
  return app;
}
