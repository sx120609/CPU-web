<template>
  <div class="pk-page grade-lookup-page" :aria-busy="loading">
    <router-link class="pk-back" to="/services/tools/grade_check"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>成绩表核对</router-link>
    <section class="grade-sheet" v-loading="loading">
      <el-empty v-if="loadError && !loading" :description="loadError">
        <el-button type="primary" :loading="loading" @click="load">重新查询</el-button>
      </el-empty>

      <template v-else-if="lookup">
        <header class="pk-title lookup-head">
          <span class="pk-tile" style="--tone: #2563eb" aria-hidden="true"><el-icon><DataLine /></el-icon></span>
          <div class="pk-title-copy">
            <h1>{{ lookup.table.title }}<em class="pk-badge is-primary">成绩核对单</em></h1>
            <p>{{ lookup.table.description || "请核对下方项目。若存在问题，请在底部提交反馈。" }}</p>
          </div>
          <button v-if="lookup.canManage" data-cpu-button="surface" type="button" class="pk-pill" @click="openManage">进入管理</button>
        </header>

        <template v-if="lookup.row">
          <section class="record-panel">
            <div class="panel-head">
              <div>
                <h3>核对项目</h3>
                <span>只显示与你学号匹配的一行</span>
              </div>
            </div>
            <div class="record-list">
              <div v-for="column in lookup.table.columns" :key="column" class="record-row">
                <span>{{ column }}</span>
                <b>{{ lookup.row[column] || "-" }}</b>
              </div>
            </div>
          </section>

          <section class="feedback-panel">
            <div class="panel-head">
              <div>
                <h3>问题反馈</h3>
                <span>信息无误可不填写</span>
              </div>
            </div>
            <div v-if="feedbackQuestionnaire" class="feedback-body">
              <el-form class="feedback-form" label-position="top" @submit.prevent="submitFeedback">
                <el-form-item
                  v-for="field in feedbackQuestionnaire.fields || []"
                  :key="field.id"
                  :label="field.label"
                  :required="field.required"
                >
                  <el-input
                    v-if="field.type === 'text'"
                    v-model="feedbackAnswers[field.id] as string"
                    :maxlength="field.maxLength || 300"
                    :placeholder="field.placeholder"
                    clearable
                    :disabled="feedbackSubmitting"
                  />
                  <el-input
                    v-else-if="field.type === 'textarea'"
                    v-model="feedbackAnswers[field.id] as string"
                    type="textarea"
                    :rows="4"
                    :maxlength="field.maxLength || 2000"
                    show-word-limit
                    :placeholder="field.placeholder"
                    :disabled="feedbackSubmitting"
                  />
                  <el-radio-group v-else-if="field.type === 'single'" v-model="feedbackAnswers[field.id] as string" class="option-list" :disabled="feedbackSubmitting">
                    <el-radio v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-radio>
                  </el-radio-group>
                  <el-checkbox-group v-else-if="field.type === 'multiple'" :model-value="multiValue(field.id)" class="option-list" :disabled="feedbackSubmitting" @change="setMulti(field.id, $event)">
                    <el-checkbox v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-checkbox>
                  </el-checkbox-group>
                </el-form-item>
                <div class="feedback-actions">
                  <el-button type="primary" native-type="submit" :loading="feedbackSubmitting" :disabled="feedbackSubmitting">提交反馈</el-button>
                </div>
              </el-form>
            </div>
            <div v-else-if="feedbackLoading" class="feedback-loading">正在准备反馈问卷...</div>
            <div v-else class="feedback-state" :class="{ error: Boolean(feedbackError) }">
              <span>{{ feedbackError || feedbackEmptyText }}</span>
              <el-button
                v-if="feedbackError"
                plain
                size="small"
                :loading="feedbackLoading"
                @click="loadFeedbackQuestionnaire"
              >
                重试
              </el-button>
            </div>
          </section>
        </template>

        <el-empty v-else description="未找到与你学号匹配的信息">
          <el-button plain :loading="loading" @click="load">重新查询</el-button>
        </el-empty>
      </template>

      <el-empty v-else-if="!loading" description="查询表不存在或暂未开放">
        <el-button type="primary" @click="$router.push('/services/tools/grade_check')">返回成绩表核对</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, DataLine } from "@element-plus/icons-vue";
import "@/styles/page-kit.css";
import { ElMessage } from "element-plus";
import { getToken } from "@/api/request";
import { toolsApi, type GradeCheckLookup, type Questionnaire } from "@/api/tools";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const loadError = ref("");
const feedbackLoading = ref(false);
const feedbackError = ref("");
const feedbackEmptyText = ref("");
const feedbackSubmitting = ref(false);
const lookup = ref<GradeCheckLookup | null>(null);
const feedbackQuestionnaire = ref<Questionnaire | null>(null);
const feedbackAnswers = reactive<Record<string, string | string[]>>({});
let loadSeq = 0;
let feedbackLoadSeq = 0;

watch(() => route.params.slug, () => {
  void load();
}, { immediate: true });

async function load() {
  const seq = ++loadSeq;
  const slug = String(route.params.slug || "").trim();
  loading.value = true;
  loadError.value = "";
  lookup.value = null;
  resetFeedbackState(true);
  if (!slug) {
    loadError.value = "成绩核对单地址无效";
    loading.value = false;
    return;
  }
  try {
    const next = await toolsApi.gradeCheck(slug, { suppressErrorMessage: true });
    if (seq !== loadSeq) return;
    lookup.value = next;
    await loadFeedbackQuestionnaire();
  } catch (error) {
    if (seq !== loadSeq) return;
    loadError.value = normalizeLookupError(error);
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

async function loadFeedbackQuestionnaire() {
  const seq = ++feedbackLoadSeq;
  resetFeedbackState();
  const currentLookup = lookup.value;
  const slug = currentLookup?.feedbackQuestionnaireSlug || currentLookup?.table.feedbackQuestionnaireSlug;
  if (!slug) {
    feedbackEmptyText.value = "当前核对单未配置反馈问卷";
    return;
  }
  feedbackLoading.value = true;
  try {
    const next = await toolsApi.questionnaire(slug, { suppressErrorMessage: true });
    if (seq !== feedbackLoadSeq) return;
    feedbackQuestionnaire.value = next;
    for (const field of next.fields ?? []) {
      if (field.type === "multiple") feedbackAnswers[field.id] = [];
      else if (field.id === "student_id") feedbackAnswers[field.id] = currentLookup?.studentId ?? "";
      else feedbackAnswers[field.id] = "";
    }
  } catch (error) {
    if (seq !== feedbackLoadSeq) return;
    feedbackError.value = normalizeFeedbackError(error);
  } finally {
    if (seq === feedbackLoadSeq) feedbackLoading.value = false;
  }
}

function resetFeedbackState(invalidate = false) {
  if (invalidate) feedbackLoadSeq += 1;
  feedbackQuestionnaire.value = null;
  feedbackError.value = "";
  feedbackEmptyText.value = "";
  feedbackLoading.value = false;
  Object.keys(feedbackAnswers).forEach((key) => delete feedbackAnswers[key]);
}

function requestStatus(error: unknown) {
  return typeof error === "object" && error !== null
    ? (error as { response?: { status?: number } }).response?.status
    : undefined;
}

function requestMessage(error: unknown) {
  if (typeof error !== "object" || error === null) return "";
  const responseMessage = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
  if (typeof responseMessage === "string") return responseMessage;
  return error instanceof Error ? error.message : "";
}

function normalizeLookupError(error: unknown) {
  const status = requestStatus(error);
  if (status === 401) return "请先登录后再查看成绩核对单";
  if (status === 403) return "你没有权限查看这张成绩核对单";
  if (status === 404) return "查询表不存在或暂未开放";
  return requestMessage(error) || "成绩核对单加载失败，请稍后重试";
}

function normalizeFeedbackError(error: unknown) {
  const status = requestStatus(error);
  if (status === 404) return "反馈问卷不存在或暂未开放";
  return requestMessage(error) || "反馈问卷加载失败，请稍后重试";
}

function multiValue(fieldId: string) {
  return Array.isArray(feedbackAnswers[fieldId]) ? feedbackAnswers[fieldId] as string[] : [];
}

function setMulti(fieldId: string, value: unknown) {
  feedbackAnswers[fieldId] = Array.isArray(value) ? value.map(String) : [];
}

function hasAnswer(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value ?? "").trim());
}

function openManage() {
  router.push({ path: "/services/tools/manage", query: { tool: "grade_check" } });
}

async function submitFeedback() {
  if (feedbackSubmitting.value) return;
  if (!feedbackQuestionnaire.value) return;
  if (!getToken()) {
    ElMessage.warning("请先登录后再提交反馈");
    return;
  }
  const missing = (feedbackQuestionnaire.value.fields ?? []).find((field) => field.required && !hasAnswer(feedbackAnswers[field.id]));
  if (missing) {
    ElMessage.warning(`请填写：${missing.label}`);
    return;
  }
  feedbackSubmitting.value = true;
  try {
    await toolsApi.submitResponse(feedbackQuestionnaire.value.slug, feedbackAnswers, {
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    ElMessage.success("反馈已提交");
    await loadFeedbackQuestionnaire();
  } catch (e) {
    const status = (e as { response?: { status?: number; data?: { message?: string } } }).response?.status;
    if (status === 401) {
      ElMessage.warning("登录状态已过期，请重新登录后再提交反馈");
      return;
    }
    const message = (e as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message
      ?? (e as { message?: string }).message
      ?? "提交失败，请稍后再试";
    ElMessage.error(message);
  } finally {
    feedbackSubmitting.value = false;
  }
}
</script>

<style scoped>
.grade-sheet { display: flex; min-height: 160px; flex-direction: column; gap: 16px; }
.lookup-head { padding: 0 2px; }
.record-panel,
.feedback-panel {
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  overflow: hidden;
  box-shadow: var(--cpu-shadow-sm);
}
.feedback-panel {
  margin-top: 16px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 18px;
  border-bottom: 1px solid var(--cpu-border-soft);
  background: var(--cpu-surface-subtle);
}
.panel-head h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: var(--cpu-fs-l);
}
.panel-head span {
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
}
.record-list {
  display: flex;
  flex-direction: column;
}
.record-row {
  display: grid;
  grid-template-columns: minmax(150px, 230px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  padding: 15px 18px;
  border-bottom: 1px solid var(--cpu-border-soft);
  transition: background 0.15s;
}
.record-row:hover {
  background: var(--cpu-surface-subtle);
}
.record-row:last-child {
  border-bottom: 0;
}
.record-row span {
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-m);
  line-height: 1.6;
}
.record-row b {
  color: var(--cpu-text);
  font-size: var(--cpu-fs-l);
  text-align: right;
  word-break: break-word;
  line-height: 1.65;
  font-weight: 500;
}
.feedback-body {
  padding: 18px;
}
.feedback-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 18px;
}
.feedback-form :deep(.el-form-item__label) {
  color: var(--cpu-text);
  font-weight: 500;
}
.feedback-form :deep(.el-radio__label),
.feedback-form :deep(.el-checkbox__label) {
  color: var(--cpu-text-secondary);
}
.feedback-form :deep(.el-input__wrapper),
.feedback-form :deep(.el-textarea__inner) {
  border-radius: var(--cpu-radius-m);
  box-shadow: 0 0 0 1px var(--cpu-border) inset;
}
.feedback-form :deep(.el-input__wrapper.is-focus),
.feedback-form :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px var(--cpu-primary) inset;
}
.feedback-form :deep(.el-form-item:nth-child(3)),
.feedback-form :deep(.el-form-item:nth-child(4)),
.feedback-form :deep(.el-form-item:nth-child(5)) {
  grid-column: 1 / -1;
}
.option-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.feedback-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-start;
  padding-top: 4px;
}
.feedback-actions :deep(.el-button) {
  min-width: 126px;
  border-radius: var(--cpu-radius-m);
}
.feedback-loading {
  padding: 18px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}
.feedback-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px;
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-s);
}
.feedback-state.error {
  color: var(--cpu-danger);
}
@media (max-width: 700px) {
  .lookup-head { flex-wrap: wrap; }
  .record-row,
  .feedback-form {
    grid-template-columns: 1fr;
  }
  .record-row {
    gap: 6px;
    padding: 14px;
  }
  .record-row b {
    text-align: left;
  }
  .panel-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .feedback-actions .el-button {
    width: 100%;
    min-height: 42px;
  }
  .feedback-state {
    align-items: stretch;
    flex-direction: column;
  }
  .option-list {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .option-list :deep(.el-radio),
  .option-list :deep(.el-checkbox) {
    min-height: 40px;
    margin-right: 0;
    white-space: normal;
  }
}
</style>
