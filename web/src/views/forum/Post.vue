<template>
  <div class="post-page">
    <h2 class="page-title">{{ editingId ? '编辑帖子' : '发表新帖' }}</h2>

    <div v-if="loadError && !loading" class="cpu-card post-load-state">
      <el-empty :description="loadError">
        <el-button type="primary" :loading="loading" @click="loadInitial">重试</el-button>
      </el-empty>
    </div>

    <div v-else v-loading="loading" class="cpu-card form">
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
                <span style="float:right;color:#9ca3af;font-size:12px">{{ b.readOnly ? '不可发帖' : '' }}</span>
              </el-option>
            </el-option-group>
          </el-select>
          <div v-if="currentBoard" class="board-hint">
            {{ currentBoard.description }}
          </div>
        </el-form-item>

        <el-form-item v-if="currentBoard?.anonymousEnabled" label="匿名发布">
          <div class="anonymous-box" :class="{ disabled: !anonymousEnabledForForm }">
            <el-switch v-model="form.anonymous" :disabled="!anonymousEnabledForForm || !!editingId" />
            <div class="anonymous-copy">
              <b>{{ editingId ? "保持匿名状态" : "使用匿名积分发帖" }}</b>
              <p>{{ anonymousHint }}</p>
            </div>
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
            <el-select
              v-model="meta.courseId"
              filterable
              placeholder="搜课程名 / 代码"
              :loading="coursesLoading"
              :disabled="coursesLoading"
              no-data-text="暂无课程数据"
              @change="onCourseChange"
            >
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
            <div v-if="courseLoadError" class="field-error">
              <span>{{ courseLoadError }}</span>
              <button type="button" class="text-retry-btn" :disabled="coursesLoading" @click="loadCoursesForReview(true)">
                重试
              </button>
            </div>
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
                placeholder="输入老师姓名"
                maxlength="40"
                style="flex:1; min-width:160px"
                :disabled="!meta.courseId"
                @input="onTypeNewTeacher"
              />
            </div>
            <div class="cpu-muted" style="margin-top:4px">
              二选一。若列表里没有这位老师，直接在右侧输入即可。
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
          <div class="post-editor-shell">
            <div class="post-editor-toolbar">
              <div class="editor-mode-switch" role="tablist" aria-label="正文编辑模式">
                <button
                  type="button"
                  class="editor-mode-btn"
                  :class="{ active: editorMode === 'visual' }"
                  @click="setEditorMode('visual')"
                >
                  可视化编辑
                </button>
                <button
                  type="button"
                  class="editor-mode-btn"
                  :class="{ active: editorMode === 'markup' }"
                  @click="setEditorMode('markup')"
                >
                  Markdown / HTML
                </button>
              </div>
              <el-button size="small" :loading="autoFormatting" :disabled="autoFormatting" @click="autoFormatContent">
                {{ autoFormatting ? "排版中" : "AI 自动排版" }}
              </el-button>
            </div>

            <p class="editor-mode-hint">
              <template v-if="editorMode === 'visual'">
                适合直接排版、插图和视频。想写源码可切到 Markdown / HTML 高级模式。
              </template>
              <template v-else>
                高级模式支持 Markdown 和安全 HTML。切回可视化后，会按最终渲染效果继续编辑。
              </template>
            </p>

            <RichTextEditor
              v-if="editorMode === 'visual'"
              ref="editorRef"
              v-model="form.content"
              :max-length="CONTENT_MAX"
              :draft-key="contentDraftKey"
              :restore-draft="false"
            />

            <div v-else class="markup-editor-shell">
              <div class="markup-helper-row">
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupHeadingSnippet)">小标题</button>
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupQuoteSnippet)">引用</button>
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupListSnippet)">列表</button>
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupTableSnippet)">表格</button>
                <button type="button" class="markup-helper-btn" @click="insertMarkupSnippet(markupCenterSnippet)">居中 HTML</button>
              </div>
              <textarea
                ref="markupTextareaRef"
                v-model="form.content"
                class="markup-editor"
                placeholder="在这里输入 Markdown 或安全 HTML，例如标题、列表、表格、blockquote、video、img 等。"
                spellcheck="false"
              ></textarea>
              <div class="markup-meta">
                <span>支持 Markdown、表格、引用，以及安全 HTML 标签。</span>
                <span :class="{ warn: form.content.length > CONTENT_MAX }">{{ form.content.length }} / {{ CONTENT_MAX }}</span>
              </div>
              <div class="markup-preview">
                <div class="markup-preview__head">
                  <strong>实时预览</strong>
                  <span>按帖子最终展示效果渲染</span>
                </div>
                <div v-if="isMarkupContentEmpty(form.content)" class="markup-preview__empty">
                  写点内容后，这里会显示预览效果。
                </div>
                <MarkdownView v-else :content="form.content" />
              </div>
            </div>
          </div>
        </el-form-item>

        <el-alert
          v-if="auth.user?.status === 'muted'"
          type="error"
          :closable="false"
          show-icon
          :title="mutedNotice"
        />

        <el-alert
          v-if="auth.user?.topicSubmissionLocked"
          type="warning"
          :closable="false"
          show-icon
          title="你有内容正在人工复核，暂时不能继续提交新内容"
        />

        <el-form-item class="form-actions">
          <el-button type="primary" :loading="submitting" :disabled="submitDisabled" @click="submit">{{ editingId ? '预览并保存' : '预览并发布' }}</el-button>
          <el-button :disabled="submitting" @click="$router.back()">取消</el-button>
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
        <el-tag v-if="form.anonymous" type="warning" effect="plain" class="preview-anon-tag">匿名发布</el-tag>
        <h3>{{ form.title || "未填写标题" }}</h3>
        <MarkdownView :content="form.content" />
      </div>
      <template #footer>
        <el-button :disabled="submitting" @click="previewOpen = false">返回修改</el-button>
        <el-button type="primary" :loading="submitting" :disabled="submitting" @click="confirmSubmit">
          {{ editingId ? '确认保存' : '确认发布' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="reviewBlockedOpen"
      title="内容暂未通过审核"
      width="520px"
      append-to-body
    >
      <div class="review-blocked">
        <p>这条内容暂时还没有发出。</p>
        <p v-if="blockedReviewInfo.reason">审核说明：{{ blockedReviewInfo.reason }}</p>
        <p class="cpu-muted">你可以修改后再试，或申请人工复核。复核期间暂时不能继续提交新内容。</p>
      </div>
      <template #footer>
        <el-button @click="reviewBlockedOpen = false">返回修改</el-button>
        <el-button type="warning" :loading="requestingManualReview" :disabled="requestingManualReview" @click="manualReviewConfirmOpen = true">申请人工复核</el-button>
      </template>
    </el-dialog>

    <ManualReviewConfirmDialog
      v-model="manualReviewConfirmOpen"
      subject="内容"
      @confirm="confirmManualReviewRequest"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import MarkdownView from "@/components/forum/MarkdownView.vue";
import RichTextEditor from "@/components/forum/RichTextEditor.vue";
import ManualReviewConfirmDialog from "@/components/forum/ManualReviewConfirmDialog.vue";
import { boardApi, type Board } from "@/api/board";
import { topicApi } from "@/api/topic";
import { courseApi, type Course } from "@/api/course";
import { useAuthStore } from "@/stores/auth";
import { fmtDate } from "@/utils/format";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const boards = ref<Board[]>([]);
const courses = ref<Course[]>([]);
const loading = ref(false);
const loadError = ref("");
const coursesLoading = ref(false);
const coursesLoaded = ref(false);
const courseLoadError = ref("");
const submitting = ref(false);
const editingId = computed(() => (route.params.id ? Number(route.params.id) : null));
const CONTENT_MAX = 20000;
type PostEditorMode = "visual" | "markup";
const editorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const markupTextareaRef = ref<HTMLTextAreaElement | null>(null);
const editorMode = ref<PostEditorMode>("visual");
const autoFormatting = ref(false);
const previewOpen = ref(false);
const pendingMetadata = ref<any>(null);
const reviewBlockedOpen = ref(false);
const requestingManualReview = ref(false);
const manualReviewConfirmOpen = ref(false);
const blockedTopicId = ref<number | null>(null);
const blockedReviewInfo = reactive<{ reason: string; riskScore: number | null }>({
  reason: "",
  riskScore: null,
});
let formDraftTimer = 0;
let markupDraftTimer = 0;
const markupHeadingSnippet = "## 小标题\n\n";
const markupQuoteSnippet = "> 引用内容\n\n";
const markupListSnippet = "- 要点一\n- 要点二\n\n";
const markupTableSnippet = "| 项目 | 内容 |\n| --- | --- |\n| 示例 | 示例内容 |\n\n";
const markupCenterSnippet = "<div align='center'>居中文字</div>\n\n";

const form = reactive({
  boardSlug: (route.query.board as string) || "",
  title: "",
  content: "",
  anonymous: false,
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
const formDraftKey = computed(() => editingId.value ? "" : "cpu-post-new-draft");
const contentDraftKey = computed(() => formDraftKey.value ? `${formDraftKey.value}-content` : "");
const anonymousEnabledForForm = computed(() => {
  const anonymousState = auth.user?.anonymousState;
  if (!currentBoard.value?.anonymousEnabled) return false;
  if (editingId.value) return true;
  return Boolean(
    anonymousState?.eligible &&
    !anonymousState?.frozen &&
    (anonymousState?.availableCredits ?? 0) > 0
  );
});
const anonymousHint = computed(() => {
  const anonymousState = auth.user?.anonymousState;
  if (editingId.value) {
    return form.anonymous ? "这篇帖子会继续以匿名身份展示，编辑不会公开你的真实身份。" : "这篇帖子当前不是匿名帖。";
  }
  if (!currentBoard.value?.anonymousEnabled) return "当前板块暂不支持匿名发帖。";
  if (!anonymousState?.eligible) return `信誉值达到 ${anonymousState?.minReputation ?? 30} 后才能匿名发帖。`;
  if (anonymousState?.frozen) return "你的匿名积分当前已被冻结，请联系管理员处理。";
  if ((anonymousState?.availableCredits ?? 0) <= 0) return "本周匿名积分已用完，下周会自动刷新。";
  return `本周还剩 ${anonymousState?.availableCredits ?? 0} / ${anonymousState?.weeklyQuota ?? 0} 点匿名积分。`;
});

const selectedCourse = computed(() => courses.value.find((c) => c.id === meta.courseId));
const teacherOptions = computed(() => selectedCourse.value?.teachers ?? []);
const submitDisabled = computed(() =>
  submitting.value ||
  loading.value ||
  Boolean(loadError.value) ||
  auth.user?.status === "muted" ||
  Boolean(auth.user?.topicSubmissionLocked)
);

const groupedBoards = computed(() => {
  const groups: Record<string, Board[]> = { "💬 综合讨论": [], "🎒 学生共建": [], "📢 校园公告": [] };
  for (const b of boards.value) {
    if (b.type === "announce") groups["📢 校园公告"].push(b);
    else if (["market", "question", "coursereview"].includes(b.type)) groups["🎒 学生共建"].push(b);
    else groups["💬 综合讨论"].push(b);
  }
  return groups;
});
const mutedNotice = computed(() => auth.user?.mutedUntil ? `你已被禁言至 ${fmtDate(auth.user.mutedUntil)}，当前不能发帖或编辑发言内容` : "你当前已被禁言，暂时不能发帖或编辑发言内容");

onMounted(loadInitial);

onBeforeUnmount(() => {
  window.clearTimeout(formDraftTimer);
  window.clearTimeout(markupDraftTimer);
});

watch(boardType, async () => {
  if (boardType.value === "coursereview") await loadCoursesForReview();
});

watch(() => route.query.board, async (value) => {
  if (editingId.value) return;
  const nextBoard = typeof value === "string" ? value : "";
  if (!nextBoard || nextBoard === form.boardSlug) return;
  form.boardSlug = nextBoard;
  normalizeSelectedBoard();
  if (boardType.value === "coursereview") await loadCoursesForReview();
});

watch(() => currentBoard.value?.anonymousEnabled, (enabled) => {
  if (!enabled && !editingId.value) form.anonymous = false;
}, { immediate: true });

watch(anonymousEnabledForForm, (enabled) => {
  if (!enabled && !editingId.value) form.anonymous = false;
}, { immediate: true });

watch(() => [form.boardSlug, form.title, form.anonymous, meta.price, meta.condition, meta.tradeMode, meta.bounty, meta.courseId, meta.courseTeacherId, meta.teacherName, meta.semester, editorMode.value], () => {
  scheduleFormDraftSave();
}, { deep: true });

watch(() => form.content, (value) => {
  if (editorMode.value === "markup") scheduleMarkupDraftSave(value);
});

async function loadInitial() {
  loading.value = true;
  loadError.value = "";
  try {
    boards.value = await boardApi.list({ suppressErrorMessage: true });
    normalizeSelectedBoard();
    if (editingId.value) {
      const t = await topicApi.detail(editingId.value, { suppressErrorMessage: true });
      form.boardSlug = t.board?.slug ?? "";
      form.title = t.title;
      form.content = t.content;
      form.anonymous = Boolean(t.isAnonymous);
      if (t.metadata) Object.assign(meta, t.metadata);
      editorMode.value = resolveInitialEditorMode(t.content, t.metadata);
      normalizeSelectedBoard();
    } else {
      restoreFormDraft();
      restoreContentDraft();
    }
    normalizeSelectedBoard();
    if (boardType.value === "coursereview") await loadCoursesForReview();
  } catch (error) {
    loadError.value = normalizePostLoadError(error);
  } finally {
    loading.value = false;
  }
}

async function loadCoursesForReview(force = false) {
  if (coursesLoading.value || (!force && coursesLoaded.value)) return;
  coursesLoading.value = true;
  courseLoadError.value = "";
  try {
    courses.value = await courseApi.list(undefined, false, { suppressErrorMessage: true });
    coursesLoaded.value = true;
  } catch (error) {
    courses.value = [];
    coursesLoaded.value = false;
    courseLoadError.value = normalizeCourseListError(error);
  } finally {
    coursesLoading.value = false;
  }
}

function onBoardChange() {
  if (boardType.value === "coursereview") void loadCoursesForReview();
}

function getRequestStatus(error: unknown) {
  return typeof error === "object" && error !== null
    ? (error as { response?: { status?: number } }).response?.status
    : undefined;
}

function getRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function normalizePostLoadError(error: unknown) {
  const status = getRequestStatus(error);
  if (status === 401) return "登录状态已失效，请重新登录后再试";
  if (status === 403) return "你没有权限编辑这篇帖子";
  if (status === 404) return "帖子不存在或已被删除";
  return getRequestMessage(error) || "发帖页加载失败，请稍后重试";
}

function normalizeCourseListError(error: unknown) {
  const message = getRequestMessage(error);
  return message ? `课程列表加载失败：${message}` : "课程列表加载失败，请稍后重试";
}

function normalizeSelectedBoard() {
  if (!form.boardSlug) return;
  if (!boards.value.length) return;
  if (boards.value.some((b) => b.slug === form.boardSlug)) return;
  form.boardSlug = "";
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

function normalizeEditorMode(value: unknown): PostEditorMode | null {
  return value === "markup" || value === "visual" ? value : null;
}

function looksLikeHtmlContent(value: string) {
  return /<\/?(p|div|h[1-6]|ul|ol|li|blockquote|img|video|table|thead|tbody|tr|th|td|a)\b/i.test(value);
}

function looksLikeMarkdownSource(value: string) {
  return /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```|\|.+\|)|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)/m.test(value);
}

function resolveInitialEditorMode(content: string, metadata?: Record<string, any> | null): PostEditorMode {
  const saved = normalizeEditorMode(metadata?._editorMode);
  if (saved) return saved;
  if (!looksLikeHtmlContent(content) && looksLikeMarkdownSource(content)) return "markup";
  return "visual";
}

function isMarkupContentEmpty(value: string) {
  const raw = String(value || "");
  const hasMedia = /!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>|<video\b[\s\S]*?<\/video>|<source\b[^>]*>/i.test(raw);
  const text = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<video\b[\s\S]*?<\/video>/gi, " ")
    .replace(/<source\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~\-[\]()|]/g, " ")
    .replace(/\s+/g, "")
    .trim();
  return !text && !hasMedia;
}

function isEditorContentEmpty() {
  if (editorMode.value === "markup") return isMarkupContentEmpty(form.content);
  return editorRef.value?.isContentEmpty() ?? isMarkupContentEmpty(form.content);
}

function onContentDraftRestored(value: string) {
  form.content = value;
}

function restoreFormDraft() {
  if (!formDraftKey.value) return;
  try {
    const raw = localStorage.getItem(formDraftKey.value);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (typeof draft.title === "string" && !form.title) form.title = draft.title;
    if (typeof draft.boardSlug === "string" && !form.boardSlug) form.boardSlug = draft.boardSlug;
    if (typeof draft.anonymous === "boolean") form.anonymous = draft.anonymous;
    if (draft.meta && typeof draft.meta === "object") Object.assign(meta, draft.meta);
    const savedMode = normalizeEditorMode(draft.editorMode ?? draft.meta?._editorMode);
    if (savedMode) editorMode.value = savedMode;
  } catch {
    /* ignore */
  }
}

function restoreContentDraft() {
  if (!contentDraftKey.value || form.content) return;
  try {
    const raw = localStorage.getItem(contentDraftKey.value);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (typeof draft?.content === "string" && draft.content.trim()) {
      form.content = draft.content;
    }
  } catch {
    /* ignore */
  }
}

function hasSavedDraft(key: string) {
  if (!key) return false;
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
}

function scheduleFormDraftSave() {
  if (!formDraftKey.value) return;
  window.clearTimeout(formDraftTimer);
  formDraftTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(formDraftKey.value, JSON.stringify({
        boardSlug: form.boardSlug,
        title: form.title,
        anonymous: form.anonymous,
        editorMode: editorMode.value,
        meta,
        savedAt: Date.now(),
      }));
    } catch {
      /* ignore */
    }
  }, 400);
}

function scheduleMarkupDraftSave(content: string) {
  if (!contentDraftKey.value) return;
  window.clearTimeout(markupDraftTimer);
  markupDraftTimer = window.setTimeout(() => {
    try {
      if (isMarkupContentEmpty(content)) {
        localStorage.removeItem(contentDraftKey.value);
      } else {
        localStorage.setItem(contentDraftKey.value, JSON.stringify({
          content,
          savedAt: Date.now(),
        }));
      }
    } catch {
      /* ignore */
    }
  }, 400);
}

function clearDrafts() {
  if (!formDraftKey.value) return;
  localStorage.removeItem(formDraftKey.value);
  if (contentDraftKey.value) localStorage.removeItem(contentDraftKey.value);
  editorRef.value?.clearDraft();
}

function setEditorMode(nextMode: PostEditorMode) {
  if (editorMode.value === nextMode) return;
  editorMode.value = nextMode;
  scheduleFormDraftSave();
  if (nextMode === "markup") scheduleMarkupDraftSave(form.content);
}

async function insertMarkupSnippet(snippet: string) {
  const textarea = markupTextareaRef.value;
  if (!textarea) {
    form.content = `${form.content}${snippet}`;
    return;
  }
  const start = textarea.selectionStart ?? form.content.length;
  const end = textarea.selectionEnd ?? start;
  const nextContent = `${form.content.slice(0, start)}${snippet}${form.content.slice(end)}`;
  form.content = nextContent;
  await nextTick();
  textarea.focus();
  const cursor = start + snippet.length;
  textarea.setSelectionRange(cursor, cursor);
}

async function autoFormatContent() {
  if (autoFormatting.value) return;
  if (isMarkupContentEmpty(form.content)) {
    ElMessage.warning("先写一点正文，再试试自动排版");
    return;
  }
  autoFormatting.value = true;
  try {
    const result = await topicApi.autoFormat({
      title: form.title.trim() || undefined,
      content: form.content,
      boardSlug: form.boardSlug || undefined,
      editorMode: editorMode.value,
    });
    form.content = result.content;
    if (editorMode.value === "markup") scheduleMarkupDraftSave(result.content);
    if (result.provider === "ai") {
      ElMessage.success(result.summary || "AI 已完成自动排版");
    } else {
      ElMessage.info(result.summary || "AI 当前不可用，已按本地规则整理排版");
    }
  } finally {
    autoFormatting.value = false;
  }
}

async function submit() {
  if (submitting.value) return;
  if (loading.value) { ElMessage.warning("页面还在加载，请稍后再试"); return; }
  if (loadError.value) { ElMessage.warning("页面加载失败，请重试后再发布"); return; }
  if (auth.user?.status === "muted") { ElMessage.warning(mutedNotice.value); return; }
  if (auth.user?.topicSubmissionLocked) { ElMessage.warning("你有内容正在人工复核，暂时不能继续提交新内容"); return; }
  if (!form.boardSlug) { ElMessage.warning("请选择板块"); return; }
  if (form.anonymous && !anonymousEnabledForForm.value) { ElMessage.warning(anonymousHint.value); return; }
  if (form.title.trim().length < 2) { ElMessage.warning("标题至少 2 字"); return; }
  if (isEditorContentEmpty()) { ElMessage.warning("请填写正文"); return; }
  if (form.content.length > CONTENT_MAX) { ElMessage.warning("正文内容过长，请精简后再发布"); return; }
  const metadata = buildMetadata();
  if (!metadata) return;
  pendingMetadata.value = metadata;
  previewOpen.value = true;
}

function buildMetadata() {
  // 组织 metadata
  const metadata: any = {
    _editorMode: editorMode.value,
  };
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
  if (submitting.value) return;
  const metadata = pendingMetadata.value;
  if (!metadata) return;
  submitting.value = true;
  try {
    if (editingId.value) {
      const r = await topicApi.update(editingId.value, {
        title: form.title,
        content: form.content,
        metadata,
      });
      if (r.submissionResult?.status === "blocked_ai") {
        blockedTopicId.value = editingId.value;
        blockedReviewInfo.reason = r.submissionResult.reason || "检测到较高风险内容";
        blockedReviewInfo.riskScore = r.submissionResult.riskScore ?? null;
        reviewBlockedOpen.value = true;
        ElMessage.warning("修改后的内容暂未通过审核");
        return;
      }
      notifyImageReviewState(r.submissionResult?.imageReview);
      notifyVideoReviewState(r.submissionResult?.videoReview);
      clearDrafts();
      ElMessage.success("已保存");
      router.replace(`/forum/topic/${editingId.value}`);
    } else {
      const r = await topicApi.create({
        boardSlug: form.boardSlug,
        title: form.title,
        content: form.content,
        metadata,
        anonymous: form.anonymous,
      });
      if (form.anonymous) await auth.fetchMe();
      if (r.submissionResult?.status === "blocked_ai") {
        blockedTopicId.value = r.id;
        blockedReviewInfo.reason = r.submissionResult.reason || "检测到较高风险内容";
        blockedReviewInfo.riskScore = r.submissionResult.riskScore ?? null;
        reviewBlockedOpen.value = true;
        ElMessage.warning("内容暂未通过审核");
        return;
      }
      notifyImageReviewState(r.submissionResult?.imageReview);
      notifyVideoReviewState(r.submissionResult?.videoReview);
      clearDrafts();
      ElMessage.success("已发布");
      router.replace(`/forum/topic/${r.id}`);
    }
  } finally {
    submitting.value = false;
    previewOpen.value = false;
  }
}

async function confirmManualReviewRequest() {
  if (!blockedTopicId.value) return;
  requestingManualReview.value = true;
  try {
    await topicApi.requestManualReview(blockedTopicId.value);
    await auth.fetchMe();
    clearDrafts();
    reviewBlockedOpen.value = false;
    ElMessage.success("已提交人工复核申请");
    router.replace("/forum");
  } finally {
    requestingManualReview.value = false;
  }
}

function notifyImageReviewState(summary?: { enabled: boolean; totalCount: number; pendingCount: number; rejectedCount: number } | null) {
  if (!summary?.totalCount) return;
  if (!summary.enabled) {
    ElMessage.info(`本次包含 ${summary.totalCount} 张图片。当前图片审核未启用，图片会直接展示。`);
    return;
  }
  if (summary.pendingCount > 0) {
    ElMessage.info(`已提交 ${summary.pendingCount} 张图片审核，审核通过后才会显示原图。`);
  }
}

function notifyVideoReviewState(summary?: {
  enabled: boolean;
  totalCount: number;
  pendingCount: number;
  rejectedCount: number;
  manualReviewCount: number;
} | null) {
  if (!summary?.totalCount) return;
  if (!summary.enabled) {
    ElMessage.info(`本次包含 ${summary.totalCount} 个视频。当前视频审核未启用，视频会直接展示。`);
    return;
  }
  if (summary.manualReviewCount > 0) {
    ElMessage.warning(`有 ${summary.manualReviewCount} 个视频进入人工复核，当前会先隐藏。`);
    return;
  }
  if (summary.pendingCount > 0) {
    ElMessage.info(`已提交 ${summary.pendingCount} 个视频审核，审核通过后才会显示。`);
  }
}
</script>

<style scoped>
.post-page { display: flex; flex-direction: column; gap: 16px; }
.page-title { margin: 0; font-size: 22px; }
.cpu-card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); }
.post-load-state { min-height: 280px; display: grid; place-items: center; }

.post-editor-shell {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.post-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.editor-mode-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: #f4f7fb;
  border: 1px solid #dfe8f2;
}

.editor-mode-btn {
  border: 0;
  background: transparent;
  color: #64748b;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

.editor-mode-btn.active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
}

.editor-mode-hint {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.7;
}

.markup-editor-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid #d8e2ec;
  border-radius: 16px;
  padding: 14px;
  background: linear-gradient(180deg, #fbfdff 0%, #f7fafc 100%);
}

.markup-helper-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.markup-helper-btn {
  border: 1px solid #d7e1eb;
  background: #fff;
  color: #334155;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}

.markup-editor {
  width: 100%;
  min-height: 320px;
  resize: vertical;
  border: 1px solid #d7e1eb;
  border-radius: 14px;
  padding: 14px 16px;
  background: #0f172a;
  color: #e2e8f0;
  font: 13px/1.75 "Consolas", "SFMono-Regular", "Courier New", monospace;
  outline: none;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.18);
}

.markup-editor::placeholder {
  color: #94a3b8;
}

.markup-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #64748b;
  font-size: 12px;
}

.markup-meta .warn {
  color: #dc2626;
  font-weight: 600;
}

.markup-preview {
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  background: #fff;
  padding: 14px;
}

.markup-preview__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: #64748b;
  font-size: 12px;
}

.markup-preview__head strong {
  color: #0f172a;
  font-size: 14px;
}

.markup-preview__empty {
  border-radius: 12px;
  padding: 20px 16px;
  background: #f8fafc;
  color: #94a3b8;
  font-size: 13px;
  text-align: center;
}

.markup-preview :deep(.md) {
  padding: 0;
}

.board-hint { font-size: 12px; color: #6b7280; margin-top: 6px; }
.field-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: #dc2626;
  font-size: 12px;
  line-height: 1.5;
}

.text-retry-btn {
  border: 0;
  background: transparent;
  color: #2563eb;
  padding: 0;
  font-size: 12px;
  cursor: pointer;
}

.text-retry-btn:disabled {
  color: #9ca3af;
  cursor: not-allowed;
}

.text-retry-btn:focus-visible {
  outline: 2px solid rgba(37, 99, 235, 0.32);
  outline-offset: 2px;
  border-radius: 4px;
}

.anonymous-box {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid #ebe8ff;
  background: linear-gradient(180deg, #faf7ff 0%, #ffffff 100%);
}

.anonymous-box.disabled {
  opacity: 0.78;
}

.anonymous-copy b {
  display: block;
  font-size: 14px;
  color: #4c1d95;
  margin-bottom: 4px;
}

.anonymous-copy p {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
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

.preview-anon-tag {
  margin-bottom: 10px;
}

.publish-preview :deep(.md) {
  max-height: min(58dvh, 520px);
  overflow: auto;
  padding: 12px;
  border: 1px solid #edf0f5;
  border-radius: 8px;
  background: #fff;
}

.cpu-muted { font-size: 12px; color: #9ca3af; }
.review-blocked p { margin: 0 0 10px; line-height: 1.7; color: #374151; }
.review-blocked p:last-child { margin-bottom: 0; }

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

  .post-editor-toolbar,
  .markup-meta,
  .markup-preview__head {
    align-items: stretch;
    flex-direction: column;
  }

  .editor-mode-switch {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .editor-mode-btn {
    width: 100%;
    text-align: center;
  }

  .markup-editor-shell {
    padding: 12px;
  }

  .markup-helper-row {
    gap: 6px;
  }

  .markup-helper-btn {
    flex: 1 1 calc(50% - 6px);
    text-align: center;
  }

  .markup-editor {
    min-height: 260px;
    padding: 12px;
  }

  .anonymous-box {
    padding: 12px;
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

  .field-error {
    align-items: flex-start;
    flex-direction: column;
  }

  .form-actions :deep(.el-form-item__content) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .form-actions :deep(.el-button) {
    margin-left: 0;
  }

  :global(.publish-preview-dialog) {
    width: calc(100dvw - 24px) !important;
    max-width: calc(100dvw - 24px) !important;
  }
}
</style>
