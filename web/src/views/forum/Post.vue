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
                <span style="float:right;color:#9ca3af;font-size:12px">{{ b.readOnly ? '不可发帖' : '' }}</span>
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
          <RichTextEditor
            ref="editorRef"
            v-model="form.content"
            :max-length="CONTENT_MAX"
            :draft-key="contentDraftKey"
            @draft-restored="onContentDraftRestored"
          />
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

        <el-form-item>
          <el-button type="primary" :loading="submitting" :disabled="auth.user?.status === 'muted' || auth.user?.topicSubmissionLocked" @click="submit">{{ editingId ? '预览并保存' : '预览并发布' }}</el-button>
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
        <el-button type="warning" :loading="requestingManualReview" @click="manualReviewConfirmOpen = true">申请人工复核</el-button>
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
import { ref, reactive, computed, onBeforeUnmount, onMounted, watch } from "vue";
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
const submitting = ref(false);
const editingId = computed(() => (route.params.id ? Number(route.params.id) : null));
const CONTENT_MAX = 20000;
const editorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
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
const formDraftKey = computed(() => editingId.value ? "" : "cpu-post-new-draft");
const contentDraftKey = computed(() => formDraftKey.value ? `${formDraftKey.value}-content` : "");

const selectedCourse = computed(() => courses.value.find((c) => c.id === meta.courseId));
const teacherOptions = computed(() => selectedCourse.value?.teachers ?? []);

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

onMounted(async () => {
  boards.value = await boardApi.list();
  normalizeSelectedBoard();
  if (editingId.value) {
    const t = await topicApi.detail(editingId.value);
    form.boardSlug = t.board?.slug ?? "";
    form.title = t.title;
    form.content = t.content;
    if (t.metadata) Object.assign(meta, t.metadata);
    normalizeSelectedBoard();
  } else {
    restoreFormDraft();
  }
  normalizeSelectedBoard();
  if (boardType.value === "coursereview") await loadCoursesForReview();
});

onBeforeUnmount(() => {
  window.clearTimeout(formDraftTimer);
});

watch(boardType, async () => {
  if (boardType.value === "coursereview") await loadCoursesForReview();
});

watch(() => [form.boardSlug, form.title, meta.price, meta.condition, meta.tradeMode, meta.bounty, meta.courseId, meta.courseTeacherId, meta.teacherName, meta.semester], () => {
  scheduleFormDraftSave();
}, { deep: true });

async function loadCoursesForReview() {
  if (courses.value.length) return;
  courses.value = await courseApi.list();
}

function onBoardChange() {
  if (boardType.value === "coursereview") void loadCoursesForReview();
}

function normalizeSelectedBoard() {
  if (!form.boardSlug) return;
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

function isEditorContentEmpty() {
  return editorRef.value?.isContentEmpty() ?? !form.content.trim();
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
    if (draft.meta && typeof draft.meta === "object") Object.assign(meta, draft.meta);
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
        meta,
        savedAt: Date.now(),
      }));
    } catch {
      /* ignore */
    }
  }, 400);
}

function clearDrafts() {
  if (!formDraftKey.value) return;
  localStorage.removeItem(formDraftKey.value);
  editorRef.value?.clearDraft();
}

async function submit() {
  if (auth.user?.status === "muted") { ElMessage.warning(mutedNotice.value); return; }
  if (auth.user?.topicSubmissionLocked) { ElMessage.warning("你有内容正在人工复核，暂时不能继续提交新内容"); return; }
  if (!form.boardSlug) { ElMessage.warning("请选择板块"); return; }
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
      clearDrafts();
      ElMessage.success("已保存");
      router.replace(`/forum/topic/${editingId.value}`);
    } else {
      const r = await topicApi.create({
        boardSlug: form.boardSlug,
        title: form.title,
        content: form.content,
        metadata,
      });
      if (r.submissionResult?.status === "blocked_ai") {
        blockedTopicId.value = r.id;
        blockedReviewInfo.reason = r.submissionResult.reason || "检测到较高风险内容";
        blockedReviewInfo.riskScore = r.submissionResult.riskScore ?? null;
        reviewBlockedOpen.value = true;
        ElMessage.warning("内容暂未通过审核");
        return;
      }
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
