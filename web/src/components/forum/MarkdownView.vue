<template>
  <div class="md" :class="{ 'md-clickable-images': clickableImages }" ref="el" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch, onBeforeUnmount } from "vue";
import Artplayer from "artplayer";
import Viewer from "viewerjs";
import "viewerjs/dist/viewer.css";
import { renderMarkdown } from "@/utils/markdown";
import { fileNameFromUrl, getNativeBridge, hasNativeImagePreviewBridge, previewNativeImages } from "@/utils/nativeBridge";

const props = withDefaults(defineProps<{
  content: string;
  clickableImages?: boolean;
}>(), {
  clickableImages: false,
});
const renderedHtml = computed(() => enhanceRenderedHtml(renderMarkdown(props.content)));
const el = ref<HTMLElement | null>(null);
const viewerImageUrl = ref("");
let imageViewer: Viewer | null = null;
let videoPlayers: Artplayer[] = [];

function wrapTables() {
  if (!el.value) return;
  const tables = el.value.querySelectorAll<HTMLTableElement>("table:not([data-wrapped])");
  tables.forEach((t) => {
    const parent = t.parentNode;
    if (!parent) return;
    const wrap = document.createElement("div");
    wrap.className = "md-table-wrap";
    parent.insertBefore(wrap, t);
    wrap.appendChild(t);
    t.setAttribute("data-wrapped", "1");
  });
}

function bindImageViewer() {
  if (!el.value) return;
  wrapImageAlbums();
  const images = Array.from(el.value.querySelectorAll<HTMLImageElement>("img"));
  destroyImageViewer();
  images.forEach((img, index) => {
    primeImageElement(img);
    decorateImageElement(img);
    if (props.clickableImages) {
      img.dataset.previewBound = "1";
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", "点击查看图片");
      img.onclick = () => {
        openImagePreview(index);
      };
      img.onkeydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openImagePreview(index);
        }
      };
    } else {
      img.removeAttribute("data-preview-bound");
      img.removeAttribute("tabindex");
      img.removeAttribute("role");
      img.removeAttribute("aria-label");
      img.onclick = null;
      img.onkeydown = null;
    }
  });

  if (!props.clickableImages || !images.length) return;
}

function bindVideoPlayers() {
  if (!el.value) return;
  destroyVideoPlayers();
  const videos = Array.from(el.value.querySelectorAll<HTMLVideoElement>("video"))
    .filter((video) => !video.closest(".art-video-player") && !video.closest(".md-video-shell"));
  videos.forEach((video, index) => {
    const src = getVideoSourceUrl(video);
    if (!src) return;
    const poster = String(video.getAttribute("poster") || "").trim();
    const fallbackVideo = video.cloneNode(true) as HTMLVideoElement;
    fallbackVideo.controls = true;
    fallbackVideo.preload = "metadata";
    fallbackVideo.playsInline = true;
    fallbackVideo.classList.add("qq-inline-video-fallback");

    const shell = document.createElement("div");
    shell.className = "md-video-shell";
    const playerMount = document.createElement("div");
    playerMount.className = "md-video-player";
    shell.appendChild(playerMount);
    bindVideoLayout(fallbackVideo, shell);
    bindVideoLayout(video, shell);

    const linkBlock = video.nextElementSibling instanceof HTMLParagraphElement
      && video.nextElementSibling.querySelector(".qq-inline-video__link")
      ? video.nextElementSibling
      : null;

    video.replaceWith(shell);
    linkBlock?.remove();

    try {
      const player = new Artplayer({
        container: playerMount,
        url: src,
        theme: "#168776",
        volume: 0.8,
        autoplay: false,
        autoSize: true,
        playbackRate: true,
        aspectRatio: true,
        setting: true,
        pip: true,
        mutex: true,
        backdrop: true,
        fullscreen: true,
        fullscreenWeb: true,
        miniProgressBar: true,
        playsInline: true,
        airplay: true,
        moreVideoAttr: {
          preload: "metadata",
          playsInline: true,
        },
        ...(poster ? { poster } : {}),
      });
      player.on("ready", () => {
        player.autoSize();
        bindVideoLayout(player.video, shell);
      });
      player.on("video:loadedmetadata", () => {
        bindVideoLayout(player.video, shell);
      });
      videoPlayers.push(player);
      shell.dataset.playerIndex = String(index);
    } catch (error) {
      console.warn("[markdown-video] artplayer init failed", error);
      shell.classList.add("is-fallback");
      playerMount.replaceWith(fallbackVideo);
    }
  });
}

function getVideoSourceUrl(video: HTMLVideoElement) {
  const direct = video.getAttribute("src") || video.currentSrc || video.src;
  if (direct) return direct;
  const source = video.querySelector<HTMLSourceElement>("source[src]");
  return source?.getAttribute("src") || source?.src || "";
}

function bindVideoLayout(video: HTMLVideoElement, shell: HTMLDivElement) {
  const apply = () => {
    if (!video.videoWidth || !video.videoHeight) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    const ratio = width / height;
    shell.style.setProperty("--md-video-aspect-ratio", `${width} / ${height}`);
    const isPortrait = ratio < 0.95;
    shell.dataset.videoOrientation = isPortrait ? "portrait" : "landscape";
    const maxWidth = isPortrait
      ? Math.min(460, Math.max(320, Math.round(720 * ratio)))
      : 720;
    shell.style.setProperty("--md-video-max-width", `${maxWidth}px`);
  };
  if (video.readyState >= 1) {
    apply();
    return;
  }
  video.addEventListener("loadedmetadata", apply, { once: true });
}

function wrapImageAlbums() {
  if (!el.value) return;
  mergeConsecutiveImageBlocks(el.value);
  normalizeAlbumBlocks(el.value);
}

function mergeConsecutiveImageBlocks(root: HTMLElement) {
  const children = Array.from(root.children);
  let run: HTMLElement[] = [];
  const flush = () => {
    if (run.length >= 2) createAlbumFromBlocks(run);
    run = [];
  };
  children.forEach((child) => {
    if (!(child instanceof HTMLElement)) {
      flush();
      return;
    }
    if (child.dataset.imageAlbum === "1") {
      flush();
      return;
    }
    if (isStandaloneImageBlock(child)) {
      run.push(child);
      return;
    }
    flush();
  });
  flush();
}

function isStandaloneImageBlock(block: HTMLElement) {
  const directElements = Array.from(block.children);
  if (!directElements.length) return false;
  const imageLike = directElements.filter((child) => (
    child instanceof HTMLImageElement || child.classList.contains("md-image-shell")
  ));
  if (!imageLike.length || imageLike.length !== directElements.length) return false;
  return Array.from(block.childNodes).every((node) => {
    if (node instanceof HTMLElement) {
      return node instanceof HTMLImageElement || node.classList.contains("md-image-shell") || node instanceof HTMLBRElement;
    }
    return !(node.textContent ?? "").replace(/\u00a0/g, " ").trim();
  });
}

function createAlbumFromBlocks(blocks: HTMLElement[]) {
  const first = blocks[0];
  const parent = first?.parentElement;
  if (!first || !parent) return;
  const album = document.createElement("p");
  album.className = "md-image-album";
  album.dataset.imageAlbum = "1";
  const align = normalizeAlbumAlign(blocks);
  if (align) album.dataset.align = align;
  parent.insertBefore(album, first);
  blocks.forEach((block) => {
    Array.from(block.children).forEach((child) => {
      if (child instanceof HTMLImageElement || child.classList.contains("md-image-shell")) {
        album.appendChild(child);
      }
    });
    block.remove();
  });
  syncAlbumCount(album);
}

function normalizeAlbumBlocks(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-image-album='1']").forEach((album) => {
    album.classList.add("md-image-album");
    const align = album.dataset.align;
    if (!align || !["left", "center", "right"].includes(align)) {
      const normalized = normalizeAlbumAlign(Array.from(album.children).filter((child): child is HTMLElement => child instanceof HTMLElement));
      if (normalized) album.dataset.align = normalized;
      else album.removeAttribute("data-align");
    }
    syncAlbumCount(album);
  });
}

function normalizeAlbumAlign(nodes: HTMLElement[]) {
  for (const node of nodes) {
    const direct = node.dataset.align;
    if (direct === "left" || direct === "center" || direct === "right") return direct;
    const nested = node.querySelector<HTMLElement>("[data-align]")?.dataset.align;
    if (nested === "left" || nested === "center" || nested === "right") return nested;
  }
  return "";
}

function syncAlbumCount(album: HTMLElement) {
  const count = Array.from(album.children).filter((child) => (
    child instanceof HTMLImageElement || (child instanceof HTMLElement && child.classList.contains("md-image-shell"))
  )).length;
  album.dataset.imageCount = String(count || 0);
}

function enhanceRenderedHtml(raw: string) {
  if (!raw || typeof document === "undefined") return raw;
  const container = document.createElement("div");
  container.innerHTML = raw;
  container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    primeImageElement(img);
  });
  return container.innerHTML;
}

function primeImageElement(img: HTMLImageElement) {
  img.loading = "lazy";
  img.decoding = "async";
  img.setAttribute("fetchpriority", "low");
  const rawSrc = img.getAttribute("src") || img.dataset.original || img.currentSrc || img.src;
  if (rawSrc) img.dataset.original = rawSrc;
}

function decorateImageElement(img: HTMLImageElement) {
  const shell = ensureImageShell(img);
  syncImageShellMetrics(img, shell);
  if (img.dataset.loadBound === "1") {
    syncImageLoadState(img, shell);
    return;
  }
  const updateState = () => {
    syncImageShellMetrics(img, shell);
    syncImageLoadState(img, shell);
  };
  img.addEventListener("load", updateState);
  img.addEventListener("error", updateState);
  img.dataset.loadBound = "1";
  syncImageLoadState(img, shell);
}

function ensureImageShell(img: HTMLImageElement) {
  const existingShell = img.parentElement?.classList.contains("md-image-shell")
    ? img.parentElement as HTMLSpanElement
    : null;
  const shell = existingShell ?? document.createElement("span");
  if (!existingShell) {
    shell.className = "md-image-shell";
    const placeholder = document.createElement("span");
    placeholder.className = "md-image-shell__placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    const state = document.createElement("span");
    state.className = "md-image-shell__state";
    state.textContent = "图片加载失败";
    state.setAttribute("aria-hidden", "true");
    const parent = img.parentNode;
    if (!parent) return shell;
    parent.insertBefore(shell, img);
    shell.appendChild(placeholder);
    shell.appendChild(state);
    shell.appendChild(img);
  }
  const align = img.dataset.align || "";
  const size = img.dataset.size || "";
  if (align) shell.setAttribute("data-align", align);
  else shell.removeAttribute("data-align");
  if (size) shell.setAttribute("data-size", size);
  else shell.removeAttribute("data-size");
  return shell;
}

function syncImageShellMetrics(img: HTMLImageElement, shell: HTMLSpanElement) {
  const max = getImageMaxBounds(img);
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;
  if (!naturalWidth || !naturalHeight) {
    shell.style.setProperty("--md-image-target-width", `${max.width}px`);
    shell.style.setProperty("--md-image-aspect-ratio", `${max.width} / ${max.height}`);
    return;
  }
  const scale = Math.min(max.width / naturalWidth, max.height / naturalHeight, 1);
  const width = Math.max(48, Math.round(naturalWidth * scale));
  const height = Math.max(48, Math.round(naturalHeight * scale));
  shell.style.setProperty("--md-image-target-width", `${width}px`);
  shell.style.setProperty("--md-image-aspect-ratio", `${width} / ${height}`);
}

function syncImageLoadState(img: HTMLImageElement, shell: HTMLSpanElement) {
  const ready = img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  const failed = img.complete && !ready;
  shell.classList.toggle("is-ready", ready);
  shell.classList.toggle("is-loading", !ready && !failed);
  shell.classList.toggle("is-error", failed);
}

function getImageMaxBounds(img: HTMLImageElement) {
  if (img.dataset.size === "small") return { width: 180, height: 140 };
  if (img.dataset.size === "medium") return { width: 220, height: 180 };
  return { width: 220, height: 180 };
}

function openImagePreview(index: number) {
  if (tryOpenNativePreview(index)) return;
  ensureImageViewer();
  imageViewer?.view(index);
}

function ensureImageViewer() {
  if (!el.value || imageViewer || !props.clickableImages || hasNativeImagePreviewBridge()) return;
  const images = Array.from(el.value.querySelectorAll<HTMLImageElement>("img"));
  if (!images.length) return;
  const hasManyImages = images.length > 1;
  imageViewer = new Viewer(el.value, {
    className: "cpu-markdown-viewer",
    url: (image: HTMLImageElement) => getViewerImageUrl(image),
    filter: (image: HTMLImageElement) => Boolean(getViewerImageUrl(image)),
    title: [1, (image: HTMLImageElement) => image.alt || previewFileName(getViewerImageUrl(image))],
    navbar: hasManyImages ? true : 0,
    button: true,
    keyboard: true,
    loop: hasManyImages,
    movable: true,
    rotatable: true,
    scalable: true,
    slideOnTouch: true,
    toggleOnDblclick: true,
    toolbar: {
      zoomIn: true,
      zoomOut: true,
      oneToOne: true,
      reset: true,
      prev: hasManyImages,
      next: hasManyImages,
      rotateLeft: true,
      rotateRight: true,
      flipHorizontal: true,
      flipVertical: true,
      download: {
        show: true,
        size: "large",
        click: () => { void saveViewerImage(); },
      },
    },
    tooltip: true,
    transition: true,
    zoomOnTouch: true,
    zoomOnWheel: true,
    ready: () => {
      annotateViewerToolbar();
    },
    viewed: (event: CustomEvent) => {
      const originalImage = (event.detail as { originalImage?: HTMLImageElement }).originalImage;
      viewerImageUrl.value = originalImage ? getViewerImageUrl(originalImage) : "";
      annotateViewerToolbar();
    },
    hidden: () => {
      viewerImageUrl.value = "";
    },
  });
}

function tryOpenNativePreview(index: number) {
  if (!el.value || !hasNativeImagePreviewBridge()) return false;
  const images = Array.from(el.value.querySelectorAll<HTMLImageElement>("img"))
    .map((image) => {
      const url = getViewerImageUrl(image);
      return {
        url,
        title: image.alt || fileNameFromUrl(url),
        fileName: fileNameFromUrl(url),
      };
    })
    .filter((image) => image.url);
  return previewNativeImages({ images, index });
}

function annotateViewerToolbar() {
  window.setTimeout(() => {
    const downloadButton = document.querySelector<HTMLElement>(".cpu-markdown-viewer .viewer-download");
    downloadButton?.setAttribute("title", "保存图片");
    downloadButton?.setAttribute("aria-label", "保存图片");
  }, 0);
}

function destroyImageViewer() {
  if (!imageViewer) return;
  imageViewer.destroy();
  imageViewer = null;
  viewerImageUrl.value = "";
}

function destroyVideoPlayers() {
  if (!videoPlayers.length) return;
  for (const player of videoPlayers) {
    try {
      player.destroy(false);
    } catch {
      // ignore player cleanup failure
    }
  }
  videoPlayers = [];
}

function getViewerImageUrl(image: HTMLImageElement) {
  return image.dataset.original || image.getAttribute("src") || image.currentSrc || image.src;
}

async function saveViewerImage() {
  if (!viewerImageUrl.value) return;
  try {
    const nativeBridge = getNativeBridge();
    if (typeof nativeBridge?.saveImageUrl === "function") {
      const ok = nativeBridge.saveImageUrl(viewerImageUrl.value, previewFileName(viewerImageUrl.value));
      if (ok !== false) return;
    }
    const response = await fetch(viewerImageUrl.value);
    if (!response.ok) throw new Error("download_failed");
    const blob = await response.blob();
    if (typeof nativeBridge?.saveImage === "function") {
      const dataUrl = await blobToDataUrl(blob);
      const ok = nativeBridge.saveImage(dataUrl, previewFileName(viewerImageUrl.value, blob.type));
      if (ok !== false) return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = previewFileName(viewerImageUrl.value, blob.type);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(viewerImageUrl.value, "_blank", "noopener,noreferrer");
  }
}

function previewFileName(src: string, mimeType = "") {
  try {
    const url = new URL(src, window.location.origin);
    const last = url.pathname.split("/").pop() || "image";
    if (/\.[a-z0-9]+$/i.test(last)) return last;
  } catch {
    /* ignore */
  }
  if (mimeType.includes("png")) return "image.png";
  if (mimeType.includes("webp")) return "image.webp";
  if (mimeType.includes("gif")) return "image.gif";
  return "image.jpg";
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

onMounted(wrapTables);
onMounted(() => nextTick(() => {
  bindVideoPlayers();
  bindImageViewer();
}));
onBeforeUnmount(() => {
  destroyImageViewer();
  destroyVideoPlayers();
});
watch(renderedHtml, () => nextTick(() => {
  wrapTables();
  bindVideoPlayers();
  bindImageViewer();
}));
watch(() => props.clickableImages, () => nextTick(() => {
  bindImageViewer();
}));
</script>

<style scoped>
.md {
  font-size: 15px;
  line-height: 1.75;
  color: #1f2937;
  word-break: break-word;
}
.md :deep(h1), .md :deep(h2), .md :deep(h3) {
  margin: 0.6em 0 0.4em;
  font-weight: 600;
}
.md :deep(h1) { font-size: 22px; }
.md :deep(h2) { font-size: 19px; }
.md :deep(h3) { font-size: 17px; }
.md :deep(p) { margin: 0.5em 0; }
.md :deep(.md-image-album) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: min(100%, 680px);
  margin: 12px 0;
}
.md :deep(.md-image-album[data-align="center"]) {
  margin-left: auto;
  margin-right: auto;
}
.md :deep(.md-image-album[data-align="right"]) {
  margin-left: auto;
  margin-right: 0;
}
.md :deep(.md-image-album[data-image-count="3"]) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: min(100%, 760px);
}
.md :deep(.md-image-album[data-image-count="4"]),
.md :deep(.md-image-album[data-image-count="5"]),
.md :deep(.md-image-album[data-image-count="6"]),
.md :deep(.md-image-album[data-image-count="7"]),
.md :deep(.md-image-album[data-image-count="8"]),
.md :deep(.md-image-album[data-image-count="9"]) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: min(100%, 760px);
}
.md :deep(ul), .md :deep(ol) { padding-left: 24px; margin: 0.5em 0; }
.md :deep(li) { margin: 0.2em 0; }
.md :deep(blockquote) {
  border-left: 3px solid var(--cpu-primary);
  background: #ecfdf5;
  padding: 6px 12px;
  color: #4b5563;
  margin: 0.6em 0;
}
.md :deep(code) {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: "Cascadia Mono", Consolas, Menlo, monospace;
}
.md :deep(pre) {
  background: #1e293b;
  color: #e2e8f0;
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
}
.md :deep(pre code) { background: transparent; padding: 0; color: inherit; }
.md :deep(a) { color: var(--cpu-primary); text-decoration: underline; }
.md :deep(.md-image-shell) {
  position: relative;
  display: inline-flex;
  width: min(100%, var(--md-image-target-width, 220px));
  max-width: 100%;
  aspect-ratio: var(--md-image-aspect-ratio, 11 / 9);
  margin: 8px 0;
  border-radius: 12px;
  overflow: hidden;
  vertical-align: top;
  background: #f8fafc;
}
.md :deep(.md-image-album > .md-image-shell) {
  display: flex;
  width: 100%;
  margin: 0;
  aspect-ratio: 1 / 1;
}
.md :deep(.md-image-shell[data-align="left"]) {
  display: flex;
  margin-left: 0;
  margin-right: auto;
}
.md :deep(.md-image-shell[data-align="center"]) {
  display: flex;
  margin-left: auto;
  margin-right: auto;
}
.md :deep(.md-image-shell[data-align="right"]) {
  display: flex;
  margin-left: auto;
  margin-right: 0;
}
.md :deep(.md-image-shell__placeholder),
.md :deep(.md-image-shell__state) {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.md :deep(.md-image-shell__placeholder) {
  background:
    linear-gradient(110deg, rgba(255, 255, 255, 0) 24%, rgba(255, 255, 255, 0.78) 48%, rgba(255, 255, 255, 0) 72%),
    linear-gradient(135deg, #eef2f7 0%, #e2e8f0 100%);
  background-size: 220% 100%, 100% 100%;
  animation: md-image-shimmer 1.15s linear infinite;
}
.md :deep(.md-image-shell__state) {
  display: none;
  align-items: center;
  justify-content: center;
  padding: 12px;
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
  background: rgba(248, 250, 252, 0.92);
}
.md :deep(.md-image-shell img) {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 8px;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.22s ease;
}
.md :deep(.md-image-album > .md-image-shell img) {
  border-radius: 12px;
}
.md :deep(.md-image-shell.is-ready img) {
  opacity: 1;
}
.md :deep(.md-image-shell.is-ready .md-image-shell__placeholder) {
  opacity: 0;
  transition: opacity 0.18s ease;
}
.md :deep(.md-image-shell.is-error .md-image-shell__placeholder) {
  animation: none;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2f7 100%);
}
.md :deep(.md-image-shell.is-error .md-image-shell__state) {
  display: flex;
}
.md :deep(video) {
  display: block;
  width: min(100%, 720px);
  max-width: 100%;
  margin: 12px 0;
  border-radius: 14px;
  background: #020617;
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.12);
}
.md :deep(.md-video-shell) {
  width: min(100%, var(--md-video-max-width, 720px));
  max-width: 100%;
  margin: 14px 0;
  border-radius: 18px;
}
.md :deep(.md-video-shell[data-video-orientation="portrait"]) {
  margin-left: auto;
  margin-right: auto;
}
.md :deep(.md-video-player) {
  width: 100%;
  aspect-ratio: var(--md-video-aspect-ratio, 16 / 9);
  min-height: 240px;
  overflow: hidden;
  border-radius: 18px;
  background:
    radial-gradient(circle at top, rgba(22, 135, 118, 0.14), transparent 48%),
    linear-gradient(180deg, #0f172a 0%, #020617 100%);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
}
.md :deep(.md-video-shell.is-fallback) {
  border-radius: 14px;
}
.md :deep(.md-video-shell[data-video-orientation="portrait"] .md-video-player) {
  min-height: 0;
}
.md :deep(.qq-inline-video-fallback) {
  width: 100%;
  margin: 0;
  border-radius: 18px;
}
.md :deep(.qq-inline-video__link) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 13px;
  color: #275df3;
}
.md-clickable-images :deep(img) {
  cursor: zoom-in;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.md-clickable-images :deep(img:hover) {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
}
.md :deep([data-align="left"]) { text-align: left; }
.md :deep([data-align="center"]) { text-align: center; }
.md :deep([data-align="right"]) { text-align: right; }
.md :deep(img[data-size="small"]),
.md :deep(img[data-size="medium"]),
.md :deep(img[data-size="large"]),
.md :deep(img:not([data-size])) {
  max-width: min(100%, 220px) !important;
  max-height: 180px !important;
}
.md :deep(.image-review-placeholder) {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  margin: 8px 0;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}
.md :deep(.image-review-placeholder-pending) {
  background: #fff7ed;
  border-color: #fed7aa;
  color: #9a3412;
}
.md :deep(.image-review-placeholder-rejected) {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
.md :deep(.video-review-placeholder) {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  margin: 10px 0;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}
.md :deep(.video-review-placeholder-pending) {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}
.md :deep(.video-review-placeholder-manual) {
  background: #fff7ed;
  border-color: #fed7aa;
  color: #c2410c;
}
.md :deep(.video-review-placeholder-rejected) {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}
.md :deep(.video-review-placeholder-error) {
  background: #fef2f2;
  border-color: #fca5a5;
  color: #991b1b;
}
.md :deep(.qq-share-card) {
  display: block;
  margin: 12px 0;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.02) 0%, rgba(22, 135, 118, 0.04) 100%);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
  text-decoration: none;
  color: inherit;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.md :deep(.qq-share-card--linked:hover) {
  transform: translateY(-1px);
  border-color: rgba(22, 135, 118, 0.24);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.08);
}
.md :deep(.qq-share-card__eyebrow) {
  display: inline-flex;
  align-items: center;
  margin-bottom: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(22, 135, 118, 0.08);
  color: var(--cpu-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.md :deep(.qq-share-card__title) {
  margin: 0;
  color: #111827;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
}
.md :deep(.qq-share-card__title-link) {
  color: inherit;
  text-decoration: none;
}
.md :deep(.qq-share-card__title-link:hover) {
  text-decoration: underline;
}
.md :deep(.qq-share-card__summary) {
  margin-top: 6px;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.65;
}
.md :deep(.qq-share-card__meta) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.md :deep(.qq-share-card__source),
.md :deep(.qq-share-card__host) {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 12px;
  line-height: 1;
}
.md :deep(.qq-share-card__source) {
  background: rgba(22, 135, 118, 0.1);
  color: var(--cpu-primary);
}
.md :deep(.qq-share-card__action) {
  margin-top: 12px;
}
.md :deep(.qq-share-card__action-link) {
  color: var(--cpu-primary);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}
.md :deep(.qq-share-card__action-link:hover) {
  text-decoration: underline;
}
.md :deep(.qq-share-card__action-link::after) {
  content: " ↗";
}

.md :deep(.qq-forward-card) {
  display: block;
  margin: 12px 0;
  padding: 12px;
  border: 1px solid #dbe6f1;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%);
}

.md :deep(.qq-forward-card[data-forward-depth="1"]) {
  margin-left: 12px;
  border-left: 4px solid rgba(22, 135, 118, 0.22);
}

.md :deep(.qq-forward-card[data-forward-depth="2"]),
.md :deep(.qq-forward-card[data-forward-depth="3"]),
.md :deep(.qq-forward-card[data-forward-depth="4"]) {
  margin-left: 18px;
  border-left: 4px solid rgba(15, 118, 110, 0.28);
  background: linear-gradient(180deg, rgba(250, 253, 252, 0.98) 0%, rgba(244, 248, 246, 0.98) 100%);
}

.md :deep(.qq-forward-card__head) {
  display: flex;
  align-items: center;
  gap: 8px;
}

.md :deep(.qq-forward-card__badge) {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 8px;
  background: rgba(22, 135, 118, 0.08);
  color: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
}

.md :deep(.qq-forward-card__body) {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.md :deep(.qq-forward-entry) {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #e7edf4;
}

.md :deep(.qq-forward-entry__head) {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.md :deep(.qq-forward-entry__name) {
  color: #111827;
  font-size: 13px;
  font-weight: 700;
}

.md :deep(.qq-forward-entry__content > p:first-child) {
  margin-top: 0;
}

.md :deep(.qq-forward-entry__content > p:last-child) {
  margin-bottom: 0;
}

.md :deep(.qq-forward-placeholder) {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 12px;
}

.md :deep(.qq-forward-album) {
  margin: 8px 0;
}

.md :deep(.qq-forward-nest) {
  position: relative;
  margin-top: 10px;
  padding-left: 14px;
}

.md :deep(.qq-forward-nest::before) {
  content: "";
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(22, 135, 118, 0.28) 0%, rgba(22, 135, 118, 0.12) 100%);
}

@media (max-width: 700px) {
  .md :deep(.md-image-album),
  .md :deep(.md-image-album[data-image-count="3"]),
  .md :deep(.md-image-album[data-image-count="4"]),
  .md :deep(.md-image-album[data-image-count="5"]),
  .md :deep(.md-image-album[data-image-count="6"]),
  .md :deep(.md-image-album[data-image-count="7"]),
  .md :deep(.md-image-album[data-image-count="8"]),
  .md :deep(.md-image-album[data-image-count="9"]) {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .md :deep(.md-image-album > .md-image-shell) {
    border-radius: 10px;
  }

  .md :deep(.md-image-album > .md-image-shell img) {
    border-radius: 10px;
  }

  .md :deep(video) {
    width: 100%;
    border-radius: 12px;
  }

  .md :deep(.md-video-shell),
  .md :deep(.md-video-player) {
    border-radius: 14px;
  }

  .md :deep(.md-video-player) {
    min-height: 180px;
  }

  .md :deep(.qq-forward-card) {
    padding: 12px;
    border-radius: 16px;
  }

  .md :deep(.qq-forward-card[data-forward-depth="1"]),
  .md :deep(.qq-forward-card[data-forward-depth="2"]),
  .md :deep(.qq-forward-card[data-forward-depth="3"]),
  .md :deep(.qq-forward-card[data-forward-depth="4"]) {
    margin-left: 8px;
  }

  .md :deep(.qq-forward-entry) {
    padding: 10px;
    border-radius: 12px;
  }

  .md :deep(.qq-forward-nest) {
    padding-left: 10px;
  }
}

@keyframes md-image-shimmer {
  0% {
    background-position: 200% 0, 0 0;
  }
  100% {
    background-position: -20% 0, 0 0;
  }
}

/* 表格容器（由 JS 自动包装）：只在表格超宽时才出现水平滚动条 */
.md :deep(.md-table-wrap) {
  margin: 0.8em 0;
  overflow-x: auto;
  max-width: 100%;
}
.md :deep(table) {
  border-collapse: collapse;
  font-size: 13px;
  /* 不设固定 width，让 table 按内容自适应 */
}
.md :deep(th), .md :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 6px 10px;
  vertical-align: top;
  line-height: 1.5;
}
.md :deep(th) { background: #f9fafb; font-weight: 600; }
.md :deep(tr:nth-child(even)) td { background: #fafbfc; }
.md :deep(caption) {
  caption-side: top;
  font-weight: 600;
  padding: 4px 0;
  color: #4b5563;
  text-align: left;
}
.md :deep(sub), .md :deep(sup) { font-size: 0.75em; }

:global(.cpu-markdown-viewer.viewer-container) {
  z-index: 3000;
}

:global(.cpu-markdown-viewer .viewer-canvas) {
  background: rgba(15, 23, 42, 0.84);
}

:global(.cpu-markdown-viewer .viewer-toolbar > ul) {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  max-width: calc(100vw - 20px);
  gap: 4px;
  padding: 6px;
}

:global(.cpu-markdown-viewer .viewer-toolbar > ul > li) {
  float: none;
  margin: 0;
}

:global(.cpu-markdown-viewer .viewer-download::before) {
  content: "";
  display: block;
  width: 20px;
  height: 20px;
  margin: 5px;
  background-color: #fff;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3v12'/%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3Cpath d='M5 21h14'/%3E%3C/svg%3E") center / 20px 20px no-repeat;
}

:global(.cpu-markdown-viewer .viewer-title) {
  max-width: min(760px, 90vw);
  color: #f9fafb;
  font-size: 13px;
}

@media (max-width: 640px) {
  :global(.cpu-markdown-viewer .viewer-toolbar) {
    bottom: 10px;
  }

  :global(.cpu-markdown-viewer .viewer-navbar) {
    display: none;
  }
}
</style>
