export interface CompressImageOptions {
  maxWidth: number;
  maxHeight: number;
  quality?: number;
  mimeType?: "image/jpeg" | "image/webp";
  maxBytes?: number;
}

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export async function compressImageFile(file: File, options: CompressImageOptions) {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("图片不能超过 8MB");
  }

  const image = await loadImage(file);
  const ratio = Math.min(
    1,
    options.maxWidth / image.naturalWidth,
    options.maxHeight / image.naturalHeight,
  );
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持图片处理");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);

  const mimeType = options.mimeType ?? "image/jpeg";
  let quality = options.quality ?? 0.82;
  let dataUrl = canvas.toDataURL(mimeType, quality);
  while (options.maxBytes && estimateDataUrlBytes(dataUrl) > options.maxBytes && quality > 0.54) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL(mimeType, quality);
  }
  if (options.maxBytes && estimateDataUrlBytes(dataUrl) > options.maxBytes) {
    throw new Error("图片压缩后仍然过大，请换一张更小的图片");
  }
  return dataUrl;
}

export function normalizeImageUploadError(error: unknown, fallback = "媒体上传失败，请稍后重试") {
  const message = error instanceof Error ? error.message : String(error ?? "").trim();
  if (!message) return fallback;
  if (/entity\.too\.large|payload too large|request entity too large/i.test(message)) {
    return "上传内容过大，请压缩图片或更换更小的文件后重试";
  }
  if (/图片压缩后仍然过大|图片不能超过|请选择图片文件|图片读取失败|当前浏览器不支持图片处理|当前仅支持上传图片或视频文件/.test(message)) {
    return message;
  }
  if (/network error|timeout/i.test(message)) {
    return fallback;
  }
  return message;
}

export function dataUrlToBlob(dataUrl: string) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error("图片数据无效");
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    image.src = url;
  });
}

function estimateDataUrlBytes(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Math.ceil(base64.length * 0.75);
}
