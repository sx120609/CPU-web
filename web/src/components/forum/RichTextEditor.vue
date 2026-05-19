<template>
  <div class="rich-editor">
    <div class="editor-toolbar" @mousedown.prevent>
      <span class="toolbar-title">{{ label }}</span>
      <button type="button" title="正文" :class="{ active: toolbarState.block === 'p' }" @click="applyFormat('p')">正文</button>
      <button type="button" title="二级标题" :class="{ active: toolbarState.block === 'h2' }" @click="applyFormat('h2')">标题</button>
      <button type="button" title="三级标题" :class="{ active: toolbarState.block === 'h3' }" @click="applyFormat('h3')">小标题</button>
      <span class="toolbar-divider" />
      <button type="button" title="加粗" class="bold" :class="{ active: toolbarState.bold }" @click="runCommand('bold')">B</button>
      <button type="button" title="斜体" class="italic" :class="{ active: toolbarState.italic }" @click="runCommand('italic')">I</button>
      <button type="button" title="引用" :class="{ active: toolbarState.block === 'blockquote' }" @click="applyFormat('blockquote')">引用</button>
      <span class="toolbar-divider" />
      <button type="button" title="无序列表" :class="{ active: toolbarState.ul }" @click="runCommand('insertUnorderedList')">列表</button>
      <button type="button" title="有序列表" :class="{ active: toolbarState.ol }" @click="runCommand('insertOrderedList')">编号</button>
      <button type="button" title="插入链接" @click="insertLink">链接</button>
      <span class="toolbar-divider" />
      <span class="size-label">齐</span>
      <button
        v-for="item in alignOptions"
        :key="item.value"
        type="button"
        class="align-btn"
        :class="{ active: toolbarState.align === item.value }"
        :title="item.title"
        @click="applyAlignment(item.value)"
      >
        {{ item.label }}
      </button>
      <span class="toolbar-divider" />
      <span class="size-label">图</span>
      <button
        v-for="item in imageSizeOptions"
        :key="item.value"
        type="button"
        class="size-btn"
        :class="{ active: imageSize === item.value }"
        :title="hasSelectedImage ? `设为${item.label}图` : `插入${item.label}`"
        @click="applyImageSize(item.value)"
      >
        {{ item.label }}
      </button>
      <button type="button" title="上传图片" :disabled="imageUploading" @click="pickContentImage">
        {{ imageUploading ? "上传中" : "插图" }}
      </button>
    </div>

    <div
      ref="editorRef"
      class="editor-surface"
      contenteditable="true"
      :data-placeholder="placeholder"
      @input="syncEditorContent"
      @paste="handleEditorPaste"
      @drop.prevent="handleEditorDrop"
      @dragover.prevent
      @click="handleEditorClick"
      @mouseup="handleEditorSelectionChange"
      @keyup="handleEditorSelectionChange"
      @focus="handleEditorSelectionChange"
    ></div>

    <div class="editor-foot">
      <span>{{ footerText }}</span>
      <span class="draft-state">{{ draftHint }}</span>
      <span :class="{ warn: modelValue.length > maxLength }">{{ modelValue.length }} / {{ maxLength }}</span>
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
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { uploadApi } from "@/api/topic";
import { compressImageFile } from "@/utils/imageUpload";
import { renderMarkdown } from "@/utils/markdown";

type ImageSize = "small" | "medium" | "large";
type Alignment = "left" | "center" | "right";

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  label?: string;
  footerText?: string;
  maxLength?: number;
  draftKey?: string;
}>(), {
  placeholder: "写正文，可以用上方按钮排版，也可以直接粘贴图片。",
  label: "可视化编辑",
  footerText: "支持直接粘贴图片；编辑区内图片会以小预览显示。",
  maxLength: 20000,
  draftKey: "",
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "draft-restored": [value: string];
}>();

const editorRef = ref<HTMLElement | null>(null);
const contentImageInputRef = ref<HTMLInputElement | null>(null);
const imageUploading = ref(false);
const imageSize = ref<ImageSize>("large");
const draftHint = ref("");
const hasSelectedImage = ref(false);
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
let internalUpdate = false;

const imageSizeOptions: Array<{ value: ImageSize; label: string }> = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" },
];

const alignOptions: Array<{ value: Alignment; label: string; title: string }> = [
  { value: "left", label: "左齐", title: "靠左" },
  { value: "center", label: "居中", title: "居中" },
  { value: "right", label: "右齐", title: "靠右" },
];

onMounted(async () => {
  hydrateEditor(readDraft() || props.modelValue);
  document.addEventListener("selectionchange", updateToolbarState);
});

onBeforeUnmount(() => {
  document.removeEventListener("selectionchange", updateToolbarState);
  window.clearTimeout(draftTimer);
});

watch(() => props.modelValue, (value) => {
  if (internalUpdate) {
    internalUpdate = false;
    return;
  }
  if (!editorRef.value) return;
  if (serializeEditorHtml(editorRef.value) === value) return;
  hydrateEditor(value);
});

watch(() => props.draftKey, () => {
  hydrateEditor(readDraft() || props.modelValue);
});

function hydrateEditor(value: string) {
  if (!editorRef.value) return;
  editorRef.value.innerHTML = contentLooksLikeHtml(value) ? value : renderMarkdown(value);
  clearSelectedImage();
  syncEditorContent();
}

function contentLooksLikeHtml(value: string) {
  return /<\/?(p|div|h[1-6]|ul|ol|li|blockquote|img|a|strong|em|br)\b/i.test(value);
}

function syncEditorContent() {
  if (!editorRef.value) return;
  normalizeAlignmentAttributes(editorRef.value);
  const value = serializeEditorHtml(editorRef.value);
  internalUpdate = true;
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
  const activeImage = getSelectedImage();
  if (activeImage) imageSize.value = readImageSize(activeImage);
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

function applyImageSize(size: ImageSize) {
  imageSize.value = size;
  const image = getSelectedImage();
  if (!image) return;
  image.setAttribute("data-size", size);
  syncEditorContent();
  rememberSelection();
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
      insertHtmlAtCursor(
        `<p data-align="${toolbarState.align}"><img src="${escapeAttr(url)}" alt="${escapeAttr(file.name || "图片")}" data-size="${imageSize.value}" data-align="${toolbarState.align}" /></p><p><br></p>`
      );
    }
    ElMessage.success(files.length > 1 ? "图片已压缩并上传" : "图片已压缩并插入");
  } finally {
    imageUploading.value = false;
  }
}

function insertHtmlAtCursor(html: string) {
  restoreSelection();
  document.execCommand("insertHTML", false, html);
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

  const blocks = Array.from(editorRef.value.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6,blockquote,li"));
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
  const block = element?.closest<HTMLElement>("p,h1,h2,h3,h4,h5,h6,blockquote,li");
  if (block && editorRef.value.contains(block)) return block;
  return null;
}

function setAlignment(target: HTMLElement, align: Alignment) {
  const block = target instanceof HTMLImageElement ? closestEditableBlock(target) : target;
  block?.setAttribute("data-align", align);
  if (target instanceof HTMLImageElement) target.setAttribute("data-align", align);
  block?.querySelectorAll("img").forEach((img) => img.setAttribute("data-align", align));
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

function readImageSize(img: HTMLImageElement): ImageSize {
  const size = img.dataset.size;
  if (size === "small" || size === "medium" || size === "large") return size;
  return "large";
}

function selectImage(image: HTMLImageElement) {
  if (!editorRef.value?.contains(image)) return;
  editorRef.value.querySelectorAll("img[data-editor-selected]").forEach((img) => {
    img.removeAttribute("data-editor-selected");
  });
  selectedImage = image;
  selectedImage.setAttribute("data-editor-selected", "true");
  hasSelectedImage.value = true;
  imageSize.value = readImageSize(selectedImage);
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
  normalizeAlignmentAttributes(clone);
  return normalizeEditorHtml(clone.innerHTML);
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
  width: 100%;
  border: 1px solid #cfdce8;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 1px 5px rgba(15, 23, 42, 0.04);
}

.editor-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid #edf0f5;
  background: #f8fafc;
}

.toolbar-title {
  color: #168776;
  font-size: 12px;
  font-weight: 750;
  line-height: 1.4;
  margin: 0 0 2px;
  white-space: nowrap;
  width: 100%;
}

.editor-toolbar button {
  appearance: none;
  border: 1px solid #d8e3ec;
  border-radius: 6px;
  background: #fff;
  color: #344054;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  min-height: 34px;
  padding: 0 10px;
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

.editor-toolbar .bold { font-weight: 800; }
.editor-toolbar .italic { font-style: italic; }

.toolbar-divider {
  width: 1px;
  height: 22px;
  background: #dde5ee;
}

.size-label,
.draft-state {
  color: #98a2b3;
  font-size: 12px;
}

.size-label {
  align-self: center;
  font-weight: 700;
}

.size-btn,
.align-btn {
  min-width: 34px;
  padding: 0 8px !important;
}

.editor-surface {
  min-height: 280px;
  max-height: 620px;
  overflow-y: auto;
  padding: 14px 16px;
  color: #1f2937;
  font-size: 15px;
  line-height: 1.75;
  outline: none;
  word-break: break-word;
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  padding: 7px 10px;
  border-top: 1px solid #edf0f5;
  color: #98a2b3;
  font-size: 12px;
}

.editor-foot .warn {
  color: #dc2626;
  font-weight: 700;
}

.hidden-file {
  display: none;
}

@media (max-width: 700px) {
  .editor-toolbar {
    align-items: stretch;
  }

  .toolbar-divider {
    display: none;
  }

  .editor-surface {
    min-height: 220px;
    padding: 12px;
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
    grid-template-columns: 1fr;
  }
}
</style>
