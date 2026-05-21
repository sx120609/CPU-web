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
              <button type="button" :disabled="imageUploading" @click="runMobileAction(() => pickContentImage())">
                {{ imageUploading ? "上传中" : "插图" }}
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

    <div class="editor-foot">
      <span class="foot-note">{{ resolvedFooterText }}</span>
      <span class="draft-state">{{ draftHint || "草稿会自动保存" }}</span>
      <span class="foot-count" :class="{ warn: modelValue.length > maxLength }">{{ modelValue.length }} / {{ maxLength }}</span>
    </div>

    <input
      ref="contentImageInputRef"
      type="file"
      accept="image/*"
      class="hidden-file"
      @change="onContentImagePicked"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { uploadApi } from "@/api/topic";
import { compressImageFile, normalizeImageUploadError } from "@/utils/imageUpload";
import { renderMarkdown } from "@/utils/markdown";
type Alignment = "left" | "center" | "right";
type MobileToolbarKey = "heading" | "format" | "tools" | "align" | "image";

const EDITABLE_BLOCK_SELECTOR = "p,div,h1,h2,h3,h4,h5,h6,blockquote,li";
const MOBILE_BREAKPOINT = "(max-width: 700px)";
const DEFAULT_PLACEHOLDER = "写点什么，也可以直接插入图片。";
const MOBILE_PLACEHOLDER = "写点什么，也可以用工具栏插图。";
const DEFAULT_FOOTER = "支持排版、图片和草稿保存。";
const MOBILE_FOOTER = "支持排版、图片和草稿保存。";

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  label?: string;
  footerText?: string;
  maxLength?: number;
  draftKey?: string;
  toolbarMode?: "sticky" | "static";
}>(), {
  placeholder: DEFAULT_PLACEHOLDER,
  label: "可视化编辑",
  footerText: DEFAULT_FOOTER,
  maxLength: 20000,
  draftKey: "",
  toolbarMode: "sticky",
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "draft-restored": [value: string];
}>();

const editorRef = ref<HTMLElement | null>(null);
const contentImageInputRef = ref<HTMLInputElement | null>(null);
const imageUploading = ref(false);
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
  { key: "image", label: "图片" },
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

const toolbarStatusText = computed(() => {
  if (hasSelectedImage.value) return isMobileViewport.value ? "已选图片" : "已选图片，可调对齐";
  return isMobileViewport.value ? "" : "支持排版、图片和草稿";
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
  hydrateEditor(readDraft() || props.modelValue);
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
  hydrateEditor(readDraft() || props.modelValue);
});

function hydrateEditor(value: string) {
  if (!editorRef.value) return;
  editorRef.value.innerHTML = contentLooksLikeHtml(value) ? value : renderMarkdown(value);
  normalizeEditorStructure(editorRef.value);
  clearSelectedImage();
  syncEditorContent();
}

function contentLooksLikeHtml(value: string) {
  return /<\/?(p|div|h[1-6]|ul|ol|li|blockquote|img|a|strong|em|br)\b/i.test(value);
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

function pickContentImage() {
  rememberSelection();
  contentImageInputRef.value?.click();
}

async function onContentImagePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await uploadAndInsertImages(files);
}

async function handleEditorPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    setTimeout(syncEditorContent, 0);
    return;
  }
  event.preventDefault();
  rememberSelection();
  await uploadAndInsertImages(files);
}

async function handleEditorDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  rememberSelection();
  await uploadAndInsertImages(files);
}

async function uploadAndInsertImages(files: File[]) {
  if (!files.length) return;
  imageUploading.value = true;
  try {
    for (const file of files) {
      const compressed = await compressImageFile(file, {
        maxWidth: 1400,
        maxHeight: 1400,
        quality: 0.82,
        mimeType: "image/jpeg",
        maxBytes: 520 * 1024,
      });
      const { url } = await uploadApi.image(compressed);
      insertUploadedImage(url, file.name || "图片");
    }
    ElMessage.success(files.length > 1 ? "图片已压缩并上传" : "图片已压缩并插入");
  } catch (error) {
    ElMessage.error(normalizeImageUploadError(error));
  } finally {
    imageUploading.value = false;
  }
}

function insertUploadedImage(url: string, alt: string) {
  const markerId = `image-caret-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  insertHtmlAtCursor(
    `<p data-align="${toolbarState.align}"><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" data-size="small" data-align="${toolbarState.align}" /></p><p data-caret="${markerId}"><br></p>`,
    markerId
  );
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
  return !text && !editorRef.value.querySelector("img");
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

defineExpose({ clearDraft, isContentEmpty });
</script>

<style scoped>
.rich-editor {
  --editor-toolbar-top: 0px;
  width: 100%;
  position: relative;
  border: 1px solid #d8e2ec;
  border-radius: 14px;
  background: #fff;
  overflow: visible;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
}

.editor-toolbar {
  position: sticky;
  top: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid #e6edf5;
  border-radius: 14px 14px 0 0;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(244, 247, 251, 0.94));
  backdrop-filter: blur(14px);
}

.rich-editor.toolbar-static {
  border-color: #e6ecf3;
  border-radius: 18px;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.07);
  background: linear-gradient(180deg, #fcfdff 0%, #ffffff 100%);
}

.rich-editor.toolbar-static .editor-toolbar {
  position: relative;
  top: auto;
  gap: 10px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid #edf1f5;
  border-radius: 18px 18px 0 0;
  background:
    radial-gradient(circle at top left, rgba(22, 135, 118, 0.08), transparent 34%),
    linear-gradient(180deg, #f8fbfd 0%, #fdfefe 100%);
  backdrop-filter: none;
}

.rich-editor.toolbar-static .toolbar-head {
  align-items: flex-start;
}

.rich-editor.toolbar-static .toolbar-title {
  color: #14532d;
}

.rich-editor.toolbar-static .toolbar-status {
  padding: 4px 8px;
  border-radius: 999px;
  background: #eefbf6;
  color: #0f766e;
}

.toolbar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.toolbar-title {
  color: #0f766e;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.toolbar-status {
  min-width: 0;
  font-size: 12px;
  color: #7b8794;
  line-height: 1.3;
  text-align: right;
}

.toolbar-scroll {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  align-items: flex-start;
  border: 1px solid #dde6f0;
  border-radius: 14px;
  background: #fff;
  padding: 6px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.rich-editor.toolbar-static .toolbar-scroll {
  gap: 8px;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}

.toolbar-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 6px;
  background: transparent;
}

.rich-editor.toolbar-static .toolbar-group {
  gap: 6px;
  padding: 8px;
  border: 1px solid #e6edf5;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
}

.toolbar-group + .toolbar-group {
  margin-left: 6px;
  padding-left: 12px;
  border-left: 1px solid #e7edf4;
}

.rich-editor.toolbar-static .toolbar-group + .toolbar-group {
  margin-left: 0;
  padding-left: 8px;
  border-left: none;
}

.toolbar-group--compact {
  padding-inline: 6px;
}

.editor-toolbar button {
  appearance: none;
  flex: 0 0 auto;
  border: 1px solid #d5e1ec;
  border-radius: 10px;
  background: #fff;
  color: #344054;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  line-height: 1;
  min-height: 36px;
  padding: 0 12px;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  touch-action: manipulation;
  -webkit-tap-highlight-color: rgba(22, 135, 118, 0.16);
}

.rich-editor.toolbar-static .editor-toolbar button {
  min-height: 38px;
  border-color: #dbe5ee;
  border-radius: 11px;
  background: #fbfdff;
}

.editor-toolbar button:hover {
  border-color: var(--cpu-primary);
  color: var(--cpu-primary);
}

.editor-toolbar button.active {
  border-color: #168776;
  background: #e8f7f3;
  color: #0f766e;
  box-shadow: inset 0 0 0 1px rgba(22, 135, 118, 0.12);
}

.editor-toolbar button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.editor-toolbar button:active {
  transform: translateY(1px);
}

.editor-toolbar .bold { font-weight: 800; }
.editor-toolbar .italic { font-style: italic; }

.mobile-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.mobile-toolbar-tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.mobile-toolbar-tab {
  min-width: 0;
  width: 100%;
}

.mobile-toolbar-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.mobile-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.mobile-toolbar-note {
  font-size: 11px;
  color: #7b8794;
  line-height: 1.4;
}

.size-label,
.draft-state,
.foot-note,
.foot-count {
  color: #98a2b3;
  font-size: 12px;
}

.size-label {
  flex: 0 0 auto;
  align-self: center;
  font-weight: 700;
}

.size-btn,
.align-btn {
  min-width: 38px;
  padding: 0 10px !important;
}

.editor-surface {
  min-height: 320px;
  max-height: 620px;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  padding: 16px;
  color: #1f2937;
  font-size: 15px;
  line-height: 1.75;
  outline: none;
  word-break: break-word;
  background: #fff;
}

.editor-surface:empty::before {
  content: attr(data-placeholder);
  color: #98a2b3;
}

.editor-surface:focus {
  box-shadow: inset 0 0 0 1px rgba(22, 135, 118, 0.28);
}

.editor-surface :deep(h2),
.editor-surface :deep(h3) {
  margin: 0.7em 0 0.35em;
  font-weight: 700;
}

.editor-surface :deep(h2) { font-size: 20px; }
.editor-surface :deep(h3) { font-size: 17px; }
.editor-surface :deep(p) { margin: 0.45em 0; }
.editor-surface :deep([data-align="left"]) { text-align: left; }
.editor-surface :deep([data-align="center"]) { text-align: center; }
.editor-surface :deep([data-align="right"]) { text-align: right; }
.editor-surface :deep(ul),
.editor-surface :deep(ol) {
  margin: 0.45em 0;
  padding-left: 24px;
}

.editor-surface :deep(blockquote) {
  margin: 0.6em 0;
  padding: 6px 12px;
  border-left: 3px solid var(--cpu-primary);
  background: #ecfdf5;
  color: #4b5563;
}

.editor-surface :deep(a) {
  color: var(--cpu-primary);
  text-decoration: underline;
}

.editor-surface :deep(img) {
  display: inline-block;
  width: auto;
  object-fit: contain;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  background: #f8fafc;
  margin: 8px 0;
  padding: 4px;
  vertical-align: top;
}

.editor-surface :deep(img[data-editor-selected="true"]) {
  border-color: #168776;
  box-shadow: 0 0 0 3px rgba(22, 135, 118, 0.16);
}

.editor-surface :deep(img[data-align="center"]) {
  display: block;
  margin-left: auto;
  margin-right: auto;
}

.editor-surface :deep(img[data-align="right"]) {
  display: block;
  margin-left: auto;
  margin-right: 0;
}

.editor-surface :deep(img[data-align="left"]) {
  display: block;
  margin-left: 0;
  margin-right: auto;
}

.editor-surface :deep(img[data-size="small"]) {
  max-width: min(100%, 180px);
  max-height: 140px;
}

.editor-surface :deep(img[data-size="medium"]) {
  max-width: min(100%, 280px);
  max-height: 190px;
}

.editor-surface :deep(img[data-size="large"]),
.editor-surface :deep(img:not([data-size])) {
  max-width: min(100%, 360px);
  max-height: 220px;
}

.editor-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 12px;
  padding: 9px 12px 10px;
  border-top: 1px solid #edf0f5;
  background: #fff;
  border-radius: 0 0 14px 14px;
}

.rich-editor.toolbar-static .editor-foot {
  border-radius: 0 0 18px 18px;
}

.editor-foot .warn {
  color: #dc2626;
  font-weight: 700;
}

.foot-note {
  flex: 1 1 220px;
  min-width: 0;
}

.draft-state,
.foot-count {
  flex: 0 0 auto;
}

.hidden-file {
  display: none;
}

@media (min-width: 701px) {
  .desktop-same-toolbar .mobile-toolbar-tabs {
    grid-template-columns: repeat(5, minmax(88px, 1fr));
  }

  .desktop-same-toolbar .mobile-toolbar-tab {
    min-height: 36px;
    padding: 0 8px;
    border: 1px solid #d5e1ec;
    border-radius: 11px;
    background: #fbfdff;
    color: #344054;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
  }

  .desktop-same-toolbar .mobile-toolbar-tab.active {
    border-color: #168776;
    background: #e8f7f3;
    color: #0f766e;
  }

  .desktop-same-toolbar .mobile-toolbar-panel {
    padding: 10px;
    border-radius: 14px;
    border-color: #dfe8f1;
  }

  .desktop-same-toolbar .mobile-toolbar-actions button {
    min-height: 36px;
    padding: 0 12px;
    border-radius: 10px;
    font-size: 13px;
  }
}

@media (max-width: 700px) {
  .rich-editor {
    border-radius: 14px;
  }

  .editor-toolbar {
    top: calc(var(--editor-toolbar-top, 0px) + 8px);
    margin: 0 -1px;
    padding: 10px 10px 8px;
    border: 1px solid #dfe8f1;
    border-bottom-color: #e6edf5;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  }

  .toolbar-title {
    font-size: 12px;
  }

  .mobile-toolbar-tabs {
    gap: 6px;
  }

  .mobile-toolbar-tab {
    min-height: 34px;
    padding: 0 4px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    background: #f8fafc;
  }

  .mobile-toolbar-panel {
    padding: 8px;
    border-radius: 12px;
  }

  .mobile-toolbar-actions {
    gap: 6px;
  }

  .mobile-toolbar-actions button {
    min-height: 34px;
    padding: 0 10px;
    border-radius: 9px;
    font-size: 12px;
  }

  .toolbar-status {
    padding: 4px 8px;
    border-radius: 999px;
    background: #ecfdf5;
    color: #0f766e;
    font-size: 11px;
    white-space: nowrap;
  }

  .toolbar-scroll {
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 6px;
    margin: 0;
    scrollbar-width: none;
  }

  .toolbar-scroll::-webkit-scrollbar {
    display: none;
  }

  .toolbar-group {
    flex: 0 0 auto;
    gap: 4px;
    padding: 0 6px 0 0;
  }

  .toolbar-group + .toolbar-group {
    margin-left: 4px;
    padding-left: 10px;
  }

  .editor-toolbar button {
    min-height: 40px;
    padding: 0 11px;
    font-size: 13px;
  }

  .size-label {
    min-width: 18px;
    text-align: center;
  }

  .editor-surface {
    min-height: min(46dvh, 360px);
    max-height: min(62dvh, 520px);
    padding: 14px 12px 18px;
  }

  .editor-surface :deep(img[data-size="small"]) {
    max-width: min(100%, 120px);
    max-height: 100px;
  }

  .editor-surface :deep(img[data-size="medium"]) {
    max-width: min(100%, 180px);
    max-height: 125px;
  }

  .editor-surface :deep(img[data-size="large"]),
  .editor-surface :deep(img:not([data-size])) {
    max-width: min(100%, 220px);
    max-height: 140px;
  }

  .editor-foot {
    gap: 6px 10px;
    padding: 8px 10px 10px;
  }

  .foot-note {
    display: none;
  }

  .draft-state,
  .foot-count {
    font-size: 11px;
  }

  .rich-editor.toolbar-static {
    border-radius: 16px;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
  }

  .rich-editor.toolbar-static .editor-toolbar {
    margin: 0;
    padding: 12px 12px 10px;
    border: none;
    border-bottom: 1px solid #edf1f5;
    border-radius: 16px 16px 0 0;
    box-shadow: none;
  }

  .rich-editor.toolbar-static .toolbar-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .rich-editor.toolbar-static .toolbar-status {
    text-align: left;
  }

  .rich-editor.toolbar-static .mobile-toolbar-panel {
    background: rgba(255, 255, 255, 0.96);
    border-color: #e6edf5;
  }

  .rich-editor.toolbar-static .editor-surface {
    min-height: min(40dvh, 320px);
    max-height: min(48dvh, 420px);
  }

  .rich-editor.toolbar-static .editor-foot {
    border-radius: 0 0 16px 16px;
  }
}
</style>
