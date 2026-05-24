<template>
  <div class="grade-lookup-page">
    <section class="grade-sheet" v-loading="loading">
      <button type="button" class="back-btn" @click="$router.push('/services/tools/grade_check')">
        <el-icon><ArrowLeft /></el-icon>
        <span>成绩表核对</span>
      </button>

      <template v-if="lookup">
        <div class="sheet-hero">
          <div class="hero-main">
            <div class="hero-kicker">个人成绩核对单</div>
            <h2>{{ lookup.table.title }}</h2>
            <p>{{ lookup.table.description || "请核对下方项目。若任一项目存在问题，可在页面底部提交反馈。" }}</p>
            <div class="hero-tags">
              <span>仅显示本人记录</span>
              <span>{{ fmtDate(lookup.table.updatedAt) }} 更新</span>
            </div>
          </div>
          <div class="student-badge">
            <span>登录学号</span>
            <b>{{ lookup.studentId }}</b>
            <small>{{ lookup.row ? "已匹配到查询记录" : "未匹配到记录" }}</small>
          </div>
        </div>

        <template v-if="lookup.row">
          <div class="overview-grid">
            <article class="overview-card primary">
              <span>核对状态</span>
              <b>待本人确认</b>
              <small>如信息无误，无需提交反馈</small>
            </article>
            <article v-for="item in highlightItems" :key="item.label" class="overview-card">
              <span>{{ item.label }}</span>
              <b>{{ item.value || "-" }}</b>
              <small>来自上传表格</small>
            </article>
          </div>

          <div class="content-grid">
            <main class="record-panel">
              <div class="panel-title">
                <div>
                  <h3>核对项目</h3>
                  <p>请逐项确认。系统只返回你学号对应的这一行。</p>
                </div>
                <el-tag type="success" effect="plain">已匹配</el-tag>
              </div>

              <div class="record-list">
                <div v-for="(column, index) in lookup.table.columns" :key="column" class="record-row" :class="{ important: isScoreColumn(column) }">
                  <div class="record-index">{{ String(index + 1).padStart(2, "0") }}</div>
                  <div class="record-name">
                    <b>{{ column }}</b>
                    <span>{{ isScoreColumn(column) ? "成绩项目" : "基础信息" }}</span>
                  </div>
                  <div class="record-value">{{ lookup.row[column] || "-" }}</div>
                </div>
              </div>
            </main>

            <aside class="side-stack">
              <section class="side-panel publisher">
                <h3>发布信息</h3>
                <div class="publisher-row">
                  <span>发布者</span>
                  <b>{{ lookup.table.createdBy?.nickname || lookup.table.createdBy?.username || "未记录" }}</b>
                </div>
                <div class="publisher-row">
                  <span>开放状态</span>
                  <b>{{ statusText(lookup.table.status) }}</b>
                </div>
                <div class="publisher-row">
                  <span>表内记录</span>
                  <b>{{ lookup.table.rowCount }} 条</b>
                </div>
              </section>
              <section class="side-panel privacy">
                <h3>隐私保护</h3>
                <p>查询结果由登录学号匹配生成，不会展示其他同学的记录。</p>
              </section>
              <el-button v-if="lookup.canManage" plain type="primary" @click="$router.push('/services/tools/manage')">进入管理</el-button>
            </aside>
          </div>

          <section v-if="feedbackQuestionnaire" class="feedback-panel">
            <div class="feedback-head">
              <div>
                <h3>发现问题？</h3>
                <p>{{ feedbackQuestionnaire.description || "提交后发起者可以在问卷结果中查看。" }}</p>
              </div>
              <el-tag effect="plain">配套反馈问卷</el-tag>
            </div>
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
                <el-button type="primary" native-type="submit" :loading="feedbackSubmitting">提交问题反馈</el-button>
                <span>仅在存在问题时提交</span>
              </div>
            </el-form>
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
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ArrowLeft } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import {
  toolsApi,
  type GradeCheckLookup,
  type GradeCheckStatus,
  type Questionnaire,
} from "@/api/tools";
import { fmtDate } from "@/utils/format";

const route = useRoute();
const loading = ref(false);
const feedbackSubmitting = ref(false);
const lookup = ref<GradeCheckLookup | null>(null);
const feedbackQuestionnaire = ref<Questionnaire | null>(null);
const feedbackAnswers = reactive<Record<string, string | string[]>>({});
const scoreKeywords = ["成绩", "分数", "总评", "平时", "期末", "期中", "绩点", "等级", "得分"];

const highlightItems = computed(() => {
  if (!lookup.value?.row) return [];
  const columns = lookup.value.table.columns;
  const score = columns.filter(isScoreColumn).slice(0, 3);
  const fallback = columns.filter((column) => column !== lookup.value?.table.studentIdColumn).slice(0, 3);
  return (score.length ? score : fallback).map((column) => ({
    label: column,
    value: lookup.value?.row?.[column] ?? "",
  }));
});

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

async function submitFeedback() {
  if (!feedbackQuestionnaire.value) return;
  const missing = (feedbackQuestionnaire.value.fields ?? []).find((field) => field.required && !hasAnswer(feedbackAnswers[field.id]));
  if (missing) {
    ElMessage.warning(`请填写：${missing.label}`);
    return;
  }
  feedbackSubmitting.value = true;
  try {
    await toolsApi.submitResponse(feedbackQuestionnaire.value.slug, feedbackAnswers);
    ElMessage.success("反馈已提交");
    for (const field of feedbackQuestionnaire.value.fields ?? []) {
      if (field.type === "multiple") feedbackAnswers[field.id] = [];
      else if (field.id === "student_id") feedbackAnswers[field.id] = lookup.value?.studentId ?? "";
      else feedbackAnswers[field.id] = "";
    }
  } finally {
    feedbackSubmitting.value = false;
  }
}

function isScoreColumn(column: string) {
  return scoreKeywords.some((keyword) => column.includes(keyword));
}

function statusText(status: GradeCheckStatus) {
  if (status === "open") return "开放";
  if (status === "closed") return "关闭";
  return "草稿";
}
</script>

<style scoped>
.grade-lookup-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.grade-sheet {
  padding: 22px;
  border: 1px solid #dfe7f3;
  border-radius: 14px;
  background:
    linear-gradient(180deg, #f8fbff 0, #fff 210px),
    #fff;
  box-shadow: 0 16px 45px rgba(15, 23, 42, 0.08);
}
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  color: #334155;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  margin-bottom: 18px;
}
.back-btn:hover {
  color: #155eef;
  border-color: #9bbcff;
}
.sheet-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 20px;
  align-items: stretch;
  margin-bottom: 20px;
}
.hero-main {
  min-width: 0;
  padding: 16px 0 18px;
}
.hero-kicker {
  color: #155eef;
  font-size: 12px;
  font-weight: 800;
  margin-bottom: 7px;
}
.hero-main h2 {
  margin: 0;
  color: #0f172a;
  font-size: 30px;
  line-height: 1.2;
}
.hero-main p {
  max-width: 760px;
  margin: 10px 0 0;
  color: #64748b;
  font-size: 14px;
  line-height: 1.8;
}
.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.hero-tags span {
  padding: 5px 9px;
  border: 1px solid #dbeafe;
  border-radius: 999px;
  color: #1d4ed8;
  background: #eff6ff;
  font-size: 12px;
  font-weight: 650;
}
.student-badge {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 18px;
  border: 1px solid #b7cdfa;
  border-radius: 12px;
  background:
    linear-gradient(135deg, #ffffff 0%, #eef5ff 100%);
  box-shadow: 0 12px 28px rgba(21, 94, 239, 0.12);
}
.student-badge span,
.student-badge small {
  color: #64748b;
  font-size: 12px;
}
.student-badge b {
  color: #0f172a;
  font-size: 28px;
  line-height: 1.1;
}
.overview-grid {
  display: grid;
  grid-template-columns: 1.25fr repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.overview-card {
  min-width: 0;
  padding: 15px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}
.overview-card.primary {
  color: #fff;
  border-color: #155eef;
  background:
    linear-gradient(135deg, #155eef, #2f7df6);
}
.overview-card span,
.overview-card small {
  display: block;
  color: #64748b;
  font-size: 12px;
}
.overview-card.primary span,
.overview-card.primary small {
  color: rgba(255, 255, 255, 0.82);
}
.overview-card b {
  display: block;
  margin: 7px 0 5px;
  color: #0f172a;
  font-size: 21px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-card.primary b {
  color: #fff;
}
.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}
.record-panel,
.feedback-panel,
.side-panel {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.045);
}
.record-panel {
  overflow: hidden;
}
.panel-title,
.feedback-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 17px 18px;
  border-bottom: 1px solid #e2e8f0;
  background: #fbfdff;
}
.panel-title h3,
.feedback-head h3,
.side-panel h3 {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
}
.panel-title p,
.feedback-head p {
  margin: 5px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}
.record-list {
  display: flex;
  flex-direction: column;
}
.record-row {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) minmax(120px, auto);
  gap: 14px;
  align-items: center;
  padding: 15px 18px;
  border-bottom: 1px solid #edf2f7;
}
.record-row:last-child {
  border-bottom: 0;
}
.record-row.important {
  background: #f8fbff;
}
.record-index {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: #2563eb;
  background: #eff6ff;
  font-size: 12px;
  font-weight: 800;
}
.record-name {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.record-name b {
  color: #0f172a;
  font-size: 14px;
}
.record-name span {
  color: #94a3b8;
  font-size: 12px;
}
.record-value {
  color: #0f172a;
  font-size: 18px;
  font-weight: 800;
  text-align: right;
  word-break: break-word;
}
.side-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.side-panel {
  padding: 16px;
}
.publisher-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid #edf2f7;
}
.publisher-row:first-of-type {
  border-top: 0;
}
.publisher-row span {
  color: #64748b;
  font-size: 13px;
}
.publisher-row b {
  color: #0f172a;
  font-size: 13px;
  text-align: right;
}
.privacy {
  background: #f8fbff;
}
.privacy p {
  margin: 10px 0 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.75;
}
.feedback-panel {
  margin-top: 18px;
  overflow: hidden;
}
.feedback-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 16px;
  padding: 18px;
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
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}
.feedback-actions span {
  color: #64748b;
  font-size: 12px;
}
@media (max-width: 1000px) {
  .sheet-hero,
  .content-grid {
    grid-template-columns: 1fr;
  }
  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 700px) {
  .grade-sheet {
    padding: 16px;
  }
  .hero-main h2 {
    font-size: 23px;
  }
  .overview-grid,
  .feedback-form {
    grid-template-columns: 1fr;
  }
  .record-row {
    grid-template-columns: 42px minmax(0, 1fr);
  }
  .record-value {
    grid-column: 2;
    text-align: left;
  }
  .panel-title,
  .feedback-head,
  .feedback-actions {
    align-items: flex-start;
    flex-direction: column;
  }
  .feedback-actions .el-button {
    width: 100%;
  }
}
</style>
