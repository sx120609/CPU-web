import { Router } from "express";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { ok } from "../utils/response";
import { getFeatures, getSiteOrigin } from "../services/siteSettings";

export const siteRouter = Router();

/** 公开：前端读功能开关，过滤导航 / 路由 / 占位页 */
siteRouter.get("/features", (_req, res) => {
  ok(res, getFeatures());
});

/** 公开：站点基础配置。不要放敏感内容。 */
siteRouter.get("/config", (_req, res) => {
  ok(res, { siteOrigin: getSiteOrigin() });
});

siteRouter.get("/downloads/android-app", (_req, res) => {
  const fileName = resolveLatestAndroidApkFileName() || "CPU-Web-V10.apk";
  res.redirect(302, `/downloads/${encodeURIComponent(fileName)}`);
});

function resolveLatestAndroidApkFileName() {
  const dirs = [
    path.resolve(process.cwd(), "../web/public/downloads"),
    path.resolve(process.cwd(), "web/public/downloads"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const latest = readdirSync(dir)
      .map((name) => {
        const match = /^CPU-Web-V(\d+)\.apk$/i.exec(name);
        return match ? { name, version: Number(match[1]) } : null;
      })
      .filter((item): item is { name: string; version: number } => Boolean(item))
      .sort((a, b) => b.version - a.version)[0];
    if (latest?.name) return latest.name;
  }
  return "";
}
