<template>
  <div class="md" :class="{ 'md-clickable-images': clickableImages }" ref="el" v-html="html"></div>
  <teleport to="body">
    <div
      v-if="previewOpen"
      class="md-image-preview"
      tabindex="-1"
      @click.self="closePreview"
      @wheel.prevent="handlePreviewWheel"
    >
      <button type="button" class="preview-close" aria-label="关闭图片预览" @click="closePreview">×</button>
      <button
        v-if="previewImages.length > 1"
        type="button"
        class="preview-nav preview-nav-prev"
        aria-label="上一张"
        @click.stop="showPrevImage"
      >
        ‹
      </button>
      <button
        v-if="previewImages.length > 1"
        type="button"
        class="preview-nav preview-nav-next"
        aria-label="下一张"
        @click.stop="showNextImage"
      >
        ›
      </button>
      <div class="preview-stage" @dblclick.stop="togglePreviewZoom">
        <img
          v-if="previewImageUrl"
          :src="previewImageUrl"
          alt="预览图片"
          class="preview-image"
          :style="{ transform: `scale(${previewScale})` }"
          draggable="false"
        />
      </div>
      <div class="preview-top-info">
        <span v-if="previewImages.length > 1">{{ previewIndex + 1 }} / {{ previewImages.length }}</span>
        <span>{{ Math.round(previewScale * 100) }}%</span>
      </div>
      <div class="preview-actions">
        <button type="button" class="preview-action-btn" aria-label="缩小" @click.stop="zoomPreview(-0.2)">−</button>
        <button type="button" class="preview-action-btn" @click.stop="resetPreviewZoom">重置</button>
        <button type="button" class="preview-action-btn" aria-label="放大" @click.stop="zoomPreview(0.2)">＋</button>
        <button type="button" class="preview-action-btn" @click.stop="savePreviewImage">保存图片</button>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch, onBeforeUnmount } from "vue";
import { renderMarkdown } from "@/utils/markdown";

const props = withDefaults(defineProps<{
  content: string;
  clickableImages?: boolean;
}>(), {
  clickableImages: false,
});
const html = computed(() => renderMarkdown(props.content));
const el = ref<HTMLElement | null>(null);
const previewOpen = ref(false);
const previewImages = ref<string[]>([]);
const previewIndex = ref(0);
const previewScale = ref(1);
const previewImageUrl = computed(() => previewImages.value[previewIndex.value] ?? "");

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

function bindImagePreview() {
  if (!el.value) return;
  const images = el.value.querySelectorAll<HTMLImageElement>("img");
  previewImages.value = Array.from(images).map((img) => img.src).filter(Boolean);
  images.forEach((img, index) => {
    if (props.clickableImages) {
      img.dataset.previewBound = "1";
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", "点击查看图片");
      img.onclick = () => openPreview(index);
      img.onkeydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPreview(index);
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
}

function openPreview(index: number) {
  if (!previewImages.value.length) return;
  previewIndex.value = clampIndex(index);
  resetPreviewZoom();
  previewOpen.value = true;
  document.body.style.overflow = "hidden";
  window.addEventListener("keydown", handlePreviewKeydown);
}

function closePreview() {
  previewOpen.value = false;
  previewScale.value = 1;
  document.body.style.overflow = "";
  window.removeEventListener("keydown", handlePreviewKeydown);
}

function clampIndex(index: number) {
  const total = previewImages.value.length;
  if (!total) return 0;
  return ((index % total) + total) % total;
}

function showPrevImage() {
  previewIndex.value = clampIndex(previewIndex.value - 1);
  resetPreviewZoom();
}

function showNextImage() {
  previewIndex.value = clampIndex(previewIndex.value + 1);
  resetPreviewZoom();
}

function zoomPreview(delta: number) {
  previewScale.value = Math.min(4, Math.max(0.4, Number((previewScale.value + delta).toFixed(2))));
}

function resetPreviewZoom() {
  previewScale.value = 1;
}

function togglePreviewZoom() {
  previewScale.value = previewScale.value > 1 ? 1 : 2;
}

function handlePreviewWheel(event: WheelEvent) {
  zoomPreview(event.deltaY > 0 ? -0.16 : 0.16);
}

function handlePreviewKeydown(event: KeyboardEvent) {
  if (!previewOpen.value) return;
  if (event.key === "Escape") closePreview();
  else if (event.key === "ArrowLeft") showPrevImage();
  else if (event.key === "ArrowRight") showNextImage();
  else if (event.key === "+" || event.key === "=") zoomPreview(0.2);
  else if (event.key === "-" || event.key === "_") zoomPreview(-0.2);
  else if (event.key === "0") resetPreviewZoom();
}

async function savePreviewImage() {
  if (!previewImageUrl.value) return;
  try {
    const response = await fetch(previewImageUrl.value);
    if (!response.ok) throw new Error("download_failed");
    const blob = await response.blob();
    if (typeof (window as any).CPUAndroid?.saveImage === "function") {
      const dataUrl = await blobToDataUrl(blob);
      const ok = (window as any).CPUAndroid.saveImage(dataUrl, previewFileName(previewImageUrl.value, blob.type));
      if (ok !== false) return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = previewFileName(previewImageUrl.value, blob.type);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(previewImageUrl.value, "_blank", "noopener,noreferrer");
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
onMounted(() => nextTick(bindImagePreview));
onBeforeUnmount(() => {
  document.body.style.overflow = "";
  window.removeEventListener("keydown", handlePreviewKeydown);
});
watch(html, () => nextTick(() => {
  wrapTables();
  bindImagePreview();
}));
watch(() => props.clickableImages, () => nextTick(bindImagePreview));
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

.md-image-preview {
  position: fixed;
  inset: 0;
  z-index: 2000;
  padding: 24px;
  background: rgba(15, 23, 42, 0.76);
  backdrop-filter: blur(4px);
  user-select: none;
  touch-action: none;
}

.preview-stage {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.preview-image {
  max-width: min(92vw, 1100px);
  max-height: 82vh;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 56px rgba(15, 23, 42, 0.35);
  transition: transform 0.16s ease;
  transform-origin: center;
}

.preview-actions {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.26);
  backdrop-filter: blur(10px);
}

.preview-action-btn {
  min-height: 42px;
  min-width: 42px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  backdrop-filter: blur(8px);
}

.preview-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 42px;
  height: 42px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}

.preview-top-info {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}

.preview-top-info span {
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(8px);
}

.preview-nav {
  position: absolute;
  top: 50%;
  z-index: 1;
  width: 50px;
  height: 72px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 54px;
  line-height: 1;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transform: translateY(-50%);
}

.preview-nav:hover,
.preview-action-btn:hover,
.preview-close:hover {
  background: rgba(255, 255, 255, 0.26);
}

.preview-nav-prev {
  left: 18px;
}

.preview-nav-next {
  right: 18px;
}

@media (max-width: 640px) {
  .md-image-preview {
    padding: 14px;
  }

  .preview-image {
    max-width: 96vw;
    max-height: 78vh;
    border-radius: 10px;
  }

  .preview-nav {
    width: 42px;
    height: 58px;
    font-size: 42px;
  }

  .preview-nav-prev { left: 8px; }
  .preview-nav-next { right: 8px; }

  .preview-actions {
    bottom: 12px;
    width: calc(100vw - 24px);
    justify-content: center;
  }

  .preview-action-btn {
    min-width: 38px;
    min-height: 38px;
    padding: 0 10px;
    font-size: 13px;
  }

  .preview-close {
    top: 12px;
    right: 12px;
  }
}
</style>
