import PhotoSwipe from "photoswipe";
import type { SlideData } from "photoswipe";

export type ImageViewerItem = {
  src: string;
  title?: string;
  alt?: string;
  fileName?: string;
  width?: number;
  height?: number;
  thumbnail?: HTMLImageElement | null;
};

export type ImageViewerContext = {
  src: string;
  title: string;
  fileName: string;
};

export type SharedImageViewerOptions = {
  className?: string;
  url?: (image: HTMLImageElement) => string;
  filter?: (image: HTMLImageElement) => boolean;
  title?: (image: HTMLImageElement) => string;
  loop?: boolean;
  onDownload?: (context: ImageViewerContext) => void | Promise<void>;
  onViewed?: (context: ImageViewerContext) => void;
  onHidden?: () => void;
};

export type SharedImageViewer = {
  view: (index?: number) => void;
  destroy: () => void;
};

type PreparedSlide = SlideData & ImageViewerContext;

let activeViewer: PhotoSwipe | null = null;
let openSequence = 0;

export function createSharedImageViewer(element: HTMLElement, options: SharedImageViewerOptions = {}): SharedImageViewer {
  let destroyed = false;
  return {
    view(index = 0) {
      if (destroyed) return;
      const resolveUrl = options.url ?? defaultImageUrl;
      const resolveTitle = options.title ?? defaultImageTitle;
      const items = Array.from(element.querySelectorAll<HTMLImageElement>("img"))
        .filter((image) => options.filter ? options.filter(image) : Boolean(resolveUrl(image)))
        .map((image) => ({
          src: resolveUrl(image),
          title: resolveTitle(image),
          alt: image.alt,
          fileName: image.dataset.viewerFileName || fileNameFromImageUrl(resolveUrl(image)),
          width: image.naturalWidth || undefined,
          height: image.naturalHeight || undefined,
          thumbnail: image,
        }));
      openImageGallery(items, index, options);
    },
    destroy() {
      destroyed = true;
      destroyStandaloneViewer();
    },
  };
}

export function openImageGallery(
  items: ImageViewerItem[],
  startIndex = 0,
  options: Omit<SharedImageViewerOptions, "url" | "filter" | "title"> = {},
) {
  if (typeof document === "undefined") return false;
  const normalized = items
    .map((item) => ({
      src: String(item.src || "").trim(),
      title: String(item.title || item.alt || item.fileName || "").trim(),
      alt: String(item.alt || item.title || "").trim(),
      fileName: String(item.fileName || "").trim(),
      width: positiveNumber(item.width),
      height: positiveNumber(item.height),
      thumbnail: item.thumbnail || null,
    }))
    .filter((item) => item.src);
  if (!normalized.length) return false;

  const sequence = ++openSequence;
  activeViewer?.close();
  void prepareSlides(normalized).then((slides) => {
    if (sequence !== openSequence || !slides.length) return;
    const selectedIndex = Math.max(0, Math.min(startIndex, slides.length - 1));
    const viewer = new PhotoSwipe({
      dataSource: slides,
      index: selectedIndex,
      mainClass: ["cpu-image-viewer", options.className].filter(Boolean).join(" "),
      bgOpacity: 0.94,
      loop: options.loop ?? slides.length > 1,
      wheelToZoom: true,
      pinchToClose: true,
      closeOnVerticalDrag: true,
      clickToCloseNonZoomable: false,
      tapAction: "toggle-controls",
      doubleTapAction: "zoom",
      preload: [1, 2],
      closeTitle: "关闭",
      zoomTitle: "切换缩放",
      arrowPrevTitle: "上一张",
      arrowNextTitle: "下一张",
      zoom: false,
      close: false,
      arrowPrevSVG: "",
      arrowNextSVG: "",
      paddingFn: () => ({
        top: window.innerWidth <= 640 ? 68 : 82,
        right: window.innerWidth <= 640 ? 8 : 24,
        bottom: 72,
        left: window.innerWidth <= 640 ? 8 : 24,
      }),
      errorMsg: "图片加载失败，请稍后重试",
    });

    viewer.on("uiRegister", () => registerViewerUi(viewer, options));
    viewer.on("change", () => {
      const context = currentContext(viewer);
      if (context) options.onViewed?.(context);
    });
    viewer.on("destroy", () => {
      if (activeViewer === viewer) activeViewer = null;
      options.onHidden?.();
    });
    activeViewer = viewer;
    viewer.init();
    const context = currentContext(viewer);
    if (context) options.onViewed?.(context);
  });
  return true;
}

export function destroyStandaloneViewer() {
  openSequence += 1;
  activeViewer?.close();
  activeViewer = null;
}

function registerViewerUi(viewer: PhotoSwipe, options: Omit<SharedImageViewerOptions, "url" | "filter" | "title">) {
  viewer.ui?.registerElement({
    name: "download",
    order: 8,
    isButton: true,
    title: "下载图片",
    ariaLabel: "下载图片",
    html: "",
    onInit: (element) => {
      element.textContent = "下载";
    },
    onClick: () => {
      const context = currentContext(viewer);
      if (!context) return;
      if (options.onDownload) void options.onDownload(context);
      else void downloadViewerImage(context);
    },
  });

  viewer.ui?.registerElement({
    name: "viewer-zoom",
    order: 10,
    isButton: true,
    title: "切换缩放",
    ariaLabel: "切换缩放",
    html: "",
    onInit: (element) => {
      element.textContent = "缩放";
    },
    onClick: () => viewer.toggleZoom(),
  });

  viewer.ui?.registerElement({
    name: "viewer-close",
    order: 20,
    isButton: true,
    title: "关闭",
    ariaLabel: "关闭",
    html: "",
    onInit: (element) => {
      element.textContent = "关闭";
    },
    onClick: () => viewer.close(),
  });

  viewer.ui?.registerElement({
    name: "zoom-level",
    order: 9,
    onInit: (element, pswp) => {
      const update = () => {
        const zoom = pswp.currSlide?.currZoomLevel;
        element.textContent = zoom ? `${Math.round(zoom * 100)}%` : "";
      };
      pswp.on("change", update);
      pswp.on("zoomPanUpdate", ({ slide }) => {
        if (slide === pswp.currSlide) update();
      });
      update();
    },
  });

  viewer.ui?.registerElement({
    name: "caption",
    order: 9,
    appendTo: "root",
    onInit: (element, pswp) => {
      const update = () => {
        const data = pswp.currSlide?.data as PreparedSlide | undefined;
        element.textContent = data?.title || "";
        element.hidden = !data?.title;
      };
      pswp.on("change", update);
      update();
    },
  });
}

async function prepareSlides(items: ImageViewerItem[]): Promise<PreparedSlide[]> {
  return Promise.all(items.map(async (item) => {
    const measured = item.width && item.height
      ? { width: item.width, height: item.height }
      : item.thumbnail?.naturalWidth && item.thumbnail?.naturalHeight
        ? { width: item.thumbnail.naturalWidth, height: item.thumbnail.naturalHeight }
        : await measureImage(item.src);
    const title = item.title || item.alt || fileNameFromImageUrl(item.src);
    return {
      src: item.src,
      width: measured.width,
      height: measured.height,
      msrc: item.thumbnail?.currentSrc || item.thumbnail?.src,
      element: item.thumbnail || undefined,
      alt: item.alt || title,
      title,
      fileName: item.fileName || fileNameFromImageUrl(item.src),
    };
  }));
}

function measureImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (width = 1600, height = 1200) => {
      if (settled) return;
      settled = true;
      resolve({ width, height });
    };
    const timeout = window.setTimeout(() => finish(), 4_000);
    image.onload = () => {
      window.clearTimeout(timeout);
      finish(image.naturalWidth || 1600, image.naturalHeight || 1200);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      finish();
    };
    image.src = src;
  });
}

function currentContext(viewer: PhotoSwipe): ImageViewerContext | null {
  const data = viewer.currSlide?.data as PreparedSlide | undefined;
  if (!data?.src) return null;
  return { src: data.src, title: data.title || "", fileName: data.fileName || fileNameFromImageUrl(data.src) };
}

function positiveNumber(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : undefined;
}

function defaultImageUrl(image: HTMLImageElement) {
  return image.dataset.original || image.currentSrc || image.getAttribute("src") || image.src || "";
}

function defaultImageTitle(image: HTMLImageElement) {
  return image.dataset.viewerTitle || image.alt || fileNameFromImageUrl(defaultImageUrl(image));
}

function fileNameFromImageUrl(src: string) {
  if (src.startsWith("data:")) return "image.png";
  try {
    const url = new URL(src, window.location.origin);
    const fileName = decodeURIComponent(url.pathname.split("/").pop() || "");
    if (fileName) return fileName;
  } catch {
    /* keep fallback */
  }
  return "image.png";
}

async function downloadViewerImage(context: ImageViewerContext) {
  try {
    const response = await fetch(context.src, { cache: "force-cache" });
    if (!response.ok) throw new Error("download_failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerDownload(objectUrl, normalizeFileName(context.fileName, blob.type));
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  } catch {
    triggerDownload(context.src, context.fileName || "image.png", true);
  }
}

function triggerDownload(href: string, fileName: string, openInNewTab = false) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  if (openInNewTab) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function normalizeFileName(fileName: string, mimeType: string) {
  const safe = String(fileName || "image").replace(/[\\/:*?"<>|]+/g, "-").trim() || "image";
  if (/\.[a-z0-9]{2,8}$/i.test(safe)) return safe;
  const extension = mimeType === "image/jpeg" ? ".jpg"
    : mimeType === "image/webp" ? ".webp"
      : mimeType === "image/gif" ? ".gif"
        : ".png";
  return `${safe}${extension}`;
}
