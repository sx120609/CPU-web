<template>
  <div class="grade-lookup-page">
    <section class="grade-sheet" v-loading="loading">
      <button type="button" class="back-btn" @click="$router.push('/services/tools/grade_check')">
        <el-icon><ArrowLeft /></el-icon>
        <span>成绩表核对</span>
      </button>

      <template v-if="lookup">
        <header class="lookup-head">
          <div class="head-copy">
            <span>成绩核对单</span>
            <h2>{{ lookup.table.title }}</h2>
            <p>{{ lookup.table.description || "请核对下方项目。若存在问题，请在底部提交反馈。" }}</p>
          </div>
          <div class="head-side">
            <div class="student-id">
              <span>当前学号</span>
              <b>{{ lookup.studentId }}</b>
            </div>
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
                  />
                  <el-input
                    v-else-if="field.type === 'textarea'"
                    v-model="feedbackAnswers[field.id] as string"
                    type="textarea"
                    :rows="4"
                    :maxlength="field.maxLength || 2000"
                    show-word-limit
                    :placeholder="field.placeholder"
                  />
                  <el-radio-group v-else-if="field.type === 'single'" v-model="feedbackAnswers[field.id] as string" class="option-list">
                    <el-radio v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-radio>
                  </el-radio-group>
                  <el-checkbox-group v-else-if="field.type === 'multiple'" :model-value="multiValue(field.id)" class="option-list" @change="setMulti(field.id, $event)">
                    <el-checkbox v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-checkbox>
                  </el-checkbox-group>
                </el-form-item>
                <div class="feedback-actions">
                  <el-button type="primary" native-type="submit" :loading="feedbackSubmitting">提交反馈</el-button>
                </div>
              </el-form>
            </div>
            <div v-else class="feedback-loading">正在准备反馈问卷...</div>
          </section>
        </template>

        <el-empty v-else description="未找到与你学号匹配的信息">
          <el-button plain @click="load">重新查询</el-button>
        </el-empty>
      </template>

      <el-empty v-else-if="!loading" description="查询表不存在或暂未开放">
        <el-button type="primary" @click="$router.push('/services/tools/grade_check')">返回成绩表核对</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { getToken } from "@/api/request";
import { toolsApi, type GradeCheckLookup, type Questionnaire } from "@/api/tools";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const feedbackSubmitting = ref(false);
const lookup = ref<GradeCheckLookup | null>(null);
const feedbackQuestionnaire = ref<Questionnaire | null>(null);
const feedbackAnswers = reactive<Record<string, string | string[]>>({});

onMounted(load);

async function load() {
  loading.value = true;
  try {
    lookup.value = await toolsApi.gradeCheck(String(route.params.slug));
    await loadFeedbackQuestionnaire();
  } finally {
    loading.value = false;
  }
}

async function loadFeedbackQuestionnaire() {
  feedbackQuestionnaire.value = null;
  Object.keys(feedbackAnswers).forEach((key) => delete feedbackAnswers[key]);
  const slug = lookup.value?.feedbackQuestionnaireSlug || lookup.value?.table.feedbackQuestionnaireSlug;
  if (!slug) return;
  feedbackQuestionnaire.value = await toolsApi.questionnaire(slug);
  for (const field of feedbackQuestionnaire.value.fields ?? []) {
    if (field.type === "multiple") feedbackAnswers[field.id] = [];
    else if (field.id === "student_id") feedbackAnswers[field.id] = lookup.value?.studentId ?? "";
    else feedbackAnswers[field.id] = "";
  }
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
  min-height: calc(100vh - 150px);
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: stretch;
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
.head-side {
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
}
.student-id {
  min-height: 98px;
  padding: 15px 16px;
  border: 1px solid #dbe7f5;
  border-radius: 12px;
  background:
    linear-gradient(135deg, #f8fbff 0%, #fff 100%);
}
.student-id span {
  display: block;
  color: #64748b;
  font-size: 12px;
  margin-bottom: 6px;
}
.student-id b {
  color: #0f172a;
  font-size: 26px;
  line-height: 1.25;
  word-break: break-all;
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
.manage-link {
  width: 100%;
  margin: 0;
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
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .lookup-head h2 {
    font-size: 22px;
  }
  .head-side {
    width: 100%;
  }
  .student-id {
    width: 100%;
  }
  .record-row,
  .feedback-form {
    grid-template-columns: 1fr;
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
  }
}
</style>
