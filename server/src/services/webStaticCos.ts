import type { RequestHandler } from "express";
import path from "node:path";
import { readFileSync } from "node:fs";
import { resolveTencentCosDeliveryUrl } from "./tencentCos";
import { resolveAliyunOssDeliveryUrl } from "./aliyunOss";
import { getMediaStorageRuntimeConfigSync, type WebStaticProvider } from "./storageConfig";

// Keep the whole ES module graph under one versioned URL prefix. Query-string
// cache busting would give the entry module a different identity from chunks
// that import it, causing the application to execute twice.
export const WEB_STATIC_COS_PREFIX = "web-static/assets/dual-origin-v2";
export const WEB_STATIC_COS_MANIFEST = "cos-static-assets.json";

type WebStaticBackend = WebStaticProvider;

type WebStaticCosManifest = {
  version: 1 | 2;
  generatedAt: string;
  remotePrefix: string;
  backend?: WebStaticBackend;
  assets: string[];
  publicAssets?: string[];
};

export function createWebStaticCosHandler(distRoot: string): RequestHandler {
  const manifest = loadWebStaticManifest(distRoot);
  const assets = manifest.assets;
  if (!assets.size) return (_req, _res, next) => next();
  console.log(`[static-object] redirect manifest active: ${assets.size} assets`);

  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const assetPath = normalizeWebStaticAssetPath(decodeRequestPathname(req.path));
    if (!assetPath || !assets.has(assetPath)) return next();

    try {
      const backend = resolveWebStaticBackend(getMediaStorageRuntimeConfigSync().webStaticProvider, manifest.backend);
      const remoteUrl = await resolveWebStaticDeliveryUrl(backend, `${WEB_STATIC_COS_PREFIX}/${assetPath}`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Static-Asset-Backend", backend);
      res.redirect(302, remoteUrl);
    } catch {
      next();
    }
  };
}

export function createWebStaticPublicCosHandler(distRoot: string): RequestHandler {
  const manifest = loadWebStaticManifest(distRoot);
  const assets = manifest.publicAssets;
  if (!assets.size) return (_req, _res, next) => next();
  console.log(`[static-${manifest.backend}] public redirect manifest active: ${assets.size} assets`);

  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const assetPath = normalizeWebStaticAssetPath(decodeRequestPathname(req.path));
    if (!assetPath || !assets.has(assetPath)) return next();
    try {
      const backend = resolveWebStaticBackend(getMediaStorageRuntimeConfigSync().webStaticProvider, manifest.backend);
      const remoteUrl = await resolveWebStaticDeliveryUrl(backend, `${WEB_STATIC_COS_PREFIX}/${assetPath}`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Static-Asset-Backend", backend);
      res.redirect(302, remoteUrl);
    } catch {
      next();
    }
  };
}

export function loadWebStaticCosManifest(distRoot: string) {
  return loadWebStaticManifest(distRoot).assets;
}

export function loadWebStaticCosPublicManifest(distRoot: string) {
  return loadWebStaticManifest(distRoot).publicAssets;
}

export function loadWebStaticManifestSnapshot(distRoot: string) {
  const manifest = loadWebStaticManifest(distRoot);
  return {
    backend: manifest.backend,
    assets: [...manifest.assets],
    publicAssets: [...manifest.publicAssets],
  };
}

export function resolveWebStaticBackend(configured: unknown, fallback: WebStaticBackend): WebStaticBackend {
  return configured === "oss" || configured === "cos" ? configured : fallback;
}

function loadWebStaticManifest(distRoot: string) {
  try {
    const manifestPath = path.resolve(distRoot, WEB_STATIC_COS_MANIFEST);
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<WebStaticCosManifest>;
    if (![1, 2].includes(Number(parsed.version)) || parsed.remotePrefix !== WEB_STATIC_COS_PREFIX || !Array.isArray(parsed.assets)) {
      return emptyWebStaticManifest();
    }
    return {
      backend: parsed.backend === "oss" ? "oss" as const : "cos" as const,
      assets: new Set(parsed.assets.map(normalizeWebStaticAssetPath).filter(Boolean)),
      publicAssets: new Set((parsed.publicAssets || []).map(normalizeWebStaticAssetPath).filter(Boolean)),
    };
  } catch {
    return emptyWebStaticManifest();
  }
}

function emptyWebStaticManifest() {
  return { backend: "cos" as const, assets: new Set<string>(), publicAssets: new Set<string>() };
}

function resolveWebStaticDeliveryUrl(backend: WebStaticBackend, relativePath: string) {
  return backend === "oss" ? resolveAliyunOssDeliveryUrl(relativePath) : resolveTencentCosDeliveryUrl(relativePath);
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
  let rewritten = String(html || "");
  try {
    const remotePath = new URL(baseUrl).pathname.replace(/\/+$/gu, "");
    if (remotePath) {
      const escapedRemotePath = remotePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      rewritten = rewritten.replace(
        new RegExp(`\\b(src|href)="https?:\\/\\/[^"/]+${escapedRemotePath}\\/`, "gu"),
        (_match, attribute: string) => `${attribute}="${baseUrl}/`,
      );
    }
  } catch {
    // Invalid public delivery URLs are rejected by storage configuration. Keep
    // the local-path rewrite as a defensive fallback for direct callers.
  }
  return rewritten.replace(
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
