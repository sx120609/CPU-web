import path from "node:path";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import {
  getMediaStorageRuntimeConfig,
  updateWebStaticProvider,
  type MediaStorageRuntimeConfig,
  type WebStaticProvider,
} from "./storageConfig";
import {
  WEB_STATIC_COS_PREFIX,
  loadWebStaticManifestSnapshot,
} from "./webStaticCos";
import {
  isTencentCosConfigured,
  listTencentCosFiles,
  resolveTencentCosDeliveryUrl,
} from "./tencentCos";
import {
  isAliyunOssConfigured,
  listAliyunOssFiles,
  resolveAliyunOssDeliveryUrl,
} from "./aliyunOss";

export type WebStaticExpectedFile = {
  relativePath: string;
  size: number | null;
};

export type WebStaticBackendStatus = {
  provider: WebStaticProvider;
  configured: boolean;
  publicBaseUrl: string;
  expectedCount: number;
  presentCount: number;
  missingCount: number;
  mismatchedCount: number;
  missingExamples: string[];
  mismatchedExamples: string[];
  deliveryReachable: boolean;
  ready: boolean;
  error: string;
};

export type WebStaticSwitchStatus = {
  generatedAt: string;
  activeProvider: WebStaticProvider;
  expectedCount: number;
  backends: Record<WebStaticProvider, WebStaticBackendStatus>;
};

type StoredFile = { relativePath: string; size: number | null };

export class WebStaticProviderNotReadyError extends Error {
  readonly status: WebStaticBackendStatus;

  constructor(status: WebStaticBackendStatus) {
    super(status.error || `${providerLabel(status.provider)}尚未通过静态资源就绪检查`);
    this.status = status;
  }
}

export function assessWebStaticCoverage(expected: WebStaticExpectedFile[], stored: StoredFile[]) {
  const storedByPath = new Map(stored.map((file) => [file.relativePath, file]));
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const file of expected) {
    const remote = storedByPath.get(file.relativePath);
    if (!remote) {
      missing.push(file.relativePath);
      continue;
    }
    if (file.size !== null && remote.size !== null && file.size !== remote.size) {
      mismatched.push(file.relativePath);
    }
  }
  return {
    expectedCount: expected.length,
    presentCount: expected.length - missing.length,
    missing,
    mismatched,
  };
}

export async function getWebStaticSwitchStatus(): Promise<WebStaticSwitchStatus> {
  const runtime = await getMediaStorageRuntimeConfig();
  const expected = await collectExpectedWebStaticFiles(resolveWebStaticDistRoot());
  const [cos, oss] = await Promise.all([
    inspectBackend("cos", runtime, expected),
    inspectBackend("oss", runtime, expected),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    activeProvider: runtime.webStaticProvider,
    expectedCount: expected.length,
    backends: { cos, oss },
  };
}

export async function switchWebStaticProvider(provider: WebStaticProvider) {
  const status = await getWebStaticSwitchStatus();
  const target = status.backends[provider];
  if (!target.ready) throw new WebStaticProviderNotReadyError(target);
  if (status.activeProvider !== provider) await updateWebStaticProvider(provider);
  return { ...status, activeProvider: provider, generatedAt: new Date().toISOString() };
}

export function resolveWebStaticDistRoot(cwd = process.cwd()) {
  const candidates = [
    path.resolve(cwd, "../web/dist"),
    path.resolve(cwd, "web/dist"),
    path.resolve(__dirname, "../../../web/dist"),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) || candidates[0];
}

async function collectExpectedWebStaticFiles(distRoot: string): Promise<WebStaticExpectedFile[]> {
  const manifest = loadWebStaticManifestSnapshot(distRoot);
  const files = [
    ...manifest.assets.map((relativePath) => ({ relativePath, localPath: path.join(distRoot, "assets", relativePath) })),
    ...manifest.publicAssets.map((relativePath) => ({ relativePath, localPath: path.join(distRoot, relativePath) })),
  ];
  const seen = new Set<string>();
  const expected: WebStaticExpectedFile[] = [];
  for (const file of files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"))) {
    const remotePath = `${WEB_STATIC_COS_PREFIX}/${file.relativePath}`;
    if (seen.has(remotePath)) continue;
    seen.add(remotePath);
    const local = await stat(file.localPath).catch(() => null);
    expected.push({ relativePath: remotePath, size: local?.isFile() ? local.size : null });
  }
  return expected;
}

async function inspectBackend(
  provider: WebStaticProvider,
  runtime: MediaStorageRuntimeConfig,
  expected: WebStaticExpectedFile[],
): Promise<WebStaticBackendStatus> {
  const publicBaseUrl = provider === "oss"
    ? runtime.aliyunOssPublicBaseUrl || runtime.legacyAliyunOssPublicBaseUrl
    : runtime.tencentCosPublicBaseUrl || runtime.legacyTencentCosPublicBaseUrl;
  const dependencies = provider === "oss"
    ? {
        isConfigured: isAliyunOssConfigured,
        listFiles: listAliyunOssFiles,
        resolveDeliveryUrl: resolveAliyunOssDeliveryUrl,
      }
    : {
        isConfigured: isTencentCosConfigured,
        listFiles: listTencentCosFiles,
        resolveDeliveryUrl: resolveTencentCosDeliveryUrl,
      };
  const base: WebStaticBackendStatus = {
    provider,
    configured: false,
    publicBaseUrl,
    expectedCount: expected.length,
    presentCount: 0,
    missingCount: expected.length,
    mismatchedCount: 0,
    missingExamples: expected.slice(0, 5).map((file) => file.relativePath),
    mismatchedExamples: [],
    deliveryReachable: false,
    ready: false,
    error: "",
  };

  try {
    if (!(await dependencies.isConfigured())) {
      return { ...base, error: `${providerLabel(provider)}访问密钥或存储桶尚未配置` };
    }
    if (!publicBaseUrl) {
      return { ...base, error: `${providerLabel(provider)}静态资源域名尚未配置` };
    }
    if (!expected.length) {
      return { ...base, configured: true, error: "当前部署没有可验证的静态资源清单" };
    }
    const stored = await dependencies.listFiles();
    const coverage = assessWebStaticCoverage(expected, stored);
    const covered = {
      ...base,
      configured: true,
      presentCount: coverage.presentCount,
      missingCount: coverage.missing.length,
      mismatchedCount: coverage.mismatched.length,
      missingExamples: coverage.missing.slice(0, 5),
      mismatchedExamples: coverage.mismatched.slice(0, 5),
    };
    if (coverage.missing.length || coverage.mismatched.length) {
      return {
        ...covered,
        error: `当前版本资源不完整：缺少 ${coverage.missing.length} 个，大小不一致 ${coverage.mismatched.length} 个`,
      };
    }
    const canary = [...expected].sort((left, right) => (left.size ?? Number.MAX_SAFE_INTEGER) - (right.size ?? Number.MAX_SAFE_INTEGER))[0];
    const deliveryUrl = await dependencies.resolveDeliveryUrl(canary.relativePath);
    try {
      await probeDelivery(deliveryUrl);
      return { ...covered, deliveryReachable: true, ready: true };
    } catch (error) {
      return {
        ...covered,
        error: String(error instanceof Error ? error.message : error || "静态资源域名探测失败").slice(0, 300),
      };
    }
  } catch (error) {
    return {
      ...base,
      configured: Boolean(publicBaseUrl),
      error: String(error instanceof Error ? error.message : error || `${providerLabel(provider)}检查失败`).slice(0, 300),
    };
  }
}

async function probeDelivery(url: string) {
  const siteOrigin = "https://cputime.cn";
  const response = await fetch(url, {
    method: "GET",
    headers: { Origin: siteOrigin, Range: "bytes=0-0" },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`静态资源域名探测返回 HTTP ${response.status}`);
  }
  const allowedOrigin = String(response.headers.get("access-control-allow-origin") || "").trim();
  if (allowedOrigin !== "*" && allowedOrigin !== siteOrigin) {
    throw new Error("静态资源域名未允许主站跨域读取");
  }
}

function providerLabel(provider: WebStaticProvider) {
  return provider === "oss" ? "阿里 OSS/ESA" : "腾讯 COS/CDN";
}
