export type NativeAppBridge = {
  getVersionCode?: () => number;
  getVersionName?: () => string;
  supportsScheduleWidget?: () => boolean;
  supportsInAppApkDownload?: () => boolean;
  previewImages?: (payload: string) => boolean;
  copyText?: (text: string) => boolean;
  openExternalUrl?: (url: string) => void;
  downloadAndInstallApk?: (url: string, fileName?: string) => boolean;
  saveImage?: (dataUrl: string, fileName?: string) => boolean;
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
  return ((window as any).CPUHarmony ?? (window as any).CPUAndroid ?? null) as NativeAppBridge | null;
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

function isAndroidNativePreviewFallback() {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  return ua.includes("cpuwebscheduleapp") || params.get("client") === "android-app";
}
