<template>
  <div class="grade-lookup-page">
    <section class="grade-sheet" v-loading="loading">
      <button type="button" class="back-btn" @click="$router.push('/services/tools/grade_check')">
        <el-icon><ArrowLeft /></el-icon>
        <span>成绩表核对</span>
      </button>

      <el-empty v-if="loadError && !loading" :description="loadError">
        <el-button type="primary" :loading="loading" @click="load">重新查询</el-button>
      </el-empty>

      <template v-else-if="lookup">
        <header class="lookup-head">
          <div class="head-copy">
            <span>成绩核对单</span>
            <h2>{{ lookup.table.title }}</h2>
            <p>{{ lookup.table.description || "请核对下方项目。若存在问题，请在底部提交反馈。" }}</p>
            <el-button v-if="lookup.canManage" class="manage-link" plain @click="openManage">进入管理</el-button>
          </div>
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
import { ArrowLeft } from "@element-plus/icons-vue";
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
.grade-lookup-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: calc(100dvh - 150px);
  padding: 18px 0 34px;
  background:
    linear-gradient(180deg, #f5f8fc 0%, #ffffff 45%),
    #fff;
}
.grade-sheet {
  max-width: 1040px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
  border: 1px solid #e1e7f0;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 18px 45px rgba(31, 45, 61, 0.08);
}
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  margin-bottom: 20px;
  transition: border-color 0.16s, color 0.16s, background 0.16s;
}
.back-btn:hover {
  color: #2563eb;
  border-color: #bfdbfe;
  background: #f8fbff;
}
.lookup-head {
  display: flex;
  align-items: flex-start;
  padding: 4px 2px 22px;
  border-bottom: 1px solid #edf2f7;
  margin-bottom: 18px;
}
.head-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.head-copy > span {
  width: fit-content;
  margin-bottom: 10px;
  padding: 3px 9px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  color: #2563eb;
  background: #eff6ff;
  font-size: 12px;
  font-weight: 650;
}
.lookup-head h2 {
  margin: 0;
  color: #0f172a;
  font-size: 28px;
  line-height: 1.25;
}
.lookup-head p {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 14px;
  line-height: 1.7;
}
.record-panel,
.feedback-panel {
  border: 1px solid #e1e7f0;
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 8px 22px rgba(31, 45, 61, 0.04);
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
  border-bottom: 1px solid #e5eaf3;
  background: #fbfcff;
}
.panel-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
}
.panel-head span {
  color: #64748b;
  font-size: 12px;
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
  border-bottom: 1px solid #eef3f8;
  transition: background 0.15s;
}
.record-row:hover {
  background: #f8fbff;
}
.record-row:last-child {
  border-bottom: 0;
}
.record-row span {
  color: #64748b;
  font-size: 14px;
  line-height: 1.6;
}
.record-row b {
  color: #0f172a;
  font-size: 16px;
  text-align: right;
  word-break: break-word;
  line-height: 1.65;
  font-weight: 650;
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
  color: #334155;
  font-weight: 650;
}
.feedback-form :deep(.el-input__wrapper),
.feedback-form :deep(.el-textarea__inner) {
  border-radius: 8px;
  box-shadow: 0 0 0 1px #dfe7f2 inset;
}
.feedback-form :deep(.el-input__wrapper.is-focus),
.feedback-form :deep(.el-textarea__inner:focus) {
  box-shadow: 0 0 0 1px #2563eb inset;
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
  border-radius: 8px;
}
.feedback-loading {
  padding: 18px;
  color: #64748b;
  font-size: 13px;
}
.feedback-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px;
  color: #64748b;
  font-size: 13px;
}
.feedback-state.error {
  color: #dc2626;
}
.manage-link {
  width: fit-content;
  margin-top: 14px;
  border-radius: 8px;
}
@media (max-width: 700px) {
  .grade-lookup-page {
    padding: 0;
    background: #fff;
  }
  .grade-sheet {
    padding: 16px;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
    box-shadow: none;
  }
  .lookup-head {
    gap: 14px;
  }
  .lookup-head h2 {
    font-size: 22px;
  }
  .manage-link {
    width: 100%;
  }
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
