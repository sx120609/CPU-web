<template>
  <div class="rich-editor" :class="toolbarModeClass" :style="rootStyle">
    <div class="editor-toolbar" @mousedown.prevent @touchstart.passive="rememberSelection">
      <div class="toolbar-head">
        <span class="toolbar-title">{{ label }}</span>
        <span v-if="toolbarStatusText" class="toolbar-status">{{ toolbarStatusText }}</span>
      </div>

      <div class="mobile-toolbar desktop-same-toolbar">
        <div class="mobile-toolbar-tabs">
          <button
            v-for="section in mobileToolbarSections"
            :key="section.key"
            type="button"
            class="mobile-toolbar-tab"
            :class="{ active: activeMobileToolbar === section.key }"
            @click="toggleMobileToolbar(section.key)"
          >
            {{ section.label }}
          </button>
        </div>

        <div v-if="activeMobileToolbar" class="mobile-toolbar-panel">
          <div class="mobile-toolbar-actions">
            <template v-if="activeMobileToolbar === 'heading'">
              <button type="button" :class="{ active: toolbarState.block === 'p' }" @click="runMobileAction(() => applyFormat('p'))">正文</button>
              <button type="button" :class="{ active: toolbarState.block === 'h2' }" @click="runMobileAction(() => applyFormat('h2'))">标题</button>
              <button type="button" :class="{ active: toolbarState.block === 'h3' }" @click="runMobileAction(() => applyFormat('h3'))">小标题</button>
            </template>

            <template v-else-if="activeMobileToolbar === 'format'">
              <button type="button" class="bold" :class="{ active: toolbarState.bold }" @click="runMobileAction(() => runCommand('bold'))">加粗</button>
              <button type="button" class="italic" :class="{ active: toolbarState.italic }" @click="runMobileAction(() => runCommand('italic'))">斜体</button>
              <button type="button" :class="{ active: toolbarState.block === 'blockquote' }" @click="runMobileAction(() => applyFormat('blockquote'))">引用</button>
            </template>

            <template v-else-if="activeMobileToolbar === 'tools'">
              <button type="button" :class="{ active: toolbarState.ul }" @click="runMobileAction(() => runCommand('insertUnorderedList'))">列表</button>
              <button type="button" :class="{ active: toolbarState.ol }" @click="runMobileAction(() => runCommand('insertOrderedList'))">编号</button>
              <button type="button" @click="runMobileAction(() => insertLink())">链接</button>
            </template>

            <template v-else-if="activeMobileToolbar === 'align'">
              <button
                v-for="item in alignOptions"
                :key="item.value"
                type="button"
                class="align-btn"
                :class="{ active: toolbarState.align === item.value }"
                @click="runMobileAction(() => applyAlignment(item.value))"
              >
                {{ item.label }}
              </button>
            </template>

            <template v-else-if="activeMobileToolbar === 'image'">
              <button type="button" :disabled="imageUploading" @click="runMobileAction(() => pickContentMedia())">
                {{ imageUploading ? "上传中" : "插入媒体" }}
              </button>
            </template>
          </div>

          <div v-if="activeMobileToolbar === 'image' && toolbarStatusText" class="mobile-toolbar-note">
            {{ toolbarStatusText }}
          </div>
        </div>
      </div>
    </div>

    <div
      ref="editorRef"
      class="editor-surface"
      contenteditable="true"
      :data-placeholder="resolvedPlaceholder"
      @input="syncEditorContent"
      @paste="handleEditorPaste"
      @drop.prevent="handleEditorDrop"
      @dragover.prevent
      @click="handleEditorClick"
      @pointerup="handleEditorSelectionChange"
      @keyup="handleEditorSelectionChange"
      @focus="handleEditorSelectionChange"
    ></div>

    <div v-if="mediaUploadTasks.length" class="upload-progress-panel">
      <div class="upload-progress-head">
        <div>
          <strong>上传进度</strong>
          <span>{{ uploadProgressSummary }}</span>
        </div>
        <span>{{ overallUploadPercent }}%</span>
      </div>
      <el-progress :percentage="overallUploadPercent" :show-text="false" />
      <div class="upload-progress-list">
        <div
          v-for="task in mediaUploadTasks"
          :key="task.id"
          class="upload-progress-item"
          :class="`is-${task.status}`"
        >
          <div class="upload-progress-item__top">
            <span class="upload-progress-item__name">{{ task.name }}</span>
            <span class="upload-progress-item__status">{{ formatUploadTaskStatus(task) }}</span>
          </div>
          <el-progress
            :percentage="task.progress"
            :show-text="false"
            :status="task.status === 'error' ? 'exception' : task.status === 'done' ? 'success' : undefined"
          />
          <div class="upload-progress-item__meta">
            <span>{{ task.kind === "image" ? "图片" : "视频" }}</span>
            <span>{{ formatBytes(task.loadedBytes) }} / {{ formatBytes(task.totalBytes) }}</span>
          </div>
          <p v-if="task.errorMessage" class="upload-progress-item__error">{{ task.errorMessage }}</p>
        </div>
      </div>
    </div>

    <div class="editor-foot">
      <span class="foot-note">{{ resolvedFooterText }}</span>
      <span class="draft-state">{{ draftHint || "草稿会自动保存" }}</span>
      <span class="foot-count" :class="{ warn: modelValue.length > maxLength }">{{ modelValue.length }} / {{ maxLength }}</span>
    </div>

    <input
      ref="contentImageInputRef"
      type="file"
      accept="image/*,video/*"
      multiple
      class="hidden-file"
      @change="onContentImagePicked"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import DOMPurify from "dompurify";
import { uploadApi } from "@/api/topic";
import { compressImageFile, dataUrlToBlob, normalizeImageUploadError } from "@/utils/imageUpload";
import { isAndroidNativeApp } from "@/utils/clientInfo";
import { normalizeSafeBlankTargets, renderMarkdown } from "@/utils/markdown";
type Alignment = "left" | "center" | "right";
type MobileToolbarKey = "heading" | "format" | "tools" | "align" | "image";

const EDITABLE_BLOCK_SELECTOR = "p,div,h1,h2,h3,h4,h5,h6,blockquote,li";
const MOBILE_BREAKPOINT = "(max-width: 700px)";
const DEFAULT_PLACEHOLDER = "写点什么，也可以直接插入图片或视频；一次选多张图片会自动排成相册。";
const MOBILE_PLACEHOLDER = "写点什么，也可以用工具栏插入图片或视频；多图会自动排成相册。";
const DEFAULT_FOOTER = "支持排版、图片、视频、相册和草稿保存。";
const MOBILE_FOOTER = "支持排版、图片、视频、相册和草稿保存。";
const UPLOAD_TASK_CLEANUP_DELAY = 4500;

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  label?: string;
  footerText?: string;
  maxLength?: number;
  draftKey?: string;
  restoreDraft?: boolean;
  toolbarMode?: "sticky" | "static";
}>(), {
  placeholder: DEFAULT_PLACEHOLDER,
  label: "可视化编辑",
  footerText: DEFAULT_FOOTER,
  maxLength: 20000,
  draftKey: "",
  restoreDraft: true,
  toolbarMode: "sticky",
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "draft-restored": [value: string];
}>();

const editorRef = ref<HTMLElement | null>(null);
const contentImageInputRef = ref<HTMLInputElement | null>(null);
const imageUploading = ref(false);
const mediaUploadTasks = ref<MediaUploadTask[]>([]);
const draftHint = ref("");
const hasSelectedImage = ref(false);
const isMobileViewport = ref(false);
const activeMobileToolbar = ref<MobileToolbarKey | "">("");
const toolbarStickyOffset = ref(0);
const touchScrollState = reactive({
  active: false,
  startY: 0,
  startScrollTop: 0,
});
const toolbarState = reactive({
  bold: false,
  italic: false,
  ul: false,
  ol: false,
  block: "p",
  align: "left" as Alignment,
});
let savedSelection: Range | null = null;
let selectedImage: HTMLImageElement | null = null;
let draftTimer = 0;
let uploadCleanupTimer = 0;
let editorDisposed = false;
let mobileViewportQuery: MediaQueryList | null = null;
let topbarResizeObserver: ResizeObserver | null = null;

const alignOptions: Array<{ value: Alignment; label: string; title: string }> = [
  { value: "left", label: "左齐", title: "靠左" },
  { value: "center", label: "居中", title: "居中" },
  { value: "right", label: "右齐", title: "靠右" },
];

const mobileToolbarSections: Array<{ key: MobileToolbarKey; label: string }> = [
  { key: "heading", label: "标题" },
  { key: "format", label: "格式" },
  { key: "tools", label: "工具" },
  { key: "align", label: "对齐" },
  { key: "image", label: "媒体" },
];

const resolvedPlaceholder = computed(() => (
  isMobileViewport.value && props.placeholder === DEFAULT_PLACEHOLDER
    ? MOBILE_PLACEHOLDER
    : props.placeholder
));

const resolvedFooterText = computed(() => (
  isMobileViewport.value && props.footerText === DEFAULT_FOOTER
    ? ""
    : props.footerText
));

const overallUploadPercent = computed(() => {
  if (!mediaUploadTasks.value.length) return 0;
  return Math.round(mediaUploadTasks.value.reduce((sum, task) => sum + task.progress, 0) / mediaUploadTasks.value.length);
});

const uploadProgressSummary = computed(() => {
  const total = mediaUploadTasks.value.length;
  if (!total) return "";
  const completed = mediaUploadTasks.value.filter((task) => task.status === "done").length;
  const failed = mediaUploadTasks.value.filter((task) => task.status === "error").length;
  const active = mediaUploadTasks.value.filter((task) => isActiveUploadStatus(task.status)).length;
  if (active) return `进行中 ${active} 个，已完成 ${completed}/${total}`;
  if (failed) return `已完成 ${completed} 个，失败 ${failed} 个`;
  return `本次共上传 ${total} 个文件`;
});

const toolbarStatusText = computed(() => {
  if (mediaUploadTasks.value.some((task) => isActiveUploadStatus(task.status))) {
    const completed = mediaUploadTasks.value.filter((task) => task.status === "done").length;
    return `正在上传 ${completed}/${mediaUploadTasks.value.length}`;
  }
  if (mediaUploadTasks.value.length && mediaUploadTasks.value.every((task) => task.status === "done")) {
    return `已上传 ${mediaUploadTasks.value.length} 个媒体`;
  }
  if (hasSelectedImage.value) return isMobileViewport.value ? "已选图片" : "已选图片，可调对齐";
  return isMobileViewport.value ? "" : "支持排版、图片、视频和相册";
});
const toolbarModeClass = computed(() => ({
  "toolbar-static": props.toolbarMode === "static",
}));

const rootStyle = computed(() => ({
  "--editor-toolbar-top": `${toolbarStickyOffset.value}px`,
}));

onMounted(async () => {
  syncMobileViewport();
  if (typeof window !== "undefined" && window.matchMedia) {
    mobileViewportQuery = window.matchMedia(MOBILE_BREAKPOINT);
    if (typeof mobileViewportQuery.addEventListener === "function") {
      mobileViewportQuery.addEventListener("change", handleViewportChange);
    } else {
      mobileViewportQuery.addListener(handleViewportChange);
    }
  }
  observeTopbarHeight();
  syncToolbarStickyOffset();
  hydrateEditor((props.restoreDraft ? readDraft() : "") || props.modelValue);
  document.addEventListener("selectionchange", updateToolbarState);
  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleLayoutResize, { passive: true });
    window.visualViewport?.addEventListener("resize", handleLayoutResize);
  }
  editorRef.value?.addEventListener("touchstart", handleEditorTouchStart, { passive: true });
  editorRef.value?.addEventListener("touchmove", handleEditorTouchMove, { passive: false });
  editorRef.value?.addEventListener("touchend", handleEditorTouchEnd, { passive: true });
});

onBeforeUnmount(() => {
  editorDisposed = true;
  document.removeEventListener("selectionchange", updateToolbarState);
  if (mobileViewportQuery) {
    if (typeof mobileViewportQuery.removeEventListener === "function") {
      mobileViewportQuery.removeEventListener("change", handleViewportChange);
    } else {
      mobileViewportQuery.removeListener(handleViewportChange);
    }
  }
  topbarResizeObserver?.disconnect();
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", handleLayoutResize);
    window.visualViewport?.removeEventListener("resize", handleLayoutResize);
  }
  editorRef.value?.removeEventListener("touchstart", handleEditorTouchStart);
  editorRef.value?.removeEventListener("touchmove", handleEditorTouchMove);
  editorRef.value?.removeEventListener("touchend", handleEditorTouchEnd);
  window.clearTimeout(draftTimer);
  window.clearTimeout(uploadCleanupTimer);
});

function handleViewportChange(event: { matches: boolean }) {
  isMobileViewport.value = event.matches;
  if (!event.matches) activeMobileToolbar.value = "";
  syncToolbarStickyOffset();
}

function syncMobileViewport() {
  if (typeof window === "undefined") return;
  isMobileViewport.value = window.matchMedia?.(MOBILE_BREAKPOINT).matches ?? window.innerWidth <= 700;
}

function handleLayoutResize() {
  syncMobileViewport();
  if (!isMobileViewport.value) activeMobileToolbar.value = "";
  syncToolbarStickyOffset();
}

function toggleMobileToolbar(key: MobileToolbarKey) {
  activeMobileToolbar.value = activeMobileToolbar.value === key ? "" : key;
}

async function runMobileAction(action: () => void | Promise<void>, keepOpen = false) {
  await action();
  if (!keepOpen) activeMobileToolbar.value = "";
}

function observeTopbarHeight() {
  if (typeof window === "undefined" || typeof ResizeObserver === "undefined") return;
  const topbar = document.querySelector<HTMLElement>(".topbar");
  if (!topbar) return;
  topbarResizeObserver = new ResizeObserver(() => syncToolbarStickyOffset());
  topbarResizeObserver.observe(topbar);
}

function syncToolbarStickyOffset() {
  if (typeof window === "undefined") return;
  if (!isMobileViewport.value) {
    toolbarStickyOffset.value = 0;
    return;
  }
  const topbar = document.querySelector<HTMLElement>(".topbar");
  toolbarStickyOffset.value = topbar ? Math.ceil(topbar.getBoundingClientRect().height) : 0;
}

function handleEditorTouchStart(event: TouchEvent) {
  if (!isMobileViewport.value || !editorRef.value) return;
  const touch = event.touches[0];
  if (!touch) return;
  touchScrollState.active = true;
  touchScrollState.startY = touch.clientY;
  touchScrollState.startScrollTop = editorRef.value.scrollTop;
}

function handleEditorTouchMove(event: TouchEvent) {
  if (!touchScrollState.active || !isMobileViewport.value || !editorRef.value) return;
  const touch = event.touches[0];
  if (!touch) return;
  const currentY = touch.clientY;
  const deltaY = touchScrollState.startY - currentY;
  const nextScrollTop = touchScrollState.startScrollTop + deltaY;
  const maxScrollTop = editorRef.value.scrollHeight - editorRef.value.clientHeight;
  const hasInternalScroll = maxScrollTop > 0;
  if (!hasInternalScroll) return;

  const movingDown = deltaY < 0;
  const movingUp = deltaY > 0;
  const atTop = editorRef.value.scrollTop <= 0;
  const atBottom = Math.ceil(editorRef.value.scrollTop) >= maxScrollTop;
  const shouldConsume = (movingUp && !atBottom) || (movingDown && !atTop) || (nextScrollTop > 0 && nextScrollTop < maxScrollTop);
  if (shouldConsume) {
    event.stopPropagation();
    event.preventDefault();
    editorRef.value.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
  }
}

function handleEditorTouchEnd() {
  touchScrollState.active = false;
}

watch(() => props.modelValue, (value) => {
  if (!editorRef.value) return;
  const currentValue = serializeEditorHtml(editorRef.value);
  if (currentValue === value) return;
  hydrateEditor(value);
});

watch(() => props.draftKey, () => {
  hydrateEditor((props.restoreDraft ? readDraft() : "") || props.modelValue);
});

function hydrateEditor(value: string) {
  if (!editorRef.value) return;
  editorRef.value.innerHTML = contentLooksLikeHtml(value) ? sanitizeEditorHtml(value) : renderMarkdown(value);
  normalizeEditorStructure(editorRef.value);
  clearSelectedImage();
  syncEditorContent();
}

function contentLooksLikeHtml(value: string) {
  return /<\/?(p|div|h[1-6]|ul|ol|li|blockquote|img|a|strong|em|br)\b/i.test(value);
}

function sanitizeEditorHtml(value: string) {
  return normalizeSafeBlankTargets(DOMPurify.sanitize(value, {
    ADD_ATTR: [
      "class",
      "href",
      "target",
      "rel",
      "src",
      "alt",
      "title",
      "type",
      "controls",
      "preload",
      "playsinline",
      "webkit-playsinline",
      "poster",
      "muted",
      "loop",
      "data-size",
      "data-align",
      "data-image-album",
      "data-media-kind",
    ],
    ADD_TAGS: ["video", "source"],
  }));
}

function syncEditorContent() {
  if (!editorRef.value) return;
  normalizeEditorStructure(editorRef.value);
  normalizeAlignmentAttributes(editorRef.value);
  const value = serializeEditorHtml(editorRef.value);
  emit("update:modelValue", value);
  scheduleDraftSave(value);
  updateToolbarState();
}

function normalizeEditorHtml(value: string) {
  return value
    .replace(/\sdata-editor-selected="true"/g, "")
    .replace(/<div><br><\/div>/g, "<p><br></p>")
    .replace(/<div>/g, "<p>")
    .replace(/<\/div>/g, "</p>")
    .trim();
}

function rememberSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !editorRef.value) return;
  const range = selection.getRangeAt(0);
  if (editorRef.value.contains(range.commonAncestorContainer)) {
    savedSelection = range.cloneRange();
  }
  updateToolbarState();
}

function handleEditorSelectionChange() {
  rememberSelection();
  updateToolbarState();
}

function handleEditorClick(event: MouseEvent) {
  if (event.target instanceof HTMLImageElement) {
    selectImage(event.target);
  } else {
    clearSelectedImage();
  }
  rememberSelection();
  updateToolbarState();
}

function updateToolbarState() {
  const selection = window.getSelection();
  const node = selectedImage || (selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null);
  if (!node || !editorRef.value?.contains(node)) return;
  toolbarState.bold = document.queryCommandState("bold");
  toolbarState.italic = document.queryCommandState("italic");
  toolbarState.ul = document.queryCommandState("insertUnorderedList");
  toolbarState.ol = document.queryCommandState("insertOrderedList");
  toolbarState.block = normalizeBlockName(String(document.queryCommandValue("formatBlock") || "p"));
  toolbarState.align = readAlignment(node);
}

function normalizeBlockName(value: string) {
  const normalized = value.toLowerCase().replace(/[<>]/g, "");
  if (normalized === "h2" || normalized === "heading 2") return "h2";
  if (normalized === "h3" || normalized === "heading 3") return "h3";
  if (normalized === "blockquote") return "blockquote";
  return "p";
}

function restoreSelection() {
  editorRef.value?.focus();
  const selection = window.getSelection();
  if (!selection || !savedSelection) return;
  selection.removeAllRanges();
  selection.addRange(savedSelection);
}

function runCommand(command: string, value?: string) {
  restoreSelection();
  document.execCommand(command, false, value);
  syncEditorContent();
  rememberSelection();
}

function applyFormat(tag: "p" | "h2" | "h3" | "blockquote") {
  runCommand("formatBlock", tag);
}

function applyAlignment(align: Alignment) {
  restoreSelection();
  const targets = getAlignmentTargets();
  if (!targets.length && prepareEmptyAlignmentTarget(align)) {
    toolbarState.align = align;
    syncEditorContent();
    rememberSelection();
    return;
  }
  if (!targets.length) return;
  targets.forEach((target) => setAlignment(target, align));
  toolbarState.align = align;
  syncEditorContent();
  rememberSelection();
}

async function insertLink() {
  rememberSelection();
  const url = await ElMessageBox.prompt("输入链接地址", "插入链接", {
    confirmButtonText: "插入",
    cancelButtonText: "取消",
    inputPlaceholder: "https://...",
    inputPattern: /^https?:\/\/.+/i,
    inputErrorMessage: "请输入 http 或 https 开头的链接",
  }).then((r) => r.value).catch(() => "");
  if (!url) return;
  restoreSelection();
  const selectedText = window.getSelection()?.toString();
  if (selectedText) runCommand("createLink", url);
  else insertHtmlAtCursor(`<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`);
}

function pickContentMedia() {
  rememberSelection();
  contentImageInputRef.value?.click();
}

async function onContentImagePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await uploadAndInsertMedia(files);
}

async function handleEditorPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []).filter(isSupportedMediaFile);
  if (!files.length) {
    setTimeout(syncEditorContent, 0);
    return;
  }
  event.preventDefault();
  rememberSelection();
  await uploadAndInsertMedia(files);
}

async function handleEditorDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? []).filter(isSupportedMediaFile);
  if (!files.length) return;
  rememberSelection();
  await uploadAndInsertMedia(files);
}

type UploadedMediaItem =
  | { kind: "image"; url: string; alt: string }
  | { kind: "video"; url: string; alt: string; posterUrl?: string };

type MediaUploadTask = {
  id: string;
  name: string;
  kind: "image" | "video";
  status: "waiting" | "preparing" | "uploading" | "processing" | "done" | "error";
  progress: number;
  loadedBytes: number;
  totalBytes: number;
  errorMessage: string;
};

async function uploadAndInsertMedia(files: File[]) {
  if (!files.length) return;
  if (imageUploading.value) {
    ElMessage.info("当前还有文件在上传，请稍候");
    return;
  }
  window.clearTimeout(uploadCleanupTimer);
  imageUploading.value = true;
  mediaUploadTasks.value = files.map((file, index) => createUploadTask(file, index));
  try {
    const uploaded: UploadedMediaItem[] = [];
    let successCount = 0;
    let failedCount = 0;
    for (const [index, file] of files.entries()) {
      const task = mediaUploadTasks.value[index];
      const mediaKind = inferMediaKind(file);
      if (mediaKind === "image") {
        try {
          updateUploadTask(task.id, {
            status: "preparing",
            progress: 0,
            loadedBytes: 0,
            totalBytes: file.size,
            errorMessage: "",
          });
          const useOriginalFile = shouldUploadImageOriginal(file);
          const imageBlob = useOriginalFile
            ? file
            : dataUrlToBlob(await compressImageFile(file, {
              maxWidth: 1400,
              maxHeight: 1400,
              quality: 0.82,
              mimeType: "image/jpeg",
              maxBytes: 520 * 1024,
            }));
          if (editorDisposed) return;
          updateUploadTask(task.id, {
            totalBytes: imageBlob.size || file.size,
            loadedBytes: 0,
          });
          const { url } = await uploadApi.media(imageBlob, useOriginalFile ? safeMediaFileName(file, "image.jpg") : replaceFileExtension(file.name || "image.jpg", "jpg"), {
            forceProxy: isAndroidNativeApp(),
            onProgress: (state) => syncUploadTaskProgress(task.id, state),
          });
          if (editorDisposed) return;
          updateUploadTask(task.id, {
            status: "done",
            progress: 100,
            loadedBytes: imageBlob.size || file.size,
            totalBytes: imageBlob.size || file.size,
          });
          uploaded.push({ kind: "image", url, alt: file.name || "图片" });
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          updateUploadTask(task.id, {
            status: "error",
            errorMessage: normalizeImageUploadError(error),
          });
        }
        continue;
      }
      if (mediaKind === "video") {
        try {
          updateUploadTask(task.id, {
            status: "preparing",
            progress: 0,
            loadedBytes: 0,
            totalBytes: file.size,
            errorMessage: "",
          });
          const { url, posterUrl } = await uploadApi.media(file, safeMediaFileName(file, "video.mp4"), {
            onProgress: (state) => syncUploadTaskProgress(task.id, state),
          });
          if (editorDisposed) return;
          updateUploadTask(task.id, {
            status: "done",
            progress: 100,
            loadedBytes: file.size,
            totalBytes: file.size,
          });
          uploaded.push({
            kind: "video",
            url,
            alt: file.name || "视频",
            posterUrl: posterUrl || "",
          });
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          updateUploadTask(task.id, {
            status: "error",
            errorMessage: normalizeImageUploadError(error),
          });
        }
        continue;
      }
      failedCount += 1;
      updateUploadTask(task.id, {
        status: "error",
        errorMessage: "当前仅支持上传图片或视频文件",
      });
    }
    if (uploaded.length) {
      if (editorDisposed) return;
      insertUploadedMedia(uploaded);
    }
    if (editorDisposed) return;
    if (successCount && failedCount) {
      ElMessage.warning(`已插入 ${successCount} 个媒体，另有 ${failedCount} 个上传失败`);
    } else if (successCount) {
      ElMessage.success(successCount > 1 ? `已插入 ${successCount} 个媒体文件` : "媒体已插入");
    } else if (failedCount) {
      ElMessage.error("媒体上传失败");
    }
  } finally {
    if (!editorDisposed) {
      imageUploading.value = false;
      scheduleUploadTaskCleanup();
    }
  }
}

function insertUploadedMedia(items: UploadedMediaItem[]) {
  if (!items.length) return;
  const markerId = `image-caret-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const blocks: string[] = [];
  let imageRun: Array<Extract<UploadedMediaItem, { kind: "image" }>> = [];
  const flushImages = () => {
    if (!imageRun.length) return;
    if (imageRun.length === 1) {
      const item = imageRun[0];
      blocks.push(
        `<p data-align="${toolbarState.align}"><img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.alt)}" data-size="small" data-align="${toolbarState.align}" /></p>`,
      );
    } else {
      const albumItems = imageRun.map((item) => (
        `<img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.alt)}" data-size="album" data-align="${toolbarState.align}" />`
      )).join("");
      blocks.push(
        `<p class="editor-image-album" data-image-album="1" data-align="${toolbarState.align}">${albumItems}</p>`,
      );
    }
    imageRun = [];
  };

  for (const item of items) {
    if (item.kind === "image") {
      imageRun.push(item);
      continue;
    }
    flushImages();
    blocks.push(renderEditorVideoBlock(item));
  }
  flushImages();
  blocks.push(`<p data-caret="${markerId}"><br></p>`);
  insertHtmlAtCursor(blocks.join(""), markerId);
}

function renderEditorVideoBlock(item: Extract<UploadedMediaItem, { kind: "video" }>) {
  const posterAttr = item.posterUrl ? ` poster="${escapeAttr(item.posterUrl)}"` : "";
  return [
    `<p class="qq-video-card editor-video-card" data-media-kind="video" data-align="${toolbarState.align}">`,
    `<video class="qq-inline-video" controls preload="metadata" playsinline src="${escapeAttr(item.url)}"${posterAttr}></video>`,
    `</p>`,
  ].join("");
}

function insertHtmlAtCursor(html: string, caretMarkerId = "") {
  restoreSelection();
  document.execCommand("insertHTML", false, html);
  if (editorRef.value) {
    normalizeEditorStructure(editorRef.value);
    if (caretMarkerId) moveCaretToMarker(editorRef.value, caretMarkerId);
  }
  clearSelectedImage();
  syncEditorContent();
  rememberSelection();
}

function replaceFileExtension(name: string, extension: string) {
  const base = String(name || "").replace(/\.[^.]+$/, "") || "image";
  return `${base}.${extension}`;
}

function inferMediaKind(file: File): "image" | "video" | "" {
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  const ext = String(file.name || "").split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  if (["mp4", "webm", "ogv", "mov", "m4v", "mkv"].includes(ext)) return "video";
  return "";
}

function isSupportedMediaFile(file: File) {
  return Boolean(inferMediaKind(file));
}

function shouldUploadImageOriginal(file: File) {
  const mime = String(file.type || "").toLowerCase();
  return isAndroidNativeApp() || !mime.startsWith("image/") || mime === "image/gif";
}

function safeMediaFileName(file: File, fallback: string) {
  return String(file.name || "").trim() || fallback;
}

function createUploadTask(file: File, index: number): MediaUploadTask {
  const mediaKind = inferMediaKind(file);
  return {
    id: `media-upload-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || (mediaKind === "video" ? "视频" : "图片"),
    kind: mediaKind === "video" ? "video" : "image",
    status: "waiting",
    progress: 0,
    loadedBytes: 0,
    totalBytes: file.size,
    errorMessage: "",
  };
}

function updateUploadTask(taskId: string, patch: Partial<MediaUploadTask>) {
  if (editorDisposed) return;
  const task = mediaUploadTasks.value.find((item) => item.id === taskId);
  if (!task) return;
  Object.assign(task, patch);
}

function syncUploadTaskProgress(
  taskId: string,
  state: {
    stage: "preparing" | "uploading" | "processing";
    loaded: number;
    total: number;
    percent: number;
  },
) {
  updateUploadTask(taskId, {
    status: state.stage === "processing" ? "processing" : state.stage === "preparing" ? "preparing" : "uploading",
    progress: Math.max(0, Math.min(100, state.percent)),
    loadedBytes: Math.max(0, state.loaded),
    totalBytes: Math.max(state.total, state.loaded),
    errorMessage: "",
  });
}

function isActiveUploadStatus(status: MediaUploadTask["status"]) {
  return status === "preparing" || status === "uploading" || status === "processing";
}

function scheduleUploadTaskCleanup() {
  window.clearTimeout(uploadCleanupTimer);
  if (!mediaUploadTasks.value.length) return;
  if (mediaUploadTasks.value.some((task) => isActiveUploadStatus(task.status))) return;
  uploadCleanupTimer = window.setTimeout(() => {
    if (editorDisposed) return;
    mediaUploadTasks.value = mediaUploadTasks.value.filter((task) => task.status === "error");
  }, UPLOAD_TASK_CLEANUP_DELAY);
}

function formatUploadTaskStatus(task: MediaUploadTask) {
  if (task.status === "waiting") return "等待上传";
  if (task.status === "preparing") return task.kind === "image" ? "压缩准备中" : "准备上传";
  if (task.status === "uploading") return `上传中 ${task.progress}%`;
  if (task.status === "processing") return task.kind === "video" ? "云端处理中" : "服务器处理中";
  if (task.status === "done") return "上传完成";
  return "上传失败";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function getAlignmentTargets() {
  if (!editorRef.value) return [];
  const image = getSelectedImage();
  if (image) {
    return [image];
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  if (!editorRef.value.contains(range.commonAncestorContainer)) return [];

  const blocks = Array.from(editorRef.value.querySelectorAll<HTMLElement>(EDITABLE_BLOCK_SELECTOR));
  const selectedBlocks = blocks.filter((block) => {
    try {
      return range.intersectsNode(block);
    } catch {
      return false;
    }
  });
  if (selectedBlocks.length) return selectedBlocks;

  const block = closestEditableBlock(range.startContainer);
  return block ? [block] : [];
}

function prepareEmptyAlignmentTarget(align: Alignment) {
  if (!editorRef.value || !isContentEmpty()) return false;
  editorRef.value.innerHTML = `<p data-align="${align}"><br></p>`;
  const paragraph = editorRef.value.querySelector("p");
  if (!paragraph) return false;
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  savedSelection = range.cloneRange();
  return true;
}

function closestEditableBlock(node: Node) {
  if (!editorRef.value) return null;
  const element = node instanceof HTMLElement ? node : node.parentNode instanceof HTMLElement ? node.parentNode : null;
  const block = element?.closest<HTMLElement>(EDITABLE_BLOCK_SELECTOR);
  if (block && editorRef.value.contains(block)) return block;
  return null;
}

function setAlignment(target: HTMLElement, align: Alignment) {
  if (target instanceof HTMLImageElement) {
    const album = target.closest<HTMLElement>("[data-image-album='1']");
    if (album) {
      album.setAttribute("data-align", align);
      album.querySelectorAll("img").forEach((img) => img.setAttribute("data-align", align));
      return;
    }
    target.setAttribute("data-align", align);
    return;
  }
  target.setAttribute("data-align", align);
  target.querySelectorAll("img").forEach((img) => img.setAttribute("data-align", align));
}

function readAlignment(node: Node): Alignment {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const explicit = element?.closest<HTMLElement>("[data-align]")?.dataset.align;
  if (explicit === "center" || explicit === "right" || explicit === "left") return explicit;
  const block = closestEditableBlock(node);
  const blockAlign = block?.dataset.align;
  if (blockAlign === "center" || blockAlign === "right" || blockAlign === "left") return blockAlign;
  return "left";
}

function selectImage(image: HTMLImageElement) {
  if (!editorRef.value?.contains(image)) return;
  editorRef.value.querySelectorAll("img[data-editor-selected]").forEach((img) => {
    img.removeAttribute("data-editor-selected");
  });
  selectedImage = image;
  selectedImage.setAttribute("data-editor-selected", "true");
  hasSelectedImage.value = true;
  toolbarState.align = readAlignment(selectedImage);
}

function clearSelectedImage() {
  editorRef.value?.querySelectorAll("img[data-editor-selected]").forEach((img) => {
    img.removeAttribute("data-editor-selected");
  });
  selectedImage = null;
  hasSelectedImage.value = false;
}

function getSelectedImage() {
  if (selectedImage && editorRef.value?.contains(selectedImage)) return selectedImage;
  const image = editorRef.value?.querySelector<HTMLImageElement>("img[data-editor-selected='true']") ?? null;
  selectedImage = image;
  hasSelectedImage.value = Boolean(image);
  return image;
}

function serializeEditorHtml(root: HTMLElement) {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-editor-selected]").forEach((node) => {
    node.removeAttribute("data-editor-selected");
  });
  clone.querySelectorAll("[data-caret]").forEach((node) => {
    node.removeAttribute("data-caret");
  });
  normalizeEditorStructure(clone);
  normalizeAlignmentAttributes(clone);
  return normalizeEditorHtml(clone.innerHTML);
}

function normalizeEditorStructure(root: HTMLElement) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(EDITABLE_BLOCK_SELECTOR));
  blocks.forEach((block) => {
    if (!block.parentNode) return;
    if (block.dataset.imageAlbum === "1") {
      const align = normalizeTextAlign(block.dataset.align || "");
      if (align) block.setAttribute("data-align", align);
      block.classList.add("editor-image-album");
      block.querySelectorAll("img").forEach((img) => {
        img.setAttribute("data-size", "album");
        if (align) img.setAttribute("data-align", align);
      });
      return;
    }
    const images = Array.from(block.children).filter((child): child is HTMLImageElement => child instanceof HTMLImageElement);
    if (images.length <= 1) return;
    const hasMeaningfulContent = Array.from(block.childNodes).some((node) => {
      if (node instanceof HTMLImageElement || node instanceof HTMLBRElement) return false;
      return (node.textContent ?? "").replace(/\u00a0/g, " ").trim().length > 0;
    });
    if (hasMeaningfulContent) return;

    const anchor = block.nextSibling;
    const inheritedAlign = normalizeTextAlign(block.dataset.align || "");
    images.forEach((img) => {
      const paragraph = document.createElement("p");
      const imageAlign = normalizeTextAlign(img.dataset.align || inheritedAlign || "");
      if (imageAlign) {
        paragraph.setAttribute("data-align", imageAlign);
        img.setAttribute("data-align", imageAlign);
      }
      img.remove();
      paragraph.appendChild(img);
      block.parentNode?.insertBefore(paragraph, anchor);
    });
    block.remove();
  });
}

function moveCaretToMarker(root: HTMLElement, markerId: string) {
  const marker = root.querySelector<HTMLElement>(`[data-caret="${markerId}"]`);
  if (!marker) return;
  marker.removeAttribute("data-caret");
  const range = document.createRange();
  range.selectNodeContents(marker);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  savedSelection = range.cloneRange();
}

function normalizeAlignmentAttributes(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const align = normalizeTextAlign(el.style.textAlign);
    if (align) el.setAttribute("data-align", align);
    el.removeAttribute("style");
  });
  root.querySelectorAll<HTMLElement>("[align]").forEach((el) => {
    const align = normalizeTextAlign(el.getAttribute("align") || "");
    if (align) el.setAttribute("data-align", align);
    el.removeAttribute("align");
  });
  root.querySelectorAll<HTMLElement>("[data-align]").forEach((el) => {
    const align = normalizeTextAlign(el.dataset.align || "");
    if (align) el.setAttribute("data-align", align);
    else el.removeAttribute("data-align");
  });
}

function normalizeTextAlign(value: string): Alignment | "" {
  const normalized = value.toLowerCase();
  if (normalized === "center") return "center";
  if (normalized === "right" || normalized === "end") return "right";
  if (normalized === "left" || normalized === "start") return "left";
  return "";
}

function readDraft() {
  if (!props.draftKey) return "";
  try {
    const raw = localStorage.getItem(props.draftKey);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    const value = typeof parsed?.content === "string" ? parsed.content : "";
    if (value) {
      nextTick(() => emit("draft-restored", value));
      draftHint.value = "已恢复草稿";
    }
    return value;
  } catch {
    return "";
  }
}

function scheduleDraftSave(content: string) {
  if (!props.draftKey) return;
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    try {
      if (isContentEmpty()) {
        localStorage.removeItem(props.draftKey);
        draftHint.value = "";
      } else {
        localStorage.setItem(props.draftKey, JSON.stringify({ content, savedAt: Date.now() }));
        draftHint.value = "草稿已保存";
      }
    } catch {
      draftHint.value = "草稿保存失败";
    }
  }, 400);
}

function clearDraft() {
  if (!props.draftKey) return;
  localStorage.removeItem(props.draftKey);
  draftHint.value = "";
}

function isContentEmpty() {
  if (!editorRef.value) return !props.modelValue.trim();
  const text = editorRef.value.innerText.replace(/\u00a0/g, " ").trim();
  return !text && !editorRef.value.querySelector("img, video");
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

defineExpose({ clearDraft, isContentEmpty });
</script>

<style scoped src="./styles/rich-editor-toolbar.css"></style>
<style scoped src="./styles/rich-editor-content.css"></style>
<style scoped src="./styles/rich-editor-status.css"></style>
<style scoped src="./styles/rich-editor-responsive.css"></style>
