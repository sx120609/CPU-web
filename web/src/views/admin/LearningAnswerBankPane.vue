<template>
  <div class="answer-bank-pane">
    <div class="overview-grid" v-loading="overviewLoading">
      <div class="overview-card">
        <span>收录题目</span>
        <strong>{{ overview.entries }}</strong>
        <small>AI {{ overview.bySource.ai ?? 0 }} · 申诉改正 {{ overview.bySource.appeal ?? 0 }} · 手工改正 {{ overview.bySource.admin ?? 0 }}</small>
      </div>
      <div class="overview-card">
        <span>命中次数</span>
        <strong>{{ overview.hits }}</strong>
        <small>每次命中都少调用一次模型</small>
      </div>
      <div class="overview-card">
        <span>申诉</span>
        <strong>{{ appealTotal }}</strong>
        <small>成立 {{ overview.appeals["claim-correct"] ?? 0 }} · 都不对 {{ overview.appeals["both-wrong"] ?? 0 }} · 驳回 {{ overview.appeals["original-correct"] ?? 0 }} · 无结论 {{ overview.appeals.inconclusive ?? 0 }}</small>
      </div>
      <div class="overview-card">
        <span>申诉返还</span>
        <strong>{{ overview.refundedPoints }}</strong>
        <small>点</small>
      </div>
    </div>

    <section class="settings-card">
      <div class="section-head">
        <div>
          <h3>学习通题库</h3>
          <p>单选、多选、判断、填空题的 AI 答案在第一次作答后收录，之后同一道题直接返回这份答案、不再调用模型（仍照常扣额度）。申诉成立会自动改正；这里可以手工改正或删除，删除后下次有人做到这道题会重新问 AI。</p>
        </div>
        <el-button :icon="Refresh" :loading="loading || overviewLoading" @click="reloadAll">刷新</el-button>
      </div>

      <div class="filters">
        <el-input
          v-model="filters.q"
          clearable
          placeholder="搜索题干或选项"
          class="filter-search"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="filters.type" placeholder="全部题型" class="filter-select" @change="applyFilters">
          <el-option label="全部题型" value="" />
          <el-option v-for="(label, key) in TYPE_LABELS" :key="key" :label="label" :value="key" />
        </el-select>
        <el-select v-model="filters.source" placeholder="全部来源" class="filter-select" @change="applyFilters">
          <el-option label="全部来源" value="" />
          <el-option v-for="(label, key) in SOURCE_LABELS" :key="key" :label="label" :value="key" />
        </el-select>
        <el-checkbox v-model="appealedOnly" @change="applyFilters">只看被申诉过的</el-checkbox>
      </div>

      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="pane-alert" />

      <el-table :data="rows" v-loading="loading" empty-text="还没有收录的题目" class="bank-table">
        <el-table-column label="题目" min-width="320">
          <template #default="{ row }">
            <div class="question-cell">
              <div class="question-meta">
                <el-tag size="small" effect="plain">{{ TYPE_LABELS[row.questionType] ?? row.questionType }}</el-tag>
                <span v-if="row.imageCount">含 {{ row.imageCount }} 张图</span>
              </div>
              <p class="question-text">{{ row.questionText || "（旧记录没有保存题目文字）" }}</p>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="答案" min-width="160">
          <template #default="{ row }">
            <b class="answer-text">{{ row.answer || "（空）" }}</b>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="104">
          <template #default="{ row }">
            <el-tag size="small" effect="light" :type="sourceType(row.source)">{{ SOURCE_LABELS[row.source] ?? row.source }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="命中" width="76" align="right" prop="hitCount" />
        <el-table-column label="申诉" width="76" align="right">
          <template #default="{ row }">
            <el-button v-if="row.appealCount" link type="primary" @click="openAppeals(row)">{{ row.appealCount }}</el-button>
            <span v-else class="muted">0</span>
          </template>
        </el-table-column>
        <el-table-column label="更新" width="150">
          <template #default="{ row }"><span class="muted">{{ fmtDate(row.updatedAt) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="128" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button link type="primary" @click="openEditor(row)">改正</el-button>
              <el-button link type="danger" @click="removeEntry(row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="total > size"
        v-model:current-page="page"
        :page-size="size"
        :total="total"
        layout="total, prev, pager, next"
        class="pager"
        @current-change="load"
      />
    </section>

    <el-dialog v-model="editorOpen" title="改正答案" width="min(560px, 94vw)" destroy-on-close>
      <template v-if="editing">
        <p class="dialog-question">{{ editing.questionText }}</p>
        <el-form label-position="top">
          <el-form-item :label="`答案（${ANSWER_HINTS[editing.questionType] ?? ''}）`">
            <el-input v-model="editorForm.answer" maxlength="2000" />
          </el-form-item>
          <el-form-item label="解题依据">
            <el-input v-model="editorForm.explanation" type="textarea" :rows="4" maxlength="4000" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="editorOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!editorForm.answer.trim()" @click="saveEditor">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="appealsOpen" title="申诉记录" width="min(880px, 94vw)" style="--cpu-dialog-max-width: 880px" destroy-on-close>
      <p v-if="appealsFor" class="dialog-question">{{ appealsFor.questionText }}</p>
      <el-table :data="appeals" v-loading="appealsLoading" empty-text="没有申诉记录">
        <el-table-column label="用户" min-width="120">
          <template #default="{ row }">{{ row.user?.nickname || row.user?.username || `用户 ${row.userId}` }}</template>
        </el-table-column>
        <el-table-column label="原答案" prop="originalAnswer" min-width="90" />
        <el-table-column label="申诉答案" prop="claimedAnswer" min-width="90" />
        <el-table-column label="复核答案" prop="judgedAnswer" min-width="90" />
        <el-table-column label="判决" width="104">
          <template #default="{ row }">
            <el-tag size="small" :type="verdictType(row.verdict)">{{ VERDICT_LABELS[row.verdict] ?? row.verdict }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="返还" width="64" align="right">
          <template #default="{ row }">{{ row.refundPoints }}</template>
        </el-table-column>
        <el-table-column label="时间" width="150">
          <template #default="{ row }"><span class="muted">{{ fmtDate(row.createdAt) }}</span></template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh, Search } from "@element-plus/icons-vue";
import {
  adminApi,
  type LearningAnswerAppealRecord,
  type LearningAnswerBankEntry,
  type LearningAnswerBankOverview,
  type LearningAnswerBankSource,
  type LearningAnswerBankType,
} from "@/api/admin";
import { fmtDate } from "@/utils/format";

const TYPE_LABELS: Record<string, string> = { single: "单选", multiple: "多选", judgement: "判断", blank: "填空" };
const SOURCE_LABELS: Record<string, string> = { ai: "AI 作答", appeal: "申诉改正", admin: "手工改正" };
const ANSWER_HINTS: Record<string, string> = {
  single: "学习通填选项字母，如 B",
  multiple: "学习通填全部选项字母，如 ACD",
  judgement: "填 正确 或 错误",
  blank: "多个空用 | 分隔",
};
const VERDICT_LABELS: Record<string, string> = {
  pending: "复核中",
  "claim-correct": "申诉成立",
  "both-wrong": "都不对",
  "original-correct": "驳回",
  inconclusive: "无结论",
};

const overviewLoading = ref(false);
const overview = ref<LearningAnswerBankOverview>({ entries: 0, bySource: {}, hits: 0, appeals: {}, refundedPoints: 0 });
const appealTotal = computed(() => Object.values(overview.value.appeals).reduce((sum, count) => sum + (count ?? 0), 0));

const loading = ref(false);
const error = ref("");
const rows = ref<LearningAnswerBankEntry[]>([]);
const total = ref(0);
const page = ref(1);
const size = 20;
const filters = reactive<{ q: string; type: LearningAnswerBankType | ""; source: LearningAnswerBankSource | "" }>({ q: "", type: "", source: "" });
const appealedOnly = ref(false);

async function loadOverview() {
  overviewLoading.value = true;
  try {
    overview.value = await adminApi.learningAnswerBankOverview();
  } catch {
    // 统计拿不到不影响下面的列表
  } finally {
    overviewLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await adminApi.learningAnswerBank({
      q: filters.q.trim() || undefined,
      type: filters.type,
      source: filters.source,
      appealed: appealedOnly.value ? "yes" : "",
      page: page.value,
      size,
    });
    rows.value = result.items;
    total.value = result.total;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "题库加载失败";
  } finally {
    loading.value = false;
  }
}

function applyFilters() {
  page.value = 1;
  void load();
}

function reloadAll() {
  void loadOverview();
  void load();
}

function sourceType(source: string) {
  if (source === "appeal") return "success";
  if (source === "admin") return "warning";
  return "info";
}

function verdictType(verdict: string) {
  if (verdict === "claim-correct") return "success";
  if (verdict === "both-wrong") return "warning";
  if (verdict === "original-correct") return "danger";
  return "info";
}

const editorOpen = ref(false);
const editing = ref<LearningAnswerBankEntry | null>(null);
const editorForm = reactive({ answer: "", explanation: "" });
const saving = ref(false);

function openEditor(row: LearningAnswerBankEntry) {
  editing.value = row;
  editorForm.answer = row.answer;
  editorForm.explanation = row.explanation;
  editorOpen.value = true;
}

async function saveEditor() {
  if (!editing.value) return;
  saving.value = true;
  try {
    await adminApi.updateLearningAnswerBankEntry(editing.value.id, { answer: editorForm.answer.trim(), explanation: editorForm.explanation.trim() });
    ElMessage.success("答案已改正，之后做到这道题会拿到新答案");
    editorOpen.value = false;
    reloadAll();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

async function removeEntry(row: LearningAnswerBankEntry) {
  const confirmed = await ElMessageBox.confirm(
    "删除后这道题的申诉记录一并删除，下次有人做到会重新问 AI。是否继续？",
    "删除题目",
    { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;
  try {
    await adminApi.deleteLearningAnswerBankEntry(row.id);
    ElMessage.success("已删除");
    if (rows.value.length === 1 && page.value > 1) page.value -= 1;
    reloadAll();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "删除失败");
  }
}

const appealsOpen = ref(false);
const appealsFor = ref<LearningAnswerBankEntry | null>(null);
const appeals = ref<LearningAnswerAppealRecord[]>([]);
const appealsLoading = ref(false);

async function openAppeals(row: LearningAnswerBankEntry) {
  appealsFor.value = row;
  appeals.value = [];
  appealsOpen.value = true;
  appealsLoading.value = true;
  try {
    appeals.value = await adminApi.learningAnswerAppeals(row.id);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "申诉记录加载失败");
  } finally {
    appealsLoading.value = false;
  }
}

onMounted(reloadAll);
</script>

<style scoped>
.answer-bank-pane {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.overview-card,
.settings-card {
  border: 1px solid var(--cpu-border);
  border-radius: 16px;
  background: var(--cpu-card);
}
.overview-card {
  display: grid;
  gap: 4px;
  padding: 16px 18px;
}
.overview-card span,
.overview-card small {
  color: var(--cpu-text-muted);
  font-size: 12px;
}
.overview-card span {
  font-size: 13px;
}
.overview-card strong {
  color: var(--cpu-primary);
  font-size: 24px;
}
.settings-card {
  padding: 20px;
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
}
.section-head h3 {
  margin: 0 0 6px;
  color: var(--cpu-text);
  font-size: 18px;
}
.section-head p {
  margin: 0;
  color: var(--cpu-text-muted);
  font-size: 13px;
  line-height: 1.7;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.filter-search {
  width: 260px;
}
.filter-select {
  width: 130px;
}
.pane-alert {
  margin-bottom: 12px;
}
.question-cell {
  display: grid;
  gap: 6px;
}
.question-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--cpu-text-muted);
  font-size: 12px;
}
.question-text,
.dialog-question {
  margin: 0;
  color: var(--cpu-text);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.question-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}
.dialog-question {
  max-height: 180px;
  overflow: auto;
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--cpu-surface-soft);
}
.answer-text {
  color: var(--cpu-text);
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
}
.muted {
  color: var(--cpu-text-muted);
  font-size: 12px;
}
.row-actions {
  display: flex;
  gap: 4px;
}
.pager {
  justify-content: flex-end;
  margin-top: 14px;
}
@media (max-width: 960px) {
  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .section-head {
    flex-direction: column;
  }
  .filter-search,
  .filter-select {
    width: 100%;
  }
}
</style>
