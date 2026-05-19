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
              <button type="button" title="正文" @click="applyFormat('p')">正文</button>
              <button type="button" title="二级标题" @click="applyFormat('h2')">H2</button>
              <button type="button" title="三级标题" @click="applyFormat('h3')">H3</button>
              <span class="toolbar-divider" />
              <button type="button" title="加粗" class="bold" @click="runCommand('bold')">B</button>
              <button type="button" title="斜体" class="italic" @click="runCommand('italic')">I</button>
              <button type="button" title="引用" @click="applyFormat('blockquote')">引用</button>
              <span class="toolbar-divider" />
              <button type="button" title="无序列表" @click="runCommand('insertUnorderedList')">列表</button>
              <button type="button" title="有序列表" @click="runCommand('insertOrderedList')">编号</button>
              <button type="button" title="插入链接" @click="insertLink">链接</button>
              <button type="button" title="上传图片" :disabled="imageUploading" @click="pickContentImage">
                {{ imageUploading ? "上传中" : "图片" }}
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
              @mouseup="rememberSelection"
              @keyup="rememberSelection"
              @focus="rememberSelection"
            ></div>
            <div class="editor-foot">
              <span>可直接排版，不需要手写 Markdown。</span>
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

        <el-form-item v-if="form.content">
          <div class="preview">
            <h4>发布后效果</h4>
            <MarkdownView :content="form.content" />
          </div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="submit">{{ editingId ? '保存修改' : '发布帖子' }}</el-button>
          <el-button @click="$router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, reactive, computed, onMounted, watch } from "vue";
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
  courses.value = await courseApi.list();
  if (editingId.value) {
    const t = await topicApi.detail(editingId.value);
    form.boardSlug = t.board?.slug ?? "";
    form.title = t.title;
    form.content = t.content;
    if (t.metadata) Object.assign(meta, t.metadata);
    await nextTick();
    hydrateEditor();
  }
  await nextTick();
  hydrateEditor();
});

watch(boardType, () => {
  if (boardType.value === "coursereview" && !courses.value.length) {
    courseApi.list().then((r) => (courses.value = r));
  }
});

function onBoardChange() { /* 切换时不重置 meta，让用户自由 */ }

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
      insertHtmlAtCursor(`<p><img src="${escapeAttr(url)}" alt="${escapeAttr(file.name || "图片")}" /></p>`);
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

  // 组织 metadata
  const metadata: any = {};
  if (boardType.value === "market") {
    if (!meta.price && meta.price !== 0) { ElMessage.warning("请填写价格"); return; }
    metadata.price = meta.price;
    metadata.condition = meta.condition;
    metadata.tradeMode = meta.tradeMode;
  } else if (boardType.value === "question") {
    metadata.bounty = meta.bounty;
    metadata.resolved = false;
  } else if (boardType.value === "coursereview") {
    if (!meta.courseId) { ElMessage.warning("请选择课程"); return; }
    if (!meta.courseTeacherId && !meta.teacherName?.trim()) {
      ElMessage.warning("请选择或填写授课老师");
      return;
    }
    metadata.courseId = meta.courseId;
    if (meta.courseTeacherId) metadata.courseTeacherId = meta.courseTeacherId;
    else metadata.teacherName = meta.teacherName.trim();
    metadata.ratings = meta.ratings;
    if (meta.semester) metadata.semester = meta.semester;
  }

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
  } finally { submitting.value = false; }
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
  border: 1px solid #dcdfe6;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid #edf0f5;
  background: #f8fafc;
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
  min-height: 30px;
  padding: 0 9px;
}

.editor-toolbar button:hover {
  border-color: var(--cpu-primary);
  color: var(--cpu-primary);
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
  display: block;
  max-width: 100%;
  border-radius: 8px;
  margin: 8px 0;
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

  .editor-toolbar button {
    min-height: 34px;
  }

  .toolbar-divider {
    display: none;
  }

  .editor-surface {
    min-height: 240px;
    padding: 12px;
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
