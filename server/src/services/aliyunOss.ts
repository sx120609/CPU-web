import OSS from "ali-oss";
import { getMediaStorageRuntimeConfig, loadStorageConfig } from "./storageConfig";

const SIGNED_URL_EXPIRES_SECONDS = 15 * 60;
const DIRECT_UPLOAD_EXPIRES_SECONDS = 3 * 60 * 60;

export type AliyunOssStoredFile = {
  relativePath: string;
  size: number | null;
  lastModifiedAt: string;
  etag: string;
};

export type AliyunOssUploadSession = {
  uploadUrl: string;
  expiresAt: string;
  strategy: "single-put";
};

export type AliyunOssBucketStats = {
  bucket: string;
  storageBytes: number;
  objectCount: number;
  standardStorageBytes: number;
  standardObjectCount: number;
  measuredAt: string;
};

type ResolvedAliyunOssConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  rootPath: string;
  publicBaseUrl: string;
};

let cachedClient: { fingerprint: string; client: OSS } | null = null;

export function resetAliyunOssClientCache() {
  cachedClient = null;
}

export async function isAliyunOssConfigured() {
  const resolved = await resolveAliyunOssConfig();
  return Boolean(resolved.accessKeyId && resolved.accessKeySecret && resolved.bucket && resolved.region);
}

export async function validateAliyunOssConfiguration() {
  await loadStorageConfig();
  const { client, config } = await requireAliyunOssClient();
  const result = await client.getBucketInfo(config.bucket);
  return {
    ok: true as const,
    bucket: config.bucket,
    region: config.region,
    rootPath: config.rootPath,
    publicBaseUrl: config.publicBaseUrl,
    statusCode: result.res.status || 200,
    endpoint: defaultAliyunOssOrigin(config),
  };
}

export async function getAliyunOssBucketStats(): Promise<AliyunOssBucketStats> {
  await loadStorageConfig();
  const { client, config } = await requireAliyunOssClient();
  const result = await (client as OSS & {
    getBucketStat(name: string, options: Record<string, never>): Promise<{ stat: Record<string, string | undefined> }>;
  }).getBucketStat(config.bucket, {});
  const measuredAtSeconds = finiteNumber(result.stat.LastModifiedTime);
  return {
    bucket: config.bucket,
    storageBytes: finiteNumber(result.stat.Storage) ?? 0,
    objectCount: finiteNumber(result.stat.ObjectCount) ?? 0,
    standardStorageBytes: finiteNumber(result.stat.StandardStorage) ?? 0,
    standardObjectCount: finiteNumber(result.stat.StandardObjectCount) ?? 0,
    measuredAt: measuredAtSeconds === null ? "" : new Date(measuredAtSeconds * 1000).toISOString(),
  };
}

export async function listAliyunOssFiles(): Promise<AliyunOssStoredFile[]> {
  const { client, config } = await requireAliyunOssClient();
  const prefix = config.rootPath ? `${config.rootPath}/` : "";
  const files: AliyunOssStoredFile[] = [];
  let marker = "";
  for (;;) {
    const result = await client.list({
      prefix,
      marker: marker || undefined,
      "max-keys": 1000,
    }, {});
    for (const item of result.objects || []) {
      const relativePath = stripAliyunOssRoot(item.name, config.rootPath);
      if (!relativePath || item.name.endsWith("/")) continue;
      files.push({
        relativePath,
        size: finiteNumber(item.size),
        lastModifiedAt: String(item.lastModified || "").trim(),
        etag: String(item.etag || "").replace(/^"|"$/gu, ""),
      });
    }
    if (!result.isTruncated) break;
    const nextMarker = String(result.nextMarker || result.objects?.at(-1)?.name || "").trim();
    if (!nextMarker || nextMarker === marker) break;
    marker = nextMarker;
  }
  return files;
}

export async function uploadAliyunOssFile(
  relativePath: string,
  buffer: Buffer,
  contentType: string,
  options: { forbidOverwrite?: boolean } = {},
) {
  const { client, config } = await requireAliyunOssClient();
  const result = await client.put(buildAliyunOssObjectKey(relativePath, config.rootPath), buffer, {
    mime: contentType || "application/octet-stream",
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      ...(options.forbidOverwrite ? { "x-oss-forbid-overwrite": "true" } : {}),
    },
  });
  return {
    etag: String((result.res.headers as Record<string, unknown> | undefined)?.etag || "").replace(/^"|"$/gu, ""),
    location: String(result.url || ""),
  };
}

export async function createAliyunOssUploadSession(
  relativePath: string,
  contentType?: string | null,
): Promise<AliyunOssUploadSession> {
  const { client, config } = await requireAliyunOssClient();
  const uploadUrl = client.signatureUrl(buildAliyunOssObjectKey(relativePath, config.rootPath), {
    method: "PUT",
    expires: DIRECT_UPLOAD_EXPIRES_SECONDS,
    ...(contentType ? { "Content-Type": contentType } : {}),
  });
  return {
    uploadUrl,
    expiresAt: new Date(Date.now() + DIRECT_UPLOAD_EXPIRES_SECONDS * 1000).toISOString(),
    strategy: "single-put",
  };
}

export async function headAliyunOssFile(relativePath: string) {
  const { client, config } = await requireAliyunOssClient();
  try {
    const result = await client.head(buildAliyunOssObjectKey(relativePath, config.rootPath));
    const headers = result.res.headers as Record<string, unknown> | undefined;
    return {
      exists: true as const,
      size: finiteNumber(headers?.["content-length"]),
      contentType: String(headers?.["content-type"] || "").trim(),
      etag: String(headers?.etag || "").replace(/^"|"$/gu, ""),
      lastModifiedAt: String(headers?.["last-modified"] || "").trim(),
    };
  } catch (error) {
    if (isAliyunOssNotFound(error)) return { exists: false as const, size: null, contentType: "", etag: "", lastModifiedAt: "" };
    throw error;
  }
}

export async function fetchAliyunOssFile(relativePath: string, range?: string | string[], ifNoneMatch?: string | string[]) {
  const { client, config } = await requireAliyunOssClient();
  const headers: Record<string, string> = {};
  if (firstHeaderValue(range)) headers.Range = firstHeaderValue(range);
  if (firstHeaderValue(ifNoneMatch)) headers["If-None-Match"] = firstHeaderValue(ifNoneMatch);
  try {
    const result = await client.get(buildAliyunOssObjectKey(relativePath, config.rootPath), { headers });
    return {
      status: Number(result.res.status) || 200,
      headers: normalizeAliyunOssHeaders(result.res.headers as Record<string, unknown> | undefined),
      body: Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content || ""),
    };
  } catch (error: any) {
    if (isAliyunOssNotFound(error)) return { status: 404, headers: new Headers(), body: Buffer.alloc(0) };
    if (Number(error?.status) === 304 || Number(error?.statusCode) === 304) {
      return { status: 304, headers: normalizeAliyunOssHeaders(error?.headers), body: Buffer.alloc(0) };
    }
    throw error;
  }
}

export async function downloadAliyunOssFileBuffer(relativePath: string) {
  const response = await fetchAliyunOssFile(relativePath);
  return response.status >= 200 && response.status < 300 ? response.body : Buffer.alloc(0);
}

export async function deleteAliyunOssFile(relativePath: string) {
  const { client, config } = await requireAliyunOssClient();
  try {
    await client.delete(buildAliyunOssObjectKey(relativePath, config.rootPath));
    return true;
  } catch (error) {
    if (isAliyunOssNotFound(error)) return false;
    throw error;
  }
}

export async function resolveAliyunOssPublicUrl(relativePath: string) {
  const { client, config } = await requireAliyunOssClient();
  const key = buildAliyunOssObjectKey(relativePath, config.rootPath);
  if (config.publicBaseUrl) return `${config.publicBaseUrl}/${encodeObjectKey(key)}`;
  return client.signatureUrl(key, { method: "GET", expires: SIGNED_URL_EXPIRES_SECONDS });
}

export async function resolveAliyunOssOriginUrl(relativePath: string) {
  const config = await resolveAliyunOssConfig();
  if (!config.bucket || !config.region) throw new Error("阿里云 OSS 存储桶或地域尚未配置");
  const key = buildAliyunOssObjectKey(relativePath, config.rootPath);
  return `${defaultAliyunOssOrigin(config)}/${encodeObjectKey(key)}`;
}

export async function resolveAliyunOssDeliveryUrl(relativePath: string) {
  const config = await resolveAliyunOssConfig();
  if (!config.bucket || !config.region) throw new Error("阿里云 OSS 存储桶或地域尚未配置");
  return buildAliyunOssDeliveryUrl(relativePath, config);
}

async function requireAliyunOssClient() {
  const config = await resolveAliyunOssConfig();
  if (!config.accessKeyId || !config.accessKeySecret) throw new Error("阿里云 OSS AccessKey ID / Secret 尚未配置");
  if (!config.bucket || !config.region) throw new Error("阿里云 OSS 存储桶或地域尚未配置");
  const fingerprint = [config.accessKeyId, config.accessKeySecret, config.bucket, config.region].join("\n");
  if (!cachedClient || cachedClient.fingerprint !== fingerprint) {
    cachedClient = {
      fingerprint,
      client: new OSS({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        bucket: config.bucket,
        region: config.region,
        secure: true,
        timeout: 120_000,
      }),
    };
  }
  return { client: cachedClient.client, config };
}

async function resolveAliyunOssConfig(): Promise<ResolvedAliyunOssConfig> {
  const runtime = await getMediaStorageRuntimeConfig();
  return {
    accessKeyId: runtime.aliyunOssAccessKeyId.trim() || runtime.legacyAliyunOssAccessKeyId.trim(),
    accessKeySecret: runtime.aliyunOssAccessKeySecret.trim() || runtime.legacyAliyunOssAccessKeySecret.trim(),
    bucket: runtime.aliyunOssBucket.trim() || runtime.legacyAliyunOssBucket.trim(),
    region: runtime.aliyunOssRegion.trim() || runtime.legacyAliyunOssRegion.trim(),
    rootPath: normalizeObjectPath(runtime.aliyunOssRootPath || runtime.legacyAliyunOssRootPath),
    publicBaseUrl: String(runtime.aliyunOssPublicBaseUrl || runtime.legacyAliyunOssPublicBaseUrl || "").trim().replace(/\/+$/u, ""),
  };
}

export function buildAliyunOssObjectKey(relativePath: string, rootPath: string) {
  return [normalizeObjectPath(rootPath), normalizeObjectPath(relativePath)].filter(Boolean).join("/");
}

export function stripAliyunOssRoot(key: string, rootPath: string) {
  const normalizedKey = normalizeObjectPath(key);
  const normalizedRoot = normalizeObjectPath(rootPath);
  if (!normalizedRoot) return normalizedKey;
  return normalizedKey.startsWith(`${normalizedRoot}/`) ? normalizedKey.slice(normalizedRoot.length + 1) : "";
}

function normalizeObjectPath(value: string) {
  const parts = String(value || "").trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error("OSS 对象路径不合法");
  return parts.join("/");
}

export function encodeObjectKey(value: string) {
  return normalizeObjectPath(value).split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function buildAliyunOssDeliveryUrl(
  relativePath: string,
  config: Pick<ResolvedAliyunOssConfig, "bucket" | "region" | "rootPath" | "publicBaseUrl">,
) {
  const key = buildAliyunOssObjectKey(relativePath, config.rootPath);
  const baseUrl = config.publicBaseUrl || defaultAliyunOssOrigin(config);
  return `${baseUrl.replace(/\/+$/u, "")}/${encodeObjectKey(key)}`;
}

function defaultAliyunOssOrigin(config: Pick<ResolvedAliyunOssConfig, "bucket" | "region">) {
  return `https://${config.bucket}.${config.region}.aliyuncs.com`;
}

function finiteNumber(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
}

function normalizeAliyunOssHeaders(input: Record<string, unknown> | undefined) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input || {})) {
    if (value === undefined || value === null) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  return headers;
}

function isAliyunOssNotFound(error: any) {
  return Number(error?.status) === 404
    || Number(error?.statusCode) === 404
    || ["NoSuchKey", "NoSuchBucket", "NotFound"].includes(String(error?.code || ""));
}
