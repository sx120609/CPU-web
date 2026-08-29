import path from "node:path";
import sharp from "sharp";

export type ForumImageMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export const FORUM_IMAGE_UPLOAD_MAX_BYTES = 520 * 1024;
export const FORUM_IMAGE_REVIEW_MAX_BYTES = 4 * 1024 * 1024;

const FORUM_IMAGE_UPLOAD_MAX_DIMENSION = 1400;
const FORUM_IMAGE_REVIEW_MAX_DIMENSION = 2048;
const FORUM_IMAGE_MAX_INPUT_PIXELS = 50_000_000;
export const FORUM_IMAGE_MAX_SOURCE_BYTES = 32 * 1024 * 1024;

type NormalizedForumImage = {
  buffer: Buffer;
  mimeType: ForumImageMimeType;
  extension: "jpg" | "png" | "webp" | "gif";
  transcoded: boolean;
};

type JpegAttempt = {
  maxDimension: number;
  quality: number;
};

const UPLOAD_JPEG_ATTEMPTS: JpegAttempt[] = [
  { maxDimension: FORUM_IMAGE_UPLOAD_MAX_DIMENSION, quality: 82 },
  { maxDimension: FORUM_IMAGE_UPLOAD_MAX_DIMENSION, quality: 72 },
  { maxDimension: 1200, quality: 68 },
  { maxDimension: 1000, quality: 64 },
  { maxDimension: 800, quality: 58 },
  { maxDimension: 640, quality: 52 },
];

const REVIEW_JPEG_ATTEMPTS: JpegAttempt[] = [
  { maxDimension: FORUM_IMAGE_REVIEW_MAX_DIMENSION, quality: 85 },
  { maxDimension: FORUM_IMAGE_REVIEW_MAX_DIMENSION, quality: 75 },
  { maxDimension: 1800, quality: 72 },
  { maxDimension: 1600, quality: 68 },
  { maxDimension: 1400, quality: 62 },
];

export async function normalizeForumImageUpload(input: {
  buffer: Buffer;
  mimeType?: string | null;
  fileName?: string | null;
}): Promise<NormalizedForumImage> {
  const source = validateForumImageSource(input);
  if (input.buffer.length > FORUM_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error("图片不能超过 32MB");
  }

  try {
    const metadata = await createSharpInput(input.buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error("图片尺寸无效");
    if (source.mimeType === "image/gif") {
      return {
        buffer: input.buffer,
        mimeType: source.mimeType,
        extension: source.extension,
        transcoded: false,
      };
    }
    const orientation = Number(metadata.orientation || 1);
    if (
      input.buffer.length <= FORUM_IMAGE_UPLOAD_MAX_BYTES
      && metadata.width <= FORUM_IMAGE_UPLOAD_MAX_DIMENSION
      && metadata.height <= FORUM_IMAGE_UPLOAD_MAX_DIMENSION
      && orientation <= 1
    ) {
      return {
        buffer: input.buffer,
        mimeType: source.mimeType,
        extension: source.extension,
        transcoded: false,
      };
    }

    const buffer = await encodeBoundedJpeg(input.buffer, UPLOAD_JPEG_ATTEMPTS, FORUM_IMAGE_UPLOAD_MAX_BYTES);
    return {
      buffer,
      mimeType: "image/jpeg",
      extension: "jpg",
      transcoded: true,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "图片压缩后仍然过大") throw error;
    throw new Error("图片内容无法读取，可能文件已损坏");
  }
}

/**
 * Build a bounded single-frame payload for the visual moderation provider.
 * The public forum asset is never overwritten: this only compresses the copy
 * embedded in the AI request, so legacy large uploads can be reviewed normally.
 */
export async function prepareForumImageForReview(input: {
  buffer: Buffer;
  mimeType?: string | null;
  fileName?: string | null;
}): Promise<NormalizedForumImage> {
  const source = validateForumImageSource(input);
  try {
    const metadata = await createSharpInput(input.buffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error("图片尺寸无效");
    if (input.buffer.length <= FORUM_IMAGE_REVIEW_MAX_BYTES && source.mimeType !== "image/gif") {
      return {
        buffer: input.buffer,
        mimeType: source.mimeType,
        extension: source.extension,
        transcoded: false,
      };
    }
    const buffer = await encodeBoundedJpeg(input.buffer, REVIEW_JPEG_ATTEMPTS, FORUM_IMAGE_REVIEW_MAX_BYTES);
    return {
      buffer,
      mimeType: "image/jpeg",
      extension: "jpg",
      transcoded: true,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "图片压缩后仍然过大") throw error;
    throw new Error("图片内容无法读取，可能文件已损坏");
  }
}

function validateForumImageSource(input: {
  buffer: Buffer;
  mimeType?: string | null;
  fileName?: string | null;
}) {
  if (!input.buffer.length) throw new Error("图片文件为空");
  const mimeType = detectForumImageMimeType(input.buffer, input.mimeType, input.fileName);
  if (!mimeType) throw new Error("图片格式暂不支持");
  return {
    mimeType,
    extension: extensionForMimeType(mimeType),
  };
}

async function encodeBoundedJpeg(buffer: Buffer, attempts: JpegAttempt[], maxBytes: number) {
  let smallest = Buffer.alloc(0);
  for (const attempt of attempts) {
    const output = await createSharpInput(buffer)
      .rotate()
      .resize({
        width: attempt.maxDimension,
        height: attempt.maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: attempt.quality, mozjpeg: true })
      .toBuffer();
    if (!smallest.length || output.length < smallest.length) smallest = output;
    if (output.length && output.length <= maxBytes) return output;
  }
  if (smallest.length) return smallest;
  throw new Error("图片压缩后仍然过大");
}

function createSharpInput(buffer: Buffer) {
  return sharp(buffer, {
    animated: false,
    pages: 1,
    failOn: "error",
    limitInputPixels: FORUM_IMAGE_MAX_INPUT_PIXELS,
  });
}

function detectForumImageMimeType(
  buffer: Buffer,
  inputMime?: string | null,
  fileName?: string | null,
): ForumImageMimeType | "" {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }

  const normalizedMime = String(inputMime || "").trim().toLowerCase();
  if (isForumImageMimeType(normalizedMime)) return normalizedMime;
  const extension = path.extname(String(fileName || "")).replace(/^\./, "").toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "";
}

function isForumImageMimeType(value: string): value is ForumImageMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp" || value === "image/gif";
}

function extensionForMimeType(mimeType: ForumImageMimeType) {
  if (mimeType === "image/jpeg") return "jpg" as const;
  if (mimeType === "image/png") return "png" as const;
  if (mimeType === "image/webp") return "webp" as const;
  return "gif" as const;
}
