import { Router } from "express";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { ok } from "../utils/response";
import { withCache } from "../services/cache";
import { getFeatures, getSiteFilingNumber, getSiteOrigin, getTopNavigation } from "../services/siteSettings";
import { hasPdsShare, resolveDesktopDownload } from "../services/pdsShare";

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
siteRouter.get("/downloads/desktop", async (req, res) => {
  // 配了 PDS 分享就是直链：给前端我们自己的跳转地址，不再有提取码。
  if (hasPdsShare()) {
    try {
      const file = await resolveDesktopDownload();
      // 必须给绝对地址：桌面端的更新器拿到这个值直接 new URL(...) 解析，
      // 相对路径会抛异常，表现为"点了去下载没反应"。
      const origin = getSiteOrigin() || `${req.protocol}://${req.get("host") ?? ""}`;
      ok(res, {
        available: true,
        url: new URL("/api/site/downloads/desktop-app", origin).toString(),
        version: config.desktopAppVersion,
        password: "",
        direct: true,
        fileName: file.name,
        size: file.size,
        // 安装包没有代码签名，客户端自动更新靠这个校验下载到的字节。
        // 哈希走我们自己的 HTTPS 接口，安装包走阿里云的地址 —— 两条路都被
        // 篡改才可能骗过去。
        contentHash: file.contentHash,
        contentHashName: file.contentHashName,
      });
      return;
    } catch (error) {
      // PDS 挂了不代表整个下载区要消失：回落到下面的网盘链接（如果配了）
      console.error("PDS 分享解析失败，回落到网盘链接", error);
    }
  }

  const url = normalizeHttpsUrl(config.desktopAppDownloadUrl);
  ok(res, {
    available: Boolean(url),
    url,
    version: config.desktopAppVersion,
    // 网盘分享页需要提取码；前端要显示出来，否则用户点过去卡在输码页
    password: url ? config.desktopAppDownloadPassword : "",
    direct: false,
  });
});

/**
 * 下载跳转。PDS 给的地址最长只有 32 小时，所以不能把它写死在任何地方 ——
 * 每次点击都在这里现换一个再 302 过去，对外始终是这一条稳定链接。
 * 桌面端自动更新也应当走这里，而不是自己去解析分享。
 */
siteRouter.get("/downloads/desktop-app", async (_req, res) => {
  if (hasPdsShare()) {
    try {
      const file = await resolveDesktopDownload();
      // 临时地址不该被 CDN 或浏览器缓存下来：缓存到期时间会长过地址本身
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, file.url);
      return;
    } catch (error) {
      console.error("PDS 分享解析失败，回落到网盘链接", error);
    }
  }

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
