import { Router } from "express";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { ok } from "../utils/response";
import { withCache } from "../services/cache";
import { getFeatures, getSiteFilingNumber, getSiteOrigin } from "../services/siteSettings";

export const siteRouter = Router();

/** 公开：前端读功能开关，过滤导航 / 路由 / 占位页 */
siteRouter.get("/features", async (_req, res, next) => {
  try {
    ok(res, await withCache("site", ["features"], 60_000, async () => getFeatures()));
  } catch (e) { next(e); }
});

/** 公开：站点基础配置。不要放敏感内容。 */
siteRouter.get("/config", async (_req, res, next) => {
  try {
    ok(res, await withCache("site", ["config"], 60_000, async () => ({
      siteOrigin: getSiteOrigin(),
      siteFilingNumber: getSiteFilingNumber(),
    })));
  } catch (e) { next(e); }
});

siteRouter.get("/downloads/android-app", (_req, res) => {
  const fileName = resolveLatestAndroidApkFileName() || "CPU-Web-Flutter-V1.apk";
  res.redirect(302, `/downloads/${encodeURIComponent(fileName)}`);
});

function resolveLatestAndroidApkFileName() {
  const dirs = [
    path.resolve(process.cwd(), "../web/public/downloads"),
    path.resolve(process.cwd(), "web/public/downloads"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir);
    const latestFlutterClient = latestApkByPattern(names, /^CPU-Web-Flutter-V(\d+)\.apk$/i);
    if (latestFlutterClient) return latestFlutterClient;
    const latestAndroidClient = latestApkByPattern(names, /^CPU-Web-Android-V(\d+)\.apk$/i);
    if (latestAndroidClient) return latestAndroidClient;
    const latestLegacyClient = latestApkByPattern(names, /^CPU-Web-V(\d+)\.apk$/i);
    if (latestLegacyClient) return latestLegacyClient;
  }
  return "";
}

function latestApkByPattern(names: string[], pattern: RegExp) {
  return names
    .map((name) => {
      const match = pattern.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((item): item is { name: string; version: number } => Boolean(item))
    .sort((a, b) => b.version - a.version)[0]?.name ?? "";
}
