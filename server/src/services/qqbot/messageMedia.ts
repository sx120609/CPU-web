import crypto from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { callQqBotAction } from "./connection";
import { escapeShareCardHtml } from "./shareCards";
import { saveMediaAsset } from "../mediaStorage";
import { createVideoPosterAsset } from "../videoPoster";

const QQBOT_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const QQBOT_VIDEO_MAX_BYTES = 80 * 1024 * 1024;
const qqImageUploadCache = new Map<string, Promise<string>>();
const qqVideoUploadCache = new Map<string, Promise<{ url: string; posterUrl: string } | null>>();
export function renderQqVideoBlock(url: string, posterUrl?: string) {
  const safeUrl = escapeShareCardHtml(String(url || "").trim());
  if (!safeUrl) return "[视频]";
  const safePoster = escapeShareCardHtml(String(posterUrl || "").trim());
  const posterAttr = safePoster ? ` poster="${safePoster}"` : "";
  return [
    `<div class="qq-video-card">`,
    `<video class="qq-inline-video" controls preload="metadata" playsinline src="${safeUrl}"${posterAttr}>`,
    "你的浏览器暂不支持站内视频预览。",
    `</video>`,
    `</div>`,
  ].join("\n");
}

export async function resolveQqImageUrl(urlLike: unknown, fileLike: unknown): Promise<string> {
  const key = `${String(urlLike || "").trim()}|${String(fileLike || "").trim()}`;
  if (qqImageUploadCache.has(key)) return qqImageUploadCache.get(key)!;
  const task = downloadQqImageToUpload(urlLike, fileLike).catch(() => "");
  qqImageUploadCache.set(key, task);
  const result = await task;
  if (!result) qqImageUploadCache.delete(key);
  return result;
}

export async function resolveQqVideoUrl(urlLike: unknown, fileLike: unknown): Promise<{ url: string; posterUrl: string } | null> {
  const key = `${String(urlLike || "").trim()}|${String(fileLike || "").trim()}`;
  if (qqVideoUploadCache.has(key)) return qqVideoUploadCache.get(key)!;
  const task = downloadQqVideoToUpload(urlLike, fileLike).catch(() => null);
  qqVideoUploadCache.set(key, task);
  const result = await task;
  if (!result) qqVideoUploadCache.delete(key);
  return result;
}

function normalizeRemoteMediaUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw;
}

function normalizeLocalMediaPath(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^file:\/\//i.test(raw)) {
    try {
      return decodeURIComponent(new URL(raw).pathname.replace(/^\/+/, ""));
    } catch {
      return "";
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("/")) return raw;
  return "";
}

async function downloadQqImageToUpload(urlLike: unknown, fileLike: unknown): Promise<string> {
  const file = String(fileLike || "").trim();
  const candidates: Array<{ kind: "remote" | "local"; value: string }> = [];
  const seen = new Set<string>();
  const pushCandidate = (kind: "remote" | "local", value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    const key = `${kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ kind, value: normalized });
  };
  const pushFromUnknown = (value: unknown) => {
    const remote = normalizeRemoteMediaUrl(value);
    if (remote) {
      pushCandidate("remote", remote);
      return;
    }
    const local = normalizeLocalMediaPath(value);
    if (local) pushCandidate("local", local);
  };

  pushFromUnknown(urlLike);
  pushFromUnknown(fileLike);
  if (file) {
    const payload = await callQqBotAction("get_image", { file }).catch(() => null);
    pushFromUnknown(payload?.data?.url);
    pushFromUnknown(payload?.data?.src);
    pushFromUnknown(payload?.data?.file);
    pushFromUnknown(payload?.data?.path);
  }

  for (const candidate of candidates) {
    const loaded = candidate.kind === "remote"
      ? await fetchRemoteImage(candidate.value)
      : await readLocalImage(candidate.value);
    if (!loaded) continue;
    return saveQqImageUpload(loaded.buffer, loaded.mime, loaded.nameHint);
  }
  return "";
}

async function downloadQqVideoToUpload(urlLike: unknown, fileLike: unknown): Promise<{ url: string; posterUrl: string } | null> {
  const file = String(fileLike || "").trim();
  const candidates: Array<{ kind: "remote" | "local"; value: string }> = [];
  const seen = new Set<string>();
  const pushCandidate = (kind: "remote" | "local", value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    const key = `${kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ kind, value: normalized });
  };
  const pushFromUnknown = (value: unknown) => {
    const remote = normalizeRemoteMediaUrl(value);
    if (remote) {
      pushCandidate("remote", remote);
      return;
    }
    const local = normalizeLocalMediaPath(value);
    if (local) pushCandidate("local", local);
  };

  pushFromUnknown(urlLike);
  pushFromUnknown(fileLike);
  if (file) {
    const payload = await callQqBotAction("get_file", { file, file_id: file }).catch(() => null);
    pushFromUnknown(payload?.data?.url);
    pushFromUnknown(payload?.data?.src);
    pushFromUnknown(payload?.data?.file);
    pushFromUnknown(payload?.data?.path);
    pushFromUnknown(payload?.data?.local);
    const base64Loaded = decodeBase64MediaPayload(payload?.data?.base64, payload?.data?.mime_type, file);
    if (base64Loaded) {
      return saveQqVideoUpload(base64Loaded.buffer, base64Loaded.mime, base64Loaded.nameHint);
    }
  }

  for (const candidate of candidates) {
    const loaded = candidate.kind === "remote"
      ? await fetchRemoteVideo(candidate.value)
      : await readLocalVideo(candidate.value);
    if (!loaded) continue;
    return saveQqVideoUpload(loaded.buffer, loaded.mime, loaded.nameHint);
  }
  return null;
}

async function fetchRemoteImage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return null;
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > QQBOT_IMAGE_MAX_BYTES) return null;
  const arrayBuffer = await response.arrayBuffer().catch(() => null);
  if (!arrayBuffer) return null;
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length || buffer.length > QQBOT_IMAGE_MAX_BYTES) return null;
  const mime = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return { buffer, mime, nameHint: url };
}

async function fetchRemoteVideo(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!response?.ok) return null;
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > QQBOT_VIDEO_MAX_BYTES) return null;
  const arrayBuffer = await response.arrayBuffer().catch(() => null);
  if (!arrayBuffer) return null;
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length || buffer.length > QQBOT_VIDEO_MAX_BYTES) return null;
  const mime = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  return { buffer, mime, nameHint: url };
}

async function readLocalImage(filePath: string) {
  const buffer = await readFile(filePath).catch(() => null);
  if (!buffer?.length || buffer.length > QQBOT_IMAGE_MAX_BYTES) return null;
  return { buffer, mime: "", nameHint: filePath };
}

async function readLocalVideo(filePath: string) {
  const buffer = await readFile(filePath).catch(() => null);
  if (!buffer?.length || buffer.length > QQBOT_VIDEO_MAX_BYTES) return null;
  return { buffer, mime: "", nameHint: filePath };
}

async function saveQqImageUpload(buffer: Buffer, mime: string, nameHint?: string) {
  const ext = detectImageExtension(buffer, mime, nameHint);
  if (!ext) return "";
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const relativeDir = path.join("forum", month);
  const filename = `qqbot-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const saved = await saveMediaAsset({
    relativePath: path.posix.join(relativeDir.replace(/\\/g, "/"), filename),
    buffer,
    contentType: mime || undefined,
    mediaKind: "image",
  });
  return saved.url;
}

async function saveQqVideoUpload(buffer: Buffer, mime: string, nameHint?: string) {
  const ext = detectVideoExtension(buffer, mime, nameHint);
  if (!ext) return null;
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const relativeDir = path.join("forum", month);
  const filenameBase = `qqbot-video-${Date.now()}-${crypto.randomUUID()}`;
  const saved = await saveMediaAsset({
    relativePath: path.posix.join(relativeDir.replace(/\\/g, "/"), `${filenameBase}.${ext}`),
    buffer,
    contentType: mime || resolveVideoMimeTypeByExt(ext),
    mediaKind: "video",
  });
  const posterUrl = await createVideoPosterAsset({
    videoLocalPath: saved.localPath,
    videoRelativePath: saved.relativePath,
  }).catch(() => "");
  return {
    url: saved.url,
    posterUrl,
  };
}

function detectImageExtension(buffer: Buffer, mime: string, nameHint?: string) {
  const normalizedMime = String(mime || "").toLowerCase();
  if (normalizedMime.includes("jpeg") || normalizedMime.includes("jpg")) return "jpg";
  if (normalizedMime.includes("png")) return "png";
  if (normalizedMime.includes("webp")) return "webp";
  if (normalizedMime.includes("gif")) return "gif";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "gif";
  }
  const ext = path.extname(String(nameHint || "")).replace(/^\./, "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  return "";
}

function detectVideoExtension(buffer: Buffer, mime: string, nameHint?: string) {
  const normalizedMime = String(mime || "").toLowerCase();
  if (normalizedMime.includes("mp4")) return "mp4";
  if (normalizedMime.includes("webm")) return "webm";
  if (normalizedMime.includes("ogg")) return "ogv";
  if (normalizedMime.includes("quicktime")) return "mov";
  if (normalizedMime.includes("x-m4v")) return "m4v";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return normalizeVideoHintExtension(nameHint) || "mp4";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    const hinted = normalizeVideoHintExtension(nameHint);
    return hinted === "mkv" ? "mkv" : "webm";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS") return "ogv";
  return normalizeVideoHintExtension(nameHint);
}

function normalizeVideoHintExtension(nameHint?: string) {
  const ext = path.extname(String(nameHint || "")).replace(/^\./, "").toLowerCase();
  if (["mp4", "webm", "ogv", "ogg", "mov", "m4v", "mkv"].includes(ext)) {
    return ext === "ogg" ? "ogv" : ext;
  }
  return "";
}

function resolveVideoMimeTypeByExt(ext: string) {
  const mimeByExt: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
  };
  return mimeByExt[String(ext || "").toLowerCase()] || "application/octet-stream";
}

function decodeBase64MediaPayload(base64Like: unknown, mimeLike: unknown, nameHint?: string) {
  const raw = String(base64Like || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/^base64:\/\//i, "").replace(/\s+/g, "");
  if (!normalized) return null;
  try {
    const buffer = Buffer.from(normalized, "base64");
    if (!buffer.length) return null;
    return {
      buffer,
      mime: String(mimeLike || "").trim().toLowerCase(),
      nameHint: nameHint || "",
    };
  } catch {
    return null;
  }
}

