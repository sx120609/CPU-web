import sharp from "sharp";

export const AI_IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const AI_IMAGE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const AI_IMAGE_MAX_DATA_URL_LENGTH = 12 * 1024 * 1024;
const AI_IMAGE_MAX_PIXELS = 50_000_000;
const AI_IMAGE_MAX_DIMENSION = 4096;

type AiImageMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const DATA_URL_PATTERN = /^data:image\/(jpeg|jpg|png|webp|gif);base64,(.*)$/is;

/**
 * Decode and re-encode an AI image before it reaches an upstream provider.
 *
 * A MIME type and a base64-looking string are not proof that the payload is an
 * image: gateways sometimes return HTML, truncated data, or an animated format
 * that Ollama's OpenAI-compatible endpoint cannot consume. Sharp is used as the
 * actual decoder and every accepted image is converted to a canonical PNG (or a
 * bounded JPEG fallback) so providers receive one well-formed frame.
 */
export async function normalizeAiImageDataUrl(value: string) {
  const raw = String(value || "").trim();
  if (raw.length > AI_IMAGE_MAX_DATA_URL_LENGTH) {
    throw new Error("图片数据过大，请重新截图较小区域");
  }
  const match = raw.match(DATA_URL_PATTERN);
  if (!match || !isStrictBase64(match[2])) {
    throw new Error("图片数据不是有效的 Data URL");
  }

  const sourceMimeType = normalizeMimeType(match[1]);
  const sourceBuffer = Buffer.from(match[2], "base64");
  if (!sourceBuffer.length || sourceBuffer.length > AI_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error("图片数据为空或超过 8MB 限制");
  }

  try {
    const source = sharp(sourceBuffer, {
      animated: false,
      pages: 1,
      limitInputPixels: AI_IMAGE_MAX_PIXELS,
    });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height) throw new Error("图片尺寸无效");

    const resizeOptions = {
      width: AI_IMAGE_MAX_DIMENSION,
      height: AI_IMAGE_MAX_DIMENSION,
      fit: "inside" as const,
      withoutEnlargement: true,
    };
    const png = await source
      .clone()
      .rotate()
      .resize(resizeOptions)
      .png({ compressionLevel: 9 })
      .toBuffer();

    let output = png;
    let mimeType: AiImageMimeType = "image/png";
    if (output.length > AI_IMAGE_MAX_OUTPUT_BYTES) {
      output = await source
        .clone()
        .rotate()
        .resize({ ...resizeOptions, width: 3072, height: 3072 })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      mimeType = "image/jpeg";
    }
    if (!output.length || output.length > AI_IMAGE_MAX_OUTPUT_BYTES) {
      throw new Error("图片规范化后仍超过 8MB 限制");
    }

    return {
      dataUrl: `data:${mimeType};base64,${output.toString("base64")}`,
      mimeType,
      sourceMimeType,
      width: metadata.width,
      height: metadata.height,
      byteLength: output.length,
    };
  } catch (error) {
    if (error instanceof Error && /^(图片|图片数据)/u.test(error.message)) throw error;
    throw new Error("图片内容无法解码，可能已损坏或并不是图片");
  }
}

function normalizeMimeType(value: string): AiImageMimeType {
  return value.toLowerCase() === "jpg" ? "image/jpeg" : `image/${value.toLowerCase()}` as AiImageMimeType;
}

function isStrictBase64(value: string) {
  if (!value || value.length % 4 !== 0) return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}
