import COS from "cos-nodejs-sdk-v5";
import { getMediaStorageRuntimeConfig } from "./storageConfig";

const SIGNED_URL_EXPIRES_SECONDS = 15 * 60;
const DIRECT_UPLOAD_EXPIRES_SECONDS = 3 * 60 * 60;

export type TencentCosStoredFile = {
  relativePath: string;
  size: number | null;
  lastModifiedAt: string;
  etag: string;
};

export type TencentCosUploadSession = {
  uploadUrl: string;
  expiresAt: string;
  strategy: "single-put";
};

type ResolvedTencentCosConfig = {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  rootPath: string;
  publicBaseUrl: string;
};

let cachedClient: { fingerprint: string; client: COS } | null = null;

export function resetTencentCosClientCache() {
  cachedClient = null;
}

export async function isTencentCosConfigured() {
  const resolved = await resolveTencentCosConfig();
  return Boolean(resolved.secretId && resolved.secretKey && resolved.bucket && resolved.region);
}

export async function validateTencentCosConfiguration() {
  const { client, config } = await requireTencentCosClient();
  const result = await client.headBucket({ Bucket: config.bucket, Region: config.region });
  return {
    ok: true as const,
    bucket: config.bucket,
    region: config.region,
    rootPath: config.rootPath,
    publicBaseUrl: config.publicBaseUrl,
    statusCode: result.statusCode || 200,
    endpoint: defaultTencentCosOrigin(config),
  };
}

export async function listTencentCosFiles(): Promise<TencentCosStoredFile[]> {
  const { client, config } = await requireTencentCosClient();
  const prefix = config.rootPath ? `${config.rootPath}/` : "";
  const files: TencentCosStoredFile[] = [];
  let marker = "";
  for (;;) {
    const result = await client.getBucket({
      Bucket: config.bucket,
      Region: config.region,
      Prefix: prefix,
      Marker: marker || undefined,
      MaxKeys: 1000,
    });
    for (const item of result.Contents || []) {
      const relativePath = stripTencentCosRoot(item.Key, config.rootPath);
      if (!relativePath || item.Key.endsWith("/")) continue;
      files.push({
        relativePath,
        size: finiteNumber(item.Size),
        lastModifiedAt: String(item.LastModified || "").trim(),
        etag: String(item.ETag || "").replace(/^"|"$/gu, ""),
      });
    }
    if (String(result.IsTruncated).toLowerCase() !== "true") break;
    const nextMarker = String(result.NextMarker || result.Contents?.at(-1)?.Key || "").trim();
    if (!nextMarker || nextMarker === marker) break;
    marker = nextMarker;
  }
  return files;
}

export async function uploadTencentCosFile(relativePath: string, buffer: Buffer, contentType: string) {
  const { client, config } = await requireTencentCosClient();
  const result = await client.putObject({
    Bucket: config.bucket,
    Region: config.region,
    Key: buildTencentCosObjectKey(relativePath, config.rootPath),
    Body: buffer,
    ContentLength: buffer.byteLength,
    ContentType: contentType || "application/octet-stream",
    CacheControl: "public, max-age=31536000, immutable",
  });
  return {
    etag: String(result.ETag || "").replace(/^"|"$/gu, ""),
    location: String(result.Location || ""),
  };
}

export async function createTencentCosUploadSession(
  relativePath: string,
  _contentType?: string | null,
): Promise<TencentCosUploadSession> {
  const { client, config } = await requireTencentCosClient();
  const uploadUrl = client.getObjectUrl({
    Bucket: config.bucket,
    Region: config.region,
    Key: buildTencentCosObjectKey(relativePath, config.rootPath),
    Method: "PUT",
    Sign: true,
    Expires: DIRECT_UPLOAD_EXPIRES_SECONDS,
    Protocol: "https:",
  });
  return {
    uploadUrl,
    expiresAt: new Date(Date.now() + DIRECT_UPLOAD_EXPIRES_SECONDS * 1000).toISOString(),
    strategy: "single-put",
  };
}

export async function headTencentCosFile(relativePath: string) {
  const { client, config } = await requireTencentCosClient();
  try {
    const result = await client.headObject({
      Bucket: config.bucket,
      Region: config.region,
      Key: buildTencentCosObjectKey(relativePath, config.rootPath),
    });
    return {
      exists: true as const,
      size: finiteNumber(result.headers?.["content-length"]),
      contentType: String(result.headers?.["content-type"] || "").trim(),
      etag: String(result.ETag || result.headers?.etag || "").replace(/^"|"$/gu, ""),
      lastModifiedAt: String(result.headers?.["last-modified"] || "").trim(),
    };
  } catch (error) {
    if (isTencentCosNotFound(error)) return { exists: false as const, size: null, contentType: "", etag: "", lastModifiedAt: "" };
    throw error;
  }
}

export async function fetchTencentCosFile(relativePath: string, range?: string | string[], ifNoneMatch?: string | string[]) {
  const { client, config } = await requireTencentCosClient();
  try {
    const result = await client.getObject({
      Bucket: config.bucket,
      Region: config.region,
      Key: buildTencentCosObjectKey(relativePath, config.rootPath),
      ...(firstHeaderValue(range) ? { Range: firstHeaderValue(range) } : {}),
      ...(firstHeaderValue(ifNoneMatch) ? { IfNoneMatch: firstHeaderValue(ifNoneMatch) } : {}),
    });
    return {
      status: Number(result.statusCode) || 200,
      headers: normalizeTencentCosHeaders(result.headers),
      body: Buffer.isBuffer(result.Body) ? result.Body : Buffer.from(result.Body || ""),
    };
  } catch (error: any) {
    if (isTencentCosNotFound(error)) return { status: 404, headers: new Headers(), body: Buffer.alloc(0) };
    if (Number(error?.statusCode) === 304) return { status: 304, headers: normalizeTencentCosHeaders(error?.headers), body: Buffer.alloc(0) };
    throw error;
  }
}

export async function downloadTencentCosFileBuffer(relativePath: string) {
  const response = await fetchTencentCosFile(relativePath);
  return response.status >= 200 && response.status < 300 ? response.body : Buffer.alloc(0);
}

export async function deleteTencentCosFile(relativePath: string) {
  const { client, config } = await requireTencentCosClient();
  try {
    await client.deleteObject({
      Bucket: config.bucket,
      Region: config.region,
      Key: buildTencentCosObjectKey(relativePath, config.rootPath),
    });
    return true;
  } catch (error) {
    if (isTencentCosNotFound(error)) return false;
    throw error;
  }
}

export async function resolveTencentCosPublicUrl(relativePath: string) {
  const { client, config } = await requireTencentCosClient();
  const key = buildTencentCosObjectKey(relativePath, config.rootPath);
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/${encodeObjectKey(key)}`;
  }
  return client.getObjectUrl({
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
    Method: "GET",
    Sign: true,
    Expires: SIGNED_URL_EXPIRES_SECONDS,
    Protocol: "https:",
  });
}

export async function resolveTencentCosOriginUrl(relativePath: string) {
  const config = await resolveTencentCosConfig();
  if (!config.bucket || !config.region) throw new Error("腾讯云 COS 存储桶或地域尚未配置");
  const key = buildTencentCosObjectKey(relativePath, config.rootPath);
  return `${defaultTencentCosOrigin(config)}/${encodeObjectKey(key)}`;
}

export async function resolveTencentCosDeliveryUrl(relativePath: string) {
  const config = await resolveTencentCosConfig();
  if (!config.bucket || !config.region) throw new Error("腾讯云 COS 存储桶或地域尚未配置");
  return buildTencentCosDeliveryUrl(relativePath, config);
}

async function requireTencentCosClient() {
  const config = await resolveTencentCosConfig();
  if (!config.secretId || !config.secretKey) throw new Error("腾讯云 COS SecretId / SecretKey 尚未配置");
  if (!config.bucket || !config.region) throw new Error("腾讯云 COS 存储桶或地域尚未配置");
  const fingerprint = [config.secretId, config.secretKey, config.bucket, config.region].join("\n");
  if (!cachedClient || cachedClient.fingerprint !== fingerprint) {
    cachedClient = {
      fingerprint,
      client: new COS({
        SecretId: config.secretId,
        SecretKey: config.secretKey,
        Protocol: "https:",
        Timeout: 120_000,
      }),
    };
  }
  return { client: cachedClient.client, config };
}

async function resolveTencentCosConfig(): Promise<ResolvedTencentCosConfig> {
  const runtime = await getMediaStorageRuntimeConfig();
  return {
    secretId: runtime.tencentCosSecretId.trim() || runtime.legacyTencentCosSecretId.trim(),
    secretKey: runtime.tencentCosSecretKey.trim() || runtime.legacyTencentCosSecretKey.trim(),
    bucket: runtime.tencentCosBucket.trim() || runtime.legacyTencentCosBucket.trim(),
    region: runtime.tencentCosRegion.trim() || runtime.legacyTencentCosRegion.trim(),
    rootPath: normalizeObjectPath(runtime.tencentCosRootPath || runtime.legacyTencentCosRootPath),
    publicBaseUrl: String(runtime.tencentCosPublicBaseUrl || runtime.legacyTencentCosPublicBaseUrl || "").trim().replace(/\/+$/u, ""),
  };
}

export function buildTencentCosObjectKey(relativePath: string, rootPath: string) {
  return [normalizeObjectPath(rootPath), normalizeObjectPath(relativePath)].filter(Boolean).join("/");
}

export function stripTencentCosRoot(key: string, rootPath: string) {
  const normalizedKey = normalizeObjectPath(key);
  const normalizedRoot = normalizeObjectPath(rootPath);
  if (!normalizedRoot) return normalizedKey;
  return normalizedKey.startsWith(`${normalizedRoot}/`) ? normalizedKey.slice(normalizedRoot.length + 1) : "";
}

function normalizeObjectPath(value: string) {
  const parts = String(value || "").trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error("COS 对象路径不合法");
  return parts.join("/");
}

export function encodeObjectKey(value: string) {
  return normalizeObjectPath(value).split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function buildTencentCosDeliveryUrl(
  relativePath: string,
  config: Pick<ResolvedTencentCosConfig, "bucket" | "region" | "rootPath" | "publicBaseUrl">,
) {
  const key = buildTencentCosObjectKey(relativePath, config.rootPath);
  const baseUrl = config.publicBaseUrl || defaultTencentCosOrigin(config);
  return `${baseUrl.replace(/\/+$/u, "")}/${encodeObjectKey(key)}`;
}

function defaultTencentCosOrigin(config: Pick<ResolvedTencentCosConfig, "bucket" | "region">) {
  return `https://${config.bucket}.cos.${config.region}.myqcloud.com`;
}

function finiteNumber(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
}

function normalizeTencentCosHeaders(input: Record<string, any> | undefined) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input || {})) {
    if (value === undefined || value === null) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  return headers;
}

function isTencentCosNotFound(error: any) {
  return Number(error?.statusCode) === 404 || ["NoSuchKey", "NoSuchResource", "NotFound"].includes(String(error?.code || ""));
}
