import { Router } from "express";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { ok } from "../utils/response";
import { withCache } from "../services/cache";
import { getFeatures, getSiteFilingNumber, getSiteOrigin, getTopNavigation } from "../services/siteSettings";

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
  const configuredUrl = normalizeAndroidDownloadUrl(config.androidAppDownloadUrl);
  if (configuredUrl) {
    res.redirect(302, configuredUrl);
    return;
  }

  const fileName = resolveLatestAndroidApkFileName() || "CPU-Web-Android-V6.apk";
  res.redirect(302, `/downloads/${encodeURIComponent(fileName)}`);
});

/**
 * 公开：桌面端安装包信息。
 * 没配置下载地址时返回 available:false，前端据此显示"正在打包中"，
 * 而不是给用户一个点了打不开的按钮。
 */
siteRouter.get("/downloads/desktop", (_req, res) => {
  const url = normalizeHttpsUrl(config.desktopAppDownloadUrl);
  ok(res, { available: Boolean(url), url, version: config.desktopAppVersion });
});

siteRouter.get("/downloads/desktop-app", (_req, res) => {
  const url = normalizeHttpsUrl(config.desktopAppDownloadUrl);
  if (!url) {
    res.status(404).json({ code: 404, message: "桌面端安装包尚未发布" });
    return;
  }
  res.redirect(302, url);
});

/** 公开：顶部导航配置，仅包含展示字段。 */
siteRouter.get("/navigation", async (_req, res, next) => {
  try {
    ok(res, await withCache("site", ["navigation"], 60_000, async () => getTopNavigation()));
  } catch (e) { next(e); }
});

function normalizeAndroidDownloadUrl(value: string) {
  return normalizeHttpsUrl(value);
}

function normalizeHttpsUrl(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function resolveLatestAndroidApkFileName() {
  const dirs = [
    path.resolve(process.cwd(), "../web/public/downloads"),
    path.resolve(process.cwd(), "web/public/downloads"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir);
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
