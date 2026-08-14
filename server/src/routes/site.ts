import { Router, type Request, type Response } from "express";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { Errors, ok } from "../utils/response";
import { withCache } from "../services/cache";
import { getFeatures, getLearningPlatformAvailability, getSiteConfig, getSiteFilingNumber, getSiteOrigin, getTopNavigation } from "../services/siteSettings";
import {
  hasPdsShare,
  parseDesktopVersionFromFileName,
  hasAndroidPdsShare,
  resolveAndroidDownload,
  resolveDesktopDownload,
  resolveMacDesktopDownload,
} from "../services/pdsShare";
import { getAiQuotaRules } from "../services/aiQuotaRules";
import { readDesktopUserScriptRelease } from "../services/desktopUserScript";
import type { DesktopUserScriptKind } from "../services/desktopUserScript";
import { securityRateLimit } from "../middleware/securityRateLimit";
import {
  learningAssistantAiBodySchema,
  learningAssistantAiResponse,
  requestLearningAssistantAi,
} from "../services/learningAssistantAi";

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

/** 公开：桌面端网课平台可用状态。只包含布尔开关，不暴露管理配置。 */
siteRouter.get("/learning-platforms", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  ok(res, getLearningPlatformAvailability());
});

/**
 * 桌面端学习通助手脚本的公开版本清单。
 * 客户端只从固定同源接口拉取，并在落盘前核对版本、大小、SHA-256 与权限声明。
 */
siteRouter.get("/userscripts/chaoxing-helper", async (_req, res, next) => {
  try {
    const release = await readDesktopUserScriptRelease();
    res.setHeader("Cache-Control", "no-store");
    ok(res, {
      name: release.name,
      version: release.version,
      sha256: release.sha256,
      size: release.size,
      sourceUrl: "/api/site/userscripts/chaoxing-helper/source",
    });
  } catch (error) {
    next(error);
  }
});

/** 脚本正文由服务器本地文件提供；ETag 允许客户端/CDN 在内容未变时不重复传输。 */
siteRouter.get("/userscripts/chaoxing-helper/source", async (req, res, next) => {
  try {
    const release = await readDesktopUserScriptRelease();
    const etag = `"sha256-${release.sha256}"`;
    // 清单和正文必须作为同一个发布读取。这里禁止中间代理缓存或压缩变换，
    // 避免部署切换瞬间出现“新清单 + 旧正文”，被客户端的大小/哈希校验拒绝。
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Content-Length", String(release.size));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("ETag", etag);
    res.setHeader("X-Userscript-Version", release.version);
    res.setHeader("X-Content-SHA256", release.sha256);
    if (req.get("if-none-match") === etag) {
      res.status(304).end();
      return;
    }
    res.send(release.source);
  } catch (error) {
    next(error);
  }
});

/** 多平台 OCS 引擎使用与学习通助手完全相同的版本清单、哈希校验和正文发布模型。 */
siteRouter.get("/userscripts/multiplatform-helper", async (_req, res, next) => {
  try {
    const release = await readDesktopUserScriptRelease("multiplatform");
    res.setHeader("Cache-Control", "no-store");
    ok(res, {
      name: release.name,
      version: release.version,
      sha256: release.sha256,
      size: release.size,
      sourceUrl: "/api/site/userscripts/multiplatform-helper/source",
    });
  } catch (error) {
    next(error);
  }
});

const sendDesktopUserScriptSource = async (
  kind: DesktopUserScriptKind,
  req: Request,
  res: Response,
) => {
  const release = await readDesktopUserScriptRelease(kind);
  const etag = `"sha256-${release.sha256}"`;
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Content-Length", String(release.size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("ETag", etag);
  res.setHeader("X-Userscript-Version", release.version);
  res.setHeader("X-Content-SHA256", release.sha256);
  if (req.get("if-none-match") === etag) {
    res.status(304).end();
    return;
  }
  res.send(release.source);
};

siteRouter.get("/userscripts/multiplatform-helper/source", async (req, res, next) => {
  try {
    await sendDesktopUserScriptSource("multiplatform", req, res);
  } catch (error) {
    next(error);
  }
});

siteRouter.get("/downloads/android-app", async (_req, res) => {
  if (hasAndroidPdsShare()) {
    try {
      const file = await resolveAndroidDownload();
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, file.url);
      return;
    } catch (error) {
      console.error("PDS Android 分享解析失败，回退到直链或本地文件", error);
    }
  }

  const configuredUrl = normalizeAndroidDownloadUrl(config.androidAppDownloadUrl);
  if (configuredUrl) {
    res.redirect(302, configuredUrl);
    return;
  }

  const fileName = resolveLatestAndroidApkFileName() || "CPU-Web-Android-V7.apk";
  res.redirect(302, `/downloads/${encodeURIComponent(fileName)}`);
});

/**
 * 公开：桌面端安装包信息。
 * 没配置下载地址时返回 available:false，前端据此显示"正在打包中"，
 * 而不是给用户一个点了打不开的按钮。
 */
siteRouter.get("/downloads/desktop", async (req, res) => {
  // 这是客户端版本检查接口，不能让浏览器、代理或 CDN 复用上传前的旧版本结果。
  res.setHeader("Cache-Control", "no-store");
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
        // PDS 固定文件夹会随着上传自动选择最新安装包，版本也应跟着文件名走；
        // 环境变量只作为需要手工覆盖文件名时的最高优先级配置。
        version: config.desktopAppVersion || parseDesktopVersionFromFileName(file.name),
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

/** Apple Silicon 专用 macOS 客户端；未上传 DMG 时独立返回 unavailable，不影响 Windows。 */
siteRouter.get("/downloads/desktop-mac", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (hasPdsShare()) {
    try {
      const file = await resolveMacDesktopDownload();
      const origin = getSiteOrigin() || `${req.protocol}://${req.get("host") ?? ""}`;
      ok(res, {
        available: true,
        url: new URL("/api/site/downloads/desktop-mac-app", origin).toString(),
        version: config.desktopAppVersion || parseDesktopVersionFromFileName(file.name),
        password: "",
        direct: true,
        fileName: file.name,
        size: file.size,
        contentHash: file.contentHash,
        contentHashName: file.contentHashName,
      });
      return;
    } catch (error) {
      console.error("PDS 分享里的 macOS 安装包解析失败", error);
    }
  }

  ok(res, {
    available: false,
    url: "",
    version: "",
    password: "",
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

/** macOS DMG 的稳定跳转入口；临时 PDS 地址只在请求时生成。 */
siteRouter.get("/downloads/desktop-mac-app", async (_req, res) => {
  if (hasPdsShare()) {
    try {
      const file = await resolveMacDesktopDownload();
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, file.url);
      return;
    } catch (error) {
      console.error("PDS 分享里的 macOS 安装包解析失败", error);
    }
  }

  res.status(404).json({ code: 404, message: "macOS 客户端尚未发布" });
});

/**
 * 公开：拾间 AI 额度规则。只有规则本身，不含任何用户数据。
 *
 * 前端拿它来渲染"怎么提升免费额度"，而不是把数字写死在文案里 ——
 * 档位表、每帖多少分、赞助兑换比例都能被管理员改，写死就会变成误导。
 */
siteRouter.get("/ai-quota-rules", async (_req, res, next) => {
  try {
    ok(res, await withCache("site", ["ai-quota-rules"], 60_000, async () => getAiQuotaRules()));
  } catch (e) { next(e); }
});

/**
 * 桌面端学习通助手的临时免登录答题入口。
 *
 * “无限”指不扣每日额度和 AI 点数；仍保留按 IP 的瞬时限流，避免异常循环拖垮服务。
 * 访问策略每次请求都从服务端内存配置读取，后台切回 account-quota 后立即失效，
 * 因而不能靠保留旧客户端继续使用临时权限。
 */
siteRouter.post(
  "/learning-assistant/responses",
  securityRateLimit("learning-assistant-guest", 60, 60_000),
  async (req, res, next) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let responseCompleted = false;
    try {
      if (req.header("x-cpu-desktop-client") !== "cpu-web-desktop") {
        throw Errors.forbidden("该入口仅供药大拾间桌面客户端使用");
      }
      if (getSiteConfig().learningAssistantAccessMode !== "guest-unlimited") {
        throw Errors.unauthorized("限时免登录已结束，请登录后继续使用");
      }
      const body = learningAssistantAiBodySchema.parse(req.body);
      const tier = getSiteConfig().learningAssistantTiers[body.reasoningEffort];
      if (!tier.freeInUnlimited) {
        throw Errors.forbidden("该答题档位不参与限时免费，请选择当前开放的档位");
      }
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 120_000);
      res.on("close", () => {
        if (!responseCompleted) controller.abort();
      });
      const clientVersion = String(req.header("x-cpu-desktop-version") || "unknown")
        .replace(/[^\w.-]/g, "")
        .slice(0, 32);
      const result = await requestLearningAssistantAi(
        body,
        `desktop-guest-${clientVersion}`,
        controller.signal,
        { targetLabel: `学习通答题 · 免登录客户端 ${clientVersion}` },
      );
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
      responseCompleted = true;
      res.status(result.status);
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Accel-Buffering", "no");
      if (!result.ok) return res.send(result.errorBody);
      return res.json(learningAssistantAiResponse(result.outputText || ""));
    } catch (error) {
      if (timeout) clearTimeout(timeout);
      next(error);
    }
  }
);

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
