import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const USER_SCRIPT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UserScriptUpdateChannel = {
  id: "chaoxing" | "multiplatform" | "weban";
  expectedName: string;
  manifestPath: string;
  sourcePath: string;
  cacheFileName: string;
  maxBytes: number;
};

export const CHAOXING_USER_SCRIPT_CHANNEL: UserScriptUpdateChannel = {
  id: "chaoxing",
  expectedName: "药大拾间·学习通助手",
  manifestPath: "/api/site/userscripts/chaoxing-helper",
  sourcePath: "/api/site/userscripts/chaoxing-helper/source",
  cacheFileName: "chaoxing-helper-cache.json",
  maxBytes: 512 * 1024,
};

export const MULTIPLATFORM_USER_SCRIPT_CHANNEL: UserScriptUpdateChannel = {
  id: "multiplatform",
  expectedName: "药大拾间·全平台网课助手",
  manifestPath: "/api/site/userscripts/multiplatform-helper",
  sourcePath: "/api/site/userscripts/multiplatform-helper/source",
  cacheFileName: "multiplatform-helper-cache.json",
  // 当前经审计的 OCS 构建约 800 KiB。独立上限避免放宽学习通脚本的边界。
  maxBytes: 2 * 1024 * 1024,
};

export const WEBAN_USER_SCRIPT_CHANNEL: UserScriptUpdateChannel = {
  id: "weban",
  expectedName: "药大拾间·安全微伴助手",
  manifestPath: "/api/site/userscripts/weban-helper",
  sourcePath: "/api/site/userscripts/weban-helper/source",
  cacheFileName: "weban-helper-cache.json",
  maxBytes: 512 * 1024,
};

// 保留旧导出名，已有测试与第三方构建脚本无需同步迁移。
export const USER_SCRIPT_MANIFEST_PATH = CHAOXING_USER_SCRIPT_CHANNEL.manifestPath;
export const USER_SCRIPT_SOURCE_PATH = CHAOXING_USER_SCRIPT_CHANNEL.sourcePath;
export const USER_SCRIPT_MAX_BYTES = CHAOXING_USER_SCRIPT_CHANNEL.maxBytes;

export type UserScriptUpdateManifest = {
  name: string;
  version: string;
  sha256: string;
  size: number;
  sourceUrl: string;
};

export type UserScriptUpdateResult = {
  status: "current" | "updated";
  source: string;
  manifest: UserScriptUpdateManifest;
};

type CacheEnvelope = {
  manifest: UserScriptUpdateManifest;
  source: string;
};

type UpdateOptions = {
  origin: string;
  cacheDirectory: string;
  currentSource: string;
  validateSource: (source: string) => void;
  channel?: UserScriptUpdateChannel;
  fetchImpl?: typeof fetch;
};

const cachePath = (directory: string, channel: UserScriptUpdateChannel) =>
  path.join(directory, channel.cacheFileName);

export const sha256Text = (source: string): string =>
  createHash("sha256").update(source, "utf8").digest("hex");

export function parseUserScriptIdentity(source: string): { name: string; version: string } {
  const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/)?.[1] ?? "";
  const value = (key: string) =>
    new RegExp(`^\\s*//\\s*@${key}\\s+(.+?)\\s*$`, "m").exec(header)?.[1]?.trim() ?? "";
  return { name: value("name"), version: value("version") };
}

const parseComparableVersion = (value: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.+)?$/.exec(value);
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])] as const,
    prerelease: match[4]?.split(".") ?? [],
  };
};

export function compareUserScriptVersions(left: string, right: string): number {
  const a = parseComparableVersion(left);
  const b = parseComparableVersion(right);
  if (!a || !b) return left.localeCompare(right, "en");
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== undefined || rightNumber !== undefined) return leftNumber !== undefined ? -1 : 1;
    return leftPart.localeCompare(rightPart, "en") > 0 ? 1 : -1;
  }
  return 0;
}

export function selectPreferredUserScriptSource(
  builtInSource: string,
  cachedSource?: string,
): { source: string; origin: "builtin" | "cache" } {
  if (!cachedSource) return { source: builtInSource, origin: "builtin" };
  const builtIn = parseUserScriptIdentity(builtInSource);
  const cached = parseUserScriptIdentity(cachedSource);
  if (
    cached.name === builtIn.name
    && compareUserScriptVersions(cached.version, builtIn.version) >= 0
  ) {
    return { source: cachedSource, origin: "cache" };
  }
  return { source: builtInSource, origin: "builtin" };
}

export function validateUserScriptRelease(
  source: string,
  manifest: UserScriptUpdateManifest,
  channel: UserScriptUpdateChannel = CHAOXING_USER_SCRIPT_CHANNEL,
): void {
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes === 0 || bytes > channel.maxBytes || bytes !== manifest.size) {
    throw new Error("云端脚本大小校验失败");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || sha256Text(source) !== manifest.sha256) {
    throw new Error("云端脚本 SHA-256 校验失败");
  }
  const identity = parseUserScriptIdentity(source);
  if (identity.name !== manifest.name || identity.version !== manifest.version) {
    throw new Error("云端脚本元数据与版本清单不一致");
  }
}

function parseManifest(
  value: unknown,
  channel: UserScriptUpdateChannel,
): UserScriptUpdateManifest {
  const manifest = (value ?? {}) as Partial<UserScriptUpdateManifest>;
  if (
    manifest.name !== channel.expectedName
    || typeof manifest.version !== "string"
    || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)
    || typeof manifest.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || typeof manifest.size !== "number"
    || !Number.isSafeInteger(manifest.size)
    || manifest.size <= 0
    || manifest.size > channel.maxBytes
    || manifest.sourceUrl !== channel.sourcePath
  ) {
    throw new Error("云端脚本版本清单无效");
  }
  return manifest as UserScriptUpdateManifest;
}

async function replaceFileAtomically(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporary, target);
  } catch {
    await rm(target, { force: true });
    await rename(temporary, target);
  }
}

export async function readCachedUserScript(
  cacheDirectory: string,
  validateSource: (source: string) => void,
  channel: UserScriptUpdateChannel = CHAOXING_USER_SCRIPT_CHANNEL,
): Promise<UserScriptUpdateResult | undefined> {
  try {
    const envelope = JSON.parse(await readFile(cachePath(cacheDirectory, channel), "utf8")) as Partial<CacheEnvelope>;
    const manifest = parseManifest(envelope.manifest, channel);
    if (typeof envelope.source !== "string") return undefined;
    validateUserScriptRelease(envelope.source, manifest, channel);
    validateSource(envelope.source);
    return { status: "current", source: envelope.source, manifest };
  } catch {
    return undefined;
  }
}

export async function checkUserScriptUpdate(options: UpdateOptions): Promise<UserScriptUpdateResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const channel = options.channel ?? CHAOXING_USER_SCRIPT_CHANNEL;
  const manifestResponse = await fetchImpl(new URL(channel.manifestPath, options.origin), {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!manifestResponse.ok) throw new Error(`脚本版本检查失败：HTTP ${manifestResponse.status}`);
  const envelope = await manifestResponse.json() as { data?: unknown };
  const manifest = parseManifest(envelope.data, channel);

  if (sha256Text(options.currentSource) === manifest.sha256) {
    return { status: "current", source: options.currentSource, manifest };
  }

  const currentIdentity = parseUserScriptIdentity(options.currentSource);
  if (
    currentIdentity.name === channel.expectedName
    && compareUserScriptVersions(manifest.version, currentIdentity.version) <= 0
  ) {
    return {
      status: "current",
      source: options.currentSource,
      manifest: {
        name: currentIdentity.name,
        version: currentIdentity.version,
        sha256: sha256Text(options.currentSource),
        size: Buffer.byteLength(options.currentSource, "utf8"),
        sourceUrl: channel.sourcePath,
      },
    };
  }

  const sourceUrl = new URL(manifest.sourceUrl, options.origin);
  // 用发布哈希隔离每一版正文，避免反向代理把刚发布的清单与旧正文拼在一起。
  sourceUrl.searchParams.set("sha256", manifest.sha256);
  const sourceResponse = await fetchImpl(sourceUrl, {
    headers: { accept: "application/javascript" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!sourceResponse.ok) throw new Error(`脚本下载失败：HTTP ${sourceResponse.status}`);
  const declaredSize = Number(sourceResponse.headers.get("content-length") || 0);
  if (declaredSize > channel.maxBytes) throw new Error("云端脚本超过大小上限");
  const source = await sourceResponse.text();
  validateUserScriptRelease(source, manifest, channel);
  options.validateSource(source);

  await replaceFileAtomically(cachePath(options.cacheDirectory, channel), JSON.stringify({ manifest, source }));
  return { status: "updated", source, manifest };
}
