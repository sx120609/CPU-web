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
    return showIosImagePreview(images, index);
  } catch {
    return false;
  }
}

function showIosImagePreview(items: NativeImagePreviewItem[], startIndex: number): boolean {
  const images = items
    .map((item) => ({
      url: absoluteImageUrl(item.url),
      title: item.title || item.fileName || fileNameFromUrl(item.url),
      fileName: item.fileName || fileNameFromUrl(item.url),
    }))
    .filter((item) => item.url);
  if (!images.length) return false;

  let index = Math.max(0, Math.min(startIndex, images.length - 1));
  let touchStartX = 0;
  let touchStartY = 0;

  const existing = document.querySelector<HTMLElement>("[data-ios-image-preview]");
  existing?.remove();

  const overlay = document.createElement("div");
  overlay.dataset.iosImagePreview = "1";
  overlay.innerHTML = `
    <div class="ios-preview-top">
      <button class="ios-preview-button" type="button" data-action="close" aria-label="Close">Close</button>
      <div class="ios-preview-count"></div>
      <button class="ios-preview-button" type="button" data-action="save" aria-label="Save">Save</button>
    </div>
    <button class="ios-preview-nav ios-preview-prev" type="button" data-action="prev" aria-label="Previous">‹</button>
    <img class="ios-preview-image" alt="" />
    <button class="ios-preview-nav ios-preview-next" type="button" data-action="next" aria-label="Next">›</button>
    <div class="ios-preview-title"></div>
  `;
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.94);
    color: #fff;
    -webkit-user-select: none;
    user-select: none;
    touch-action: none;
  `;

  const style = document.createElement("style");
  style.dataset.iosImagePreviewStyle = "1";
  style.textContent = `
    [data-ios-image-preview] .ios-preview-top {
      position: absolute;
      top: env(safe-area-inset-top, 0);
      left: 0;
      right: 0;
      display: grid;
      grid-template-columns: 80px 1fr 80px;
      align-items: center;
      min-height: 54px;
      padding: 8px 14px;
      background: linear-gradient(180deg, rgba(0,0,0,0.58), rgba(0,0,0,0));
    }
    [data-ios-image-preview] .ios-preview-button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      min-width: 58px;
      min-height: 36px;
      padding: 0 12px;
      background: rgba(255,255,255,0.16);
      color: #fff;
      font: 500 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    [data-ios-image-preview] .ios-preview-button[data-action="save"] {
      justify-self: end;
    }
    [data-ios-image-preview] .ios-preview-count {
      justify-self: center;
      color: rgba(255,255,255,0.82);
      font: 500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    [data-ios-image-preview] .ios-preview-image {
      max-width: 100vw;
      max-height: 100vh;
      object-fit: contain;
      transform: translateZ(0);
      -webkit-user-drag: none;
    }
    [data-ios-image-preview] .ios-preview-title {
      position: absolute;
      left: 18px;
      right: 18px;
      bottom: calc(env(safe-area-inset-bottom, 0) + 18px);
      overflow: hidden;
      color: rgba(255,255,255,0.76);
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [data-ios-image-preview] .ios-preview-nav {
      appearance: none;
      position: absolute;
      top: 50%;
      width: 42px;
      height: 56px;
      margin-top: -28px;
      border: 0;
      border-radius: 999px;
      background: rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.86);
      font: 34px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    [data-ios-image-preview] .ios-preview-prev { left: 12px; }
    [data-ios-image-preview] .ios-preview-next { right: 12px; }
    [data-ios-image-preview] .ios-preview-nav[hidden] { display: none; }
  `;

  const image = overlay.querySelector<HTMLImageElement>(".ios-preview-image");
  const count = overlay.querySelector<HTMLElement>(".ios-preview-count");
  const title = overlay.querySelector<HTMLElement>(".ios-preview-title");
  const prev = overlay.querySelector<HTMLButtonElement>(".ios-preview-prev");
  const next = overlay.querySelector<HTMLButtonElement>(".ios-preview-next");
  if (!image || !count || !title || !prev || !next) return false;

  const close = () => {
    document.body.style.overflow = overlay.dataset.previousBodyOverflow || "";
    window.removeEventListener("keydown", onKeyDown);
    overlay.remove();
    style.remove();
  };

  const render = () => {
    const current = images[index];
    image.src = current.url;
    image.alt = current.title;
    count.textContent = images.length > 1 ? `${index + 1} / ${images.length}` : "";
    title.textContent = current.title;
    prev.hidden = images.length < 2 || index <= 0;
    next.hidden = images.length < 2 || index >= images.length - 1;
  };

  const move = (delta: number) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= images.length) return;
    index = nextIndex;
    render();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft") move(-1);
    if (event.key === "ArrowRight") move(1);
  };

  overlay.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).dataset.action;
    if (action === "close") close();
    if (action === "prev") move(-1);
    if (action === "next") move(1);
    if (action === "save") void shareIosImageUrl(images[index].url, images[index].fileName);
  });
  overlay.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });
  overlay.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
    move(deltaX > 0 ? -1 : 1);
  }, { passive: true });

  overlay.dataset.previousBodyOverflow = document.body.style.overflow;
  document.head.appendChild(style);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  window.addEventListener("keydown", onKeyDown);
  render();
  return true;
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
