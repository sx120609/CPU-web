export type NativeAppBridge = {
  getVersionCode?: () => number;
  getVersionName?: () => string;
  supportsScheduleWidget?: () => boolean;
  supportsInAppApkDownload?: () => boolean;
  previewImages?: (payload: string) => boolean;
  copyText?: (text: string) => boolean;
  openExternalUrl?: (url: string) => void;
  downloadAndInstallApk?: (url: string, fileName?: string) => boolean;
  saveImage?: (dataUrl: string, fileName?: string) => boolean | Promise<boolean>;
  saveImageUrl?: (url: string, fileName?: string) => boolean | Promise<boolean>;
  installScheduleWidget?: (payload: string) => void;
};

export type NativeImagePreviewItem = {
  url: string;
  title?: string;
  fileName?: string;
};

export type NativeImagePreviewPayload = {
  images: NativeImagePreviewItem[];
  index?: number;
};

export function getNativeBridge(): NativeAppBridge | null {
  if (typeof window === "undefined") return null;
  return ((window as any).CPUHarmony ?? (window as any).CPUAndroid ?? (window as any).CPUIOS ?? null) as NativeAppBridge | null;
}

export function hasNativeImageSaveBridge() {
  return typeof getNativeBridge()?.saveImage === "function";
}

export function hasNativeImagePreviewBridge() {
  if (isAndroidNativePreviewFallback()) return false;
  return typeof getNativeBridge()?.previewImages === "function";
}

export function previewNativeImages(payload: NativeImagePreviewPayload) {
  const bridge = getNativeBridge();
  if (typeof bridge?.previewImages !== "function") return false;
  const images = payload.images
    .map((item) => ({
      url: absoluteImageUrl(item.url),
      title: item.title || "",
      fileName: item.fileName || fileNameFromUrl(item.url),
    }))
    .filter((item) => item.url);
  if (!images.length) return false;
  const index = Math.max(0, Math.min(payload.index ?? 0, images.length - 1));
  try {
    return bridge.previewImages(JSON.stringify({ images, index })) !== false;
  } catch {
    return false;
  }
}

export function fileNameFromUrl(src: string, fallback = "image.png") {
  try {
    const url = new URL(src, window.location.origin);
    const last = decodeURIComponent(url.pathname.split("/").pop() || "");
    if (/\.[a-z0-9]+$/i.test(last)) return last;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function absoluteImageUrl(src: string) {
  try {
    return new URL(src, window.location.origin).href;
  } catch {
    return src || "";
  }
}

export function installIosNativeImageBridge() {
  if (typeof window === "undefined" || !isIosDevice()) return;
  const currentBridge = ((window as any).CPUIOS ?? {}) as NativeAppBridge;
  if (currentBridge.saveImage && currentBridge.saveImageUrl && currentBridge.previewImages) return;

  (window as any).CPUIOS = {
    ...currentBridge,
    getVersionCode: () => 1,
    getVersionName: () => "ios-web",
    previewImages: (payload: string) => {
      return previewIosImage(payload);
    },
    saveImage: (dataUrl: string, fileName = "image.png") => {
      void shareIosImageDataUrl(dataUrl, fileName);
      return true;
    },
    saveImageUrl: (url: string, fileName = "image.png") => {
      void shareIosImageUrl(url, fileName);
      return true;
    },
  } satisfies NativeAppBridge;
}

function previewIosImage(payload: string): boolean {
  try {
    const data = JSON.parse(payload || "{}") as NativeImagePreviewPayload;
    const images = Array.isArray(data.images) ? data.images : [];
    if (!images.length) return false;
    const index = Math.max(0, Math.min(data.index ?? 0, images.length - 1));
    const target = images[index];
    const url = absoluteImageUrl(target?.url || "");
    if (!url) return false;
    return openIosImagePreview(url);
  } catch {
    return false;
  }
}

function openIosImagePreview(url: string): boolean {
  const openDirectly = (): boolean => {
    const previewWindow = window.open(url, "_blank");
    if (previewWindow) return true;

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  };

  if (!url.startsWith("data:")) return openDirectly();

  try {
    const blob = dataUrlToBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    const opened: boolean = openIosImagePreview(objectUrl);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return opened;
  } catch {
    return openDirectly();
  }
}

function isAndroidNativePreviewFallback() {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return ua.includes("cpuwebscheduleapp") || params.get("client") === "android-app";
}

function isIosDevice() {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("iphone")
    || ua.includes("ipad")
    || ua.includes("ipod")
    || (ua.includes("macintosh") && navigator.maxTouchPoints > 1);
}

async function shareIosImageUrl(src: string, fileName: string) {
  const url = absoluteImageUrl(src);
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error("download_failed");
    const blob = await response.blob();
    return await shareIosImageBlob(blob, fileNameFromUrl(fileName || url, fileName));
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
    return false;
  }
}

async function shareIosImageDataUrl(dataUrl: string, fileName: string) {
  try {
    const blob = dataUrlToBlob(dataUrl);
    return await shareIosImageBlob(blob, fileName);
  } catch {
    window.open(dataUrl, "_blank", "noopener,noreferrer");
    return false;
  }
}

async function shareIosImageBlob(blob: Blob, fileName: string) {
  const safeName = normalizeImageFileName(fileName, blob.type);
  const file = new File([blob], safeName, { type: blob.type || mimeTypeFromFileName(safeName) });
  const shareData = { files: [file], title: safeName };
  try {
    if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(shareData))) {
      await navigator.share(shareData);
      return true;
    }
  } catch (error: any) {
    if (error?.name === "AbortError") return true;
  }

  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  return false;
}

function dataUrlToBlob(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl || "");
  if (!match) throw new Error("invalid_data_url");
  const mimeType = match[1] || "image/png";
  const body = match[3] || "";
  if (match[2]) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }
  return new Blob([decodeURIComponent(body)], { type: mimeType });
}

function normalizeImageFileName(fileName: string, mimeType = "") {
  let raw = (fileName || "image").trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!/\.(png|jpe?g|webp|gif)$/i.test(raw)) {
    raw += extensionFromMimeType(mimeType);
  }
  return raw;
}

function extensionFromMimeType(mimeType = "") {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  return ".png";
}

function mimeTypeFromFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/png";
}
