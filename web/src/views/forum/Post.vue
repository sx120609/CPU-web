<template>
  <div class="post-page">
    <h2 class="page-title">{{ editingId ? '编辑帖子' : '发表新帖' }}</h2>

    <div class="cpu-card form">
      <el-form label-position="top" :model="form">
        <el-form-item label="选择板块" required>
          <el-select v-model="form.boardSlug" placeholder="选择要发帖的板块" :disabled="!!editingId" @change="onBoardChange">
            <el-option-group v-for="(group, label) in groupedBoards" :key="label" :label="label">
              <el-option
                v-for="b in group"
                :key="b.slug"
                :value="b.slug"
                :label="`${b.icon ?? ''} ${b.name}`"
                :disabled="b.readOnly"
              >
                <span style="margin-right:6px">{{ b.icon }}</span>{{ b.name }}
                <span style="float:right;color:#9ca3af;font-size:12px">{{ b.readOnly ? '只读' : '' }}</span>
              </el-option>
            </el-option-group>
          </el-select>
          <div v-if="currentBoard" class="board-hint">
            {{ currentBoard.description }}
          </div>
        </el-form-item>

        <!-- 二手板块特化 -->
        <template v-if="boardType === 'market'">
          <div class="meta-row">
            <el-form-item label="价格（元）" required>
              <el-input-number v-model="meta.price" :min="0" :max="999999" :step="10" />
            </el-form-item>
            <el-form-item label="新旧程度">
              <el-select v-model="meta.condition" placeholder="选择">
                <el-option label="全新" value="全新" />
                <el-option label="九成新" value="九成新" />
                <el-option label="八成新" value="八成新" />
                <el-option label="七成新及以下" value="七成新及以下" />
                <el-option label="求购" value="求购" />
              </el-select>
            </el-form-item>
            <el-form-item label="交易方式">
              <el-select v-model="meta.tradeMode" placeholder="选择">
                <el-option label="当面" value="当面" />
                <el-option label="包邮" value="包邮" />
                <el-option label="当面 / 包邮+5" value="当面 / 包邮+5" />
              </el-select>
            </el-form-item>
          </div>
        </template>

        <!-- 提问板块特化 -->
        <template v-if="boardType === 'question'">
          <el-form-item label="悬赏（声望）">
            <el-input-number v-model="meta.bounty" :min="0" :max="999" :step="5" />
            <span class="cpu-muted" style="margin-left:8px">采纳回答者获得声望</span>
          </el-form-item>
        </template>

        <!-- 课程点评特化 -->
        <template v-if="boardType === 'coursereview'">
          <el-form-item label="评价的课程" required>
            <el-select v-model="meta.courseId" filterable placeholder="搜课程名 / 代码" @change="onCourseChange">
              <el-option
                v-for="c in courses"
                :key="c.id"
                :value="c.id"
                :label="`${c.code} ${c.name}${c.teachers?.length ? ' - ' + c.teachers.map((t: any) => t.name).join('、') : ''}`"
              >
                <span>{{ c.code }} · {{ c.name }}</span>
                <span style="float:right;color:#9ca3af;font-size:12px">
                  {{ c.teachers?.length ? c.teachers.map((t: any) => t.name).join('、') : '暂无老师' }}
                </span>
              </el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="授课老师" required>
            <div class="teacher-pick-row">
              <el-select
                v-model="meta.courseTeacherId"
                placeholder="先选已知老师"
                clearable
                filterable
                style="flex:1; min-width:160px"
                :disabled="!meta.courseId"
                @change="onPickKnownTeacher"
              >
                <el-option
                  v-for="t in teacherOptions"
                  :key="t.courseTeacherId"
                  :value="t.courseTeacherId"
                  :label="t.name"
                />
              </el-select>
              <span class="or-text">或</span>
              <el-input
                v-model="meta.teacherName"
                placeholder="输入新老师姓名（自助添加）"
                maxlength="40"
                style="flex:1; min-width:160px"
                :disabled="!meta.courseId"
                @input="onTypeNewTeacher"
              />
            </div>
            <div class="cpu-muted" style="margin-top:4px">
              二选一。课表里没列出来的老师，直接在右侧输入即可，发布时自动加入这门课的授课记录。
            </div>
          </el-form-item>
          <div class="rate-row">
            <el-form-item label="难度"><el-rate v-model="meta.ratings.difficulty" /></el-form-item>
            <el-form-item label="收获"><el-rate v-model="meta.ratings.reward" /></el-form-item>
            <el-form-item label="推荐度"><el-rate v-model="meta.ratings.recommend" /></el-form-item>
            <el-form-item label="给分"><el-rate v-model="meta.ratings.givingScore" /></el-form-item>
          </div>
          <el-form-item label="学期">
            <el-input v-model="meta.semester" placeholder="例如 2024-2025-1" style="max-width:240px" />
          </el-form-item>
        </template>

        <el-form-item label="标题" required>
          <el-input v-model="form.title" placeholder="一句话描述要点（2-120 字）" maxlength="120" show-word-limit />
        </el-form-item>

        <el-form-item label="正文" required>
          <div class="rich-editor">
            <div class="editor-toolbar" @mousedown.prevent>
              <span class="toolbar-title">可视化编辑</span>
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
              <button type="button" title="上传图片" :disabled="imageUploading" @click="pickContentImage">
                {{ imageUploading ? "上传中" : "插图" }}
              </button>
            </div>
            <div
              ref="editorRef"
              class="editor-surface"
              contenteditable="true"
              :data-placeholder="editorPlaceholder"
              @input="syncEditorContent"
              @paste="handleEditorPaste"
              @drop.prevent="handleEditorDrop"
              @dragover.prevent
              @mouseup="handleEditorSelectionChange"
              @keyup="handleEditorSelectionChange"
              @focus="handleEditorSelectionChange"
            ></div>
            <div class="editor-foot">
              <span>支持直接粘贴图片；编辑区内图片会以小预览显示。</span>
              <span :class="{ warn: form.content.length > CONTENT_MAX }">{{ form.content.length }} / {{ CONTENT_MAX }}</span>
            </div>
            <input
              ref="contentImageInputRef"
              type="file"
              accept="image/*"
              class="hidden-file"
              @change="onContentImagePicked"
            />
          </div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="submit">{{ editingId ? '预览并保存' : '预览并发布' }}</el-button>
          <el-button @click="$router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-dialog
      v-model="previewOpen"
      :title="editingId ? '确认保存修改' : '确认发布帖子'"
      width="720px"
      class="publish-preview-dialog"
      append-to-body
    >
      <div class="publish-preview">
        <div class="preview-meta">
          <span>{{ currentBoard?.name || "未选择板块" }}</span>
          <span>{{ form.content.length }} / {{ CONTENT_MAX }}</span>
        </div>
        <h3>{{ form.title || "未填写标题" }}</h3>
        <MarkdownView :content="form.content" />
      </div>
      <template #footer>
        <el-button @click="previewOpen = false">返回修改</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSubmit">
          {{ editingId ? '确认保存' : '确认发布' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, reactive, computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import MarkdownView from "@/components/forum/MarkdownView.vue";
import { boardApi, type Board } from "@/api/board";
import { topicApi, uploadApi } from "@/api/topic";
import { courseApi, type Course } from "@/api/course";
import { compressImageFile } from "@/utils/imageUpload";
import { renderMarkdown } from "@/utils/markdown";

const route = useRoute();
const router = useRouter();

const boards = ref<Board[]>([]);
const courses = ref<Course[]>([]);
const submitting = ref(false);
const editingId = computed(() => (route.params.id ? Number(route.params.id) : null));
const CONTENT_MAX = 20000;
const editorPlaceholder = "写正文，可以用上方按钮排版，也可以直接粘贴图片。";
const editorRef = ref<HTMLElement | null>(null);
const contentImageInputRef = ref<HTMLInputElement | null>(null);
const imageUploading = ref(false);
const previewOpen = ref(false);
const pendingMetadata = ref<any>(null);
const toolbarState = reactive({
  bold: false,
  italic: false,
  ul: false,
  ol: false,
  block: "p",
});
let savedSelection: Range | null = null;

const form = reactive({
  boardSlug: (route.query.board as string) || "",
  title: "",
  content: "",
});

const meta = reactive<any>({
  price: 0,
  condition: "九成新",
  tradeMode: "当面",
  bounty: 0,
  courseId: undefined,
  courseTeacherId: undefined,
  teacherName: "",
  ratings: { difficulty: 3, reward: 3, recommend: 3, givingScore: 3 },
  semester: "",
});

const currentBoard = computed(() => boards.value.find((b) => b.slug === form.boardSlug));
const boardType = computed(() => currentBoard.value?.type ?? "normal");

const selectedCourse = computed(() => courses.value.find((c) => c.id === meta.courseId));
const teacherOptions = computed(() => selectedCourse.value?.teachers ?? []);

const groupedBoards = computed(() => {
  const groups: Record<string, Board[]> = { "💬 综合讨论": [], "🎒 学生共建": [], "📢 校园公告（只读）": [] };
  for (const b of boards.value) {
    if (b.type === "announce") groups["📢 校园公告（只读）"].push(b);
    else if (["market", "question", "coursereview"].includes(b.type)) groups["🎒 学生共建"].push(b);
    else groups["💬 综合讨论"].push(b);
  }
  return groups;
});

onMounted(async () => {
  boards.value = await boardApi.list();
  if (editingId.value) {
    const t = await topicApi.detail(editingId.value);
    form.boardSlug = t.board?.slug ?? "";
    form.title = t.title;
    form.content = t.content;
    if (t.metadata) Object.assign(meta, t.metadata);
    await nextTick();
    hydrateEditor();
  }
  if (boardType.value === "coursereview") await loadCoursesForReview();
  await nextTick();
  hydrateEditor();
  document.addEventListener("selectionchange", updateToolbarState);
});

onBeforeUnmount(() => {
  document.removeEventListener("selectionchange", updateToolbarState);
});

watch(boardType, async () => {
  if (boardType.value === "coursereview") await loadCoursesForReview();
});

async function loadCoursesForReview() {
  if (courses.value.length) return;
  courses.value = await courseApi.list();
}

function onBoardChange() {
  if (boardType.value === "coursereview") void loadCoursesForReview();
}

function onCourseChange() {
  // 换课程时清掉老师选择，避免把上一门课的 courseTeacherId 误带过去
  meta.courseTeacherId = undefined;
  meta.teacherName = "";
}
function onPickKnownTeacher(v: number | undefined) {
  if (v) meta.teacherName = ""; // 选了已有老师 → 清掉手输
}
function onTypeNewTeacher(v: string) {
  if (v && v.trim()) meta.courseTeacherId = undefined; // 开始手输 → 清掉已选
}

function hydrateEditor() {
  if (!editorRef.value) return;
  editorRef.value.innerHTML = contentLooksLikeHtml(form.content) ? form.content : renderMarkdown(form.content);
  syncEditorContent();
}

function contentLooksLikeHtml(value: string) {
  return /<\/?(p|div|h[1-6]|ul|ol|li|blockquote|img|a|strong|em|br)\b/i.test(value);
}

function syncEditorContent() {
  if (!editorRef.value) return;
  form.content = normalizeEditorHtml(editorRef.value.innerHTML);
  updateToolbarState();
}

function normalizeEditorHtml(value: string) {
  return value
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

function updateToolbarState() {
  const selection = window.getSelection();
  const node = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
  if (!node || !editorRef.value?.contains(node)) return;
  toolbarState.bold = document.queryCommandState("bold");
  toolbarState.italic = document.queryCommandState("italic");
  toolbarState.ul = document.queryCommandState("insertUnorderedList");
  toolbarState.ol = document.queryCommandState("insertOrderedList");
  toolbarState.block = normalizeBlockName(String(document.queryCommandValue("formatBlock") || "p"));
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
  updateToolbarState();
}

function applyFormat(tag: "p" | "h2" | "h3" | "blockquote") {
  runCommand("formatBlock", tag);
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
  if (selectedText) {
    runCommand("createLink", url);
  } else {
    insertHtmlAtCursor(`<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`);
  }
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
      insertHtmlAtCursor(`<p><img src="${escapeAttr(url)}" alt="${escapeAttr(file.name || "图片")}" /></p><p><br></p>`);
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

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isEditorContentEmpty() {
  if (!editorRef.value) return !form.content.trim();
  const text = editorRef.value.innerText.replace(/\u00a0/g, " ").trim();
  const hasImage = Boolean(editorRef.value.querySelector("img"));
  return !text && !hasImage;
}

async function submit() {
  if (!form.boardSlug) { ElMessage.warning("请选择板块"); return; }
  if (form.title.trim().length < 2) { ElMessage.warning("标题至少 2 字"); return; }
  syncEditorContent();
  if (isEditorContentEmpty()) { ElMessage.warning("请填写正文"); return; }
  if (form.content.length > CONTENT_MAX) { ElMessage.warning("正文内容过长，请精简后再发布"); return; }
  const metadata = buildMetadata();
  if (!metadata) return;
  pendingMetadata.value = metadata;
  previewOpen.value = true;
}

function buildMetadata() {
  // 组织 metadata
  const metadata: any = {};
  if (boardType.value === "market") {
    if (!meta.price && meta.price !== 0) { ElMessage.warning("请填写价格"); return null; }
    metadata.price = meta.price;
    metadata.condition = meta.condition;
    metadata.tradeMode = meta.tradeMode;
  } else if (boardType.value === "question") {
    metadata.bounty = meta.bounty;
    metadata.resolved = false;
  } else if (boardType.value === "coursereview") {
    if (!meta.courseId) { ElMessage.warning("请选择课程"); return null; }
    if (!meta.courseTeacherId && !meta.teacherName?.trim()) {
      ElMessage.warning("请选择或填写授课老师");
      return null;
    }
    metadata.courseId = meta.courseId;
    if (meta.courseTeacherId) metadata.courseTeacherId = meta.courseTeacherId;
    else metadata.teacherName = meta.teacherName.trim();
    metadata.ratings = meta.ratings;
    if (meta.semester) metadata.semester = meta.semester;
  }
  return metadata;
}

async function confirmSubmit() {
  const metadata = pendingMetadata.value;
  if (!metadata) return;
  submitting.value = true;
  try {
    if (editingId.value) {
      await topicApi.update(editingId.value, {
        title: form.title,
        content: form.content,
        metadata,
      });
      ElMessage.success("已保存");
      router.replace(`/forum/topic/${editingId.value}`);
    } else {
      const r = await topicApi.create({
        boardSlug: form.boardSlug,
        title: form.title,
        content: form.content,
        metadata,
      });
      ElMessage.success("已发布");
      router.replace(`/forum/topic/${r.id}`);
    }
  } finally {
    submitting.value = false;
    previewOpen.value = false;
  }
}
</script>

<style scoped>
.post-page { display: flex; flex-direction: column; gap: 16px; }
.page-title { margin: 0; font-size: 22px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }

.board-hint { font-size: 12px; color: #6b7280; margin-top: 6px; }
.meta-row { display: flex; gap: 14px; flex-wrap: wrap; }
.meta-row .el-form-item { min-width: 200px; flex: 1; }

.rate-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
@media (max-width: 700px) { .rate-row { grid-template-columns: 1fr 1fr; } }

.teacher-pick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
}
.or-text { color: #9ca3af; font-size: 12px; }

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
  max-width: min(100%, 360px);
  max-height: 220px;
  object-fit: contain;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  background: #f8fafc;
  margin: 8px 0;
  padding: 4px;
  vertical-align: top;
}

.editor-foot {
  display: flex;
  justify-content: space-between;
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

.publish-preview {
  color: #1f2937;
}

.preview-meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: #667085;
  font-size: 12px;
  margin-bottom: 8px;
}

.publish-preview h3 {
  margin: 0 0 12px;
  color: #111827;
  font-size: 20px;
  line-height: 1.35;
}

.publish-preview :deep(.md) {
  max-height: min(58vh, 520px);
  overflow: auto;
  padding: 12px;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  background: #fff;
}

.preview {
  background: #f9fafb;
  padding: 16px 18px;
  border-radius: 8px;
  border-left: 3px solid var(--cpu-primary);
  width: 100%;
}
.preview h4 { margin: 0 0 8px; color: #6b7280; font-size: 12px; font-weight: 500; }
.cpu-muted { font-size: 12px; color: #9ca3af; }

@media (max-width: 700px) {
  .page-title {
    font-size: 20px;
  }

  .cpu-card {
    border-radius: 10px;
    padding: 14px;
  }

  .meta-row {
    gap: 0;
  }

  .meta-row .el-form-item {
    min-width: 100%;
  }

  .rate-row {
    grid-template-columns: 1fr;
  }

  .teacher-pick-row {
    flex-direction: column;
    align-items: stretch;
  }

  .or-text {
    align-self: center;
  }

  .editor-toolbar {
    align-items: stretch;
  }

  .toolbar-divider {
    display: none;
  }

  .editor-surface {
    min-height: 240px;
    padding: 12px;
  }

  .editor-surface :deep(img) {
    max-width: min(100%, 220px);
    max-height: 140px;
    margin: 6px 0;
  }

  .editor-foot {
    flex-direction: column;
  }

  .preview {
    padding: 12px;
  }

  :deep(.el-form-item:last-child .el-form-item__content) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  :deep(.el-form-item:last-child .el-button) {
    margin-left: 0;
  }
}
</style>
