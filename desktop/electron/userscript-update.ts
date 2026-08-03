import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const USER_SCRIPT_MANIFEST_PATH = "/api/site/userscripts/chaoxing-helper";
export const USER_SCRIPT_SOURCE_PATH = "/api/site/userscripts/chaoxing-helper/source";
export const USER_SCRIPT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const USER_SCRIPT_MAX_BYTES = 512 * 1024;

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
  fetchImpl?: typeof fetch;
};

const cachePath = (directory: string) => path.join(directory, "chaoxing-helper-cache.json");

export const sha256Text = (source: string): string =>
  createHash("sha256").update(source, "utf8").digest("hex");

export function parseUserScriptIdentity(source: string): { name: string; version: string } {
  const header = source.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/)?.[1] ?? "";
  const value = (key: string) =>
    new RegExp(`^\\s*//\\s*@${key}\\s+(.+?)\\s*$`, "m").exec(header)?.[1]?.trim() ?? "";
  return { name: value("name"), version: value("version") };
}

export function validateUserScriptRelease(source: string, manifest: UserScriptUpdateManifest): void {
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes === 0 || bytes > USER_SCRIPT_MAX_BYTES || bytes !== manifest.size) {
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

function parseManifest(value: unknown): UserScriptUpdateManifest {
  const manifest = (value ?? {}) as Partial<UserScriptUpdateManifest>;
  if (
    manifest.name !== "药大拾间·学习通助手"
    || typeof manifest.version !== "string"
    || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)
    || typeof manifest.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || typeof manifest.size !== "number"
    || !Number.isSafeInteger(manifest.size)
    || manifest.size <= 0
    || manifest.size > USER_SCRIPT_MAX_BYTES
    || manifest.sourceUrl !== USER_SCRIPT_SOURCE_PATH
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
): Promise<UserScriptUpdateResult | undefined> {
  try {
    const envelope = JSON.parse(await readFile(cachePath(cacheDirectory), "utf8")) as Partial<CacheEnvelope>;
    const manifest = parseManifest(envelope.manifest);
    if (typeof envelope.source !== "string") return undefined;
    validateUserScriptRelease(envelope.source, manifest);
    validateSource(envelope.source);
    return { status: "current", source: envelope.source, manifest };
  } catch {
    return undefined;
  }
}

export async function checkUserScriptUpdate(options: UpdateOptions): Promise<UserScriptUpdateResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const manifestResponse = await fetchImpl(new URL(USER_SCRIPT_MANIFEST_PATH, options.origin), {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!manifestResponse.ok) throw new Error(`脚本版本检查失败：HTTP ${manifestResponse.status}`);
  const envelope = await manifestResponse.json() as { data?: unknown };
  const manifest = parseManifest(envelope.data);

  if (sha256Text(options.currentSource) === manifest.sha256) {
    return { status: "current", source: options.currentSource, manifest };
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
  if (declaredSize > USER_SCRIPT_MAX_BYTES) throw new Error("云端脚本超过大小上限");
  const source = await sourceResponse.text();
  validateUserScriptRelease(source, manifest);
  options.validateSource(source);

  await replaceFileAtomically(cachePath(options.cacheDirectory), JSON.stringify({ manifest, source }));
  return { status: "updated", source, manifest };
}
