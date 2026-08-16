import sharp from "sharp";

export type QqImageMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * Identify an image from its bytes instead of trusting a remote Content-Type
 * or filename. QQ/NapCat download endpoints can return an HTML error page
 * while still claiming image/jpeg; forwarding that page as a data URL makes
 * Ollama report the misleading "invalid image input" error.
 */
export function detectQqImageMimeType(buffer: Buffer): QqImageMimeType | "" {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return "";
  if (isJpeg(buffer)) return "image/jpeg";
  if (isPng(buffer)) return "image/png";
  if (isWebp(buffer)) return "image/webp";
  if (isGif(buffer)) return "image/gif";
  return "";
}

export function decodeQqImageDataUrl(value: string) {
  const match = String(value || "").trim().match(/^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match || !isStrictBase64(match[2])) return null;
  const buffer = Buffer.from(match[2], "base64");
  const mimeType = detectQqImageMimeType(buffer);
  if (!mimeType) return null;
  return {
    buffer,
    mimeType,
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

/**
 * Ollama's OpenAI-compatible decoder accepts JPEG/PNG/WebP but rejects GIF.
 * QQ stickers are frequently GIFs or WebPs, so normalize those formats to a
 * single PNG frame before building the request data URL.
 */
export async function normalizeQqImageForAi(buffer: Buffer) {
  const sourceMimeType = detectQqImageMimeType(buffer);
  if (!sourceMimeType) return null;
  if (sourceMimeType === "image/jpeg" || sourceMimeType === "image/png") {
    return {
      buffer,
      mimeType: sourceMimeType,
      sourceMimeType,
      transcoded: false,
    };
  }
  const normalized = await sharp(buffer, {
    animated: true,
    pages: 1,
    limitInputPixels: 50_000_000,
  }).png().toBuffer();
  if (detectQqImageMimeType(normalized) !== "image/png") return null;
  return {
    buffer: normalized,
    mimeType: "image/png" as const,
    sourceMimeType,
    transcoded: true,
  };
}

export function isStrictBase64(value: string) {
  const normalized = String(value || "").replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0) return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized);
}

function isJpeg(buffer: Buffer) {
  if (buffer.length < 4 || !buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) return false;
  return buffer.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 3;
}

function isPng(buffer: Buffer) {
  if (buffer.length < PNG_SIGNATURE.length + 12 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;
  let offset = PNG_SIGNATURE.length;
  let hasHeader = false;
  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > buffer.length) return false;
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (chunkType === "IHDR") {
      if (hasHeader || chunkLength !== 13) return false;
      hasHeader = buffer.readUInt32BE(offset + 8) > 0 && buffer.readUInt32BE(offset + 12) > 0;
      if (!hasHeader) return false;
    }
    if (chunkType === "IEND") return hasHeader && chunkLength === 0;
    offset = chunkEnd;
  }
  return false;
}

function isWebp(buffer: Buffer) {
  if (buffer.length < 30) return false;
  if (buffer.subarray(0, 4).toString("ascii") !== "RIFF" || buffer.subarray(8, 12).toString("ascii") !== "WEBP") return false;
  const riffEnd = 8 + buffer.readUInt32LE(4);
  if (riffEnd > buffer.length) return false;
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (!(chunkType === "VP8 " || chunkType === "VP8L" || chunkType === "VP8X")) return false;
  const chunkEnd = 20 + buffer.readUInt32LE(16);
  return chunkEnd <= buffer.length;
}

function isGif(buffer: Buffer) {
  if (buffer.length < 14) return false;
  const header = buffer.subarray(0, 6).toString("ascii");
  if (header !== "GIF87a" && header !== "GIF89a") return false;
  return buffer.readUInt16LE(6) > 0 && buffer.readUInt16LE(8) > 0 && buffer[buffer.length - 1] === 0x3b;
}
