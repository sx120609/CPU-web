<template>
  <div class="md" :class="{ 'md-clickable-images': clickableImages }" ref="el" v-html="html"></div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch, onBeforeUnmount } from "vue";
import Viewer from "viewerjs";
import "viewerjs/dist/viewer.css";
import { renderMarkdown } from "@/utils/markdown";

const props = withDefaults(defineProps<{
  content: string;
  clickableImages?: boolean;
}>(), {
  clickableImages: false,
});
const html = computed(() => renderMarkdown(props.content));
const el = ref<HTMLElement | null>(null);
const viewerImageUrl = ref("");
let imageViewer: Viewer | null = null;

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
  const images = el.value.querySelectorAll<HTMLImageElement>("img");
  destroyImageViewer();
  images.forEach((img, index) => {
    if (props.clickableImages) {
      img.dataset.previewBound = "1";
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", "点击查看图片");
      img.onkeydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          imageViewer?.view(index);
        }
      };
    } else {
      img.removeAttribute("data-preview-bound");
      img.removeAttribute("tabindex");
      img.removeAttribute("role");
      img.removeAttribute("aria-label");
      img.onkeydown = null;
    }
  });

  if (!props.clickableImages || !images.length) return;
  const hasManyImages = images.length > 1;
  imageViewer = new Viewer(el.value, {
    className: "cpu-markdown-viewer",
    url: (image: HTMLImageElement) => getViewerImageUrl(image),
    filter: (image: HTMLImageElement) => Boolean(image.src),
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
    viewed: (event: CustomEvent) => {
      const originalImage = (event.detail as { originalImage?: HTMLImageElement }).originalImage;
      viewerImageUrl.value = originalImage ? getViewerImageUrl(originalImage) : "";
    },
    hidden: () => {
      viewerImageUrl.value = "";
    },
  });
}

function destroyImageViewer() {
  if (!imageViewer) return;
  imageViewer.destroy();
  imageViewer = null;
  viewerImageUrl.value = "";
}

function getViewerImageUrl(image: HTMLImageElement) {
  return image.dataset.original || image.currentSrc || image.src;
}

async function saveViewerImage() {
  if (!viewerImageUrl.value) return;
  try {
    const response = await fetch(viewerImageUrl.value);
    if (!response.ok) throw new Error("download_failed");
    const blob = await response.blob();
    if (typeof (window as any).CPUAndroid?.saveImage === "function") {
      const dataUrl = await blobToDataUrl(blob);
      const ok = (window as any).CPUAndroid.saveImage(dataUrl, previewFileName(viewerImageUrl.value, blob.type));
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
onMounted(() => nextTick(bindImageViewer));
onBeforeUnmount(() => {
  destroyImageViewer();
});
watch(html, () => nextTick(() => {
  wrapTables();
  bindImageViewer();
}));
watch(() => props.clickableImages, () => nextTick(bindImageViewer));
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
.md :deep(img) {
  max-width: min(100%, 220px);
  max-height: 180px;
  border-radius: 8px;
  margin: 8px 0;
  object-fit: cover;
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
.md :deep(img[data-align="left"]) { display: block; margin-left: 0; margin-right: auto; }
.md :deep(img[data-align="center"]) { display: block; margin-left: auto; margin-right: auto; }
.md :deep(img[data-align="right"]) { display: block; margin-left: auto; margin-right: 0; }

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
  content: "存";
  display: block;
  width: 20px;
  height: 20px;
  margin: 5px;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
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
