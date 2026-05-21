import { Router } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { ok } from "../utils/response";
import { getFeatures, getSiteConfig } from "../services/siteSettings";

export const siteRouter = Router();

/** 公开：前端读功能开关，过滤导航 / 路由 / 占位页 */
siteRouter.get("/features", (_req, res) => {
  ok(res, getFeatures());
});

/** 公开：站点基础配置。不要放敏感内容。 */
siteRouter.get("/config", (_req, res) => {
  ok(res, getSiteConfig());
});

siteRouter.get("/downloads/android-app", (_req, res) => {
  const candidates = [
    "CPU-Web-V10.apk",
    "CPU-Web-V9.apk",
  ];
  const baseDir = path.resolve(process.cwd(), "../web/public/downloads");
  const fallbackDir = path.resolve(process.cwd(), "web/public/downloads");
  const chosen = candidates.find((name) => existsSync(path.join(baseDir, name)) || existsSync(path.join(fallbackDir, name)));
  const fileName = chosen || candidates[0];
  res.redirect(302, `/downloads/${encodeURIComponent(fileName)}`);
});
