import type { RequestHandler } from "express";
import path from "node:path";
import { readFileSync } from "node:fs";
import { resolveTencentCosOriginUrl } from "./tencentCos";

export const WEB_STATIC_COS_PREFIX = "web-static/assets";
export const WEB_STATIC_COS_MANIFEST = "cos-static-assets.json";

type WebStaticCosManifest = {
  version: 1;
  generatedAt: string;
  remotePrefix: string;
  assets: string[];
};

export function createWebStaticCosHandler(distRoot: string): RequestHandler {
  const assets = loadWebStaticCosManifest(distRoot);
  if (!assets.size) return (_req, _res, next) => next();
  console.log(`[static-cos] redirect manifest active: ${assets.size} assets`);

  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const assetPath = normalizeWebStaticAssetPath(decodeRequestPathname(req.path));
    if (!assetPath || !assets.has(assetPath)) return next();

    try {
      const remoteUrl = await resolveTencentCosOriginUrl(`${WEB_STATIC_COS_PREFIX}/${assetPath}`);
      // Vite 文件名带内容哈希，重定向地址和 COS 对象都可以长期缓存。
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Static-Asset-Backend", "cos");
      res.redirect(302, remoteUrl);
    } catch {
      next();
    }
  };
}

export function loadWebStaticCosManifest(distRoot: string) {
  try {
    const manifestPath = path.resolve(distRoot, WEB_STATIC_COS_MANIFEST);
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<WebStaticCosManifest>;
    if (parsed.version !== 1 || parsed.remotePrefix !== WEB_STATIC_COS_PREFIX || !Array.isArray(parsed.assets)) {
      return new Set<string>();
    }
    return new Set(parsed.assets.map(normalizeWebStaticAssetPath).filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

export function normalizeWebStaticAssetPath(value: string) {
  const normalized = String(value || "").trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return "";
  return parts.join("/");
}

export function rewriteWebStaticAssetUrls(html: string, assetBaseUrl: string) {
  const baseUrl = String(assetBaseUrl || "").trim().replace(/\/+$/gu, "");
  if (!baseUrl) return html;
  return String(html || "").replace(
    /\b(src|href)="\/assets\//gu,
    (_match, attribute: string) => `${attribute}="${baseUrl}/`,
  );
}

function decodeRequestPathname(value: string) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}
