<template>
  <div class="questionnaire-page">
    <section class="fill-card" v-loading="loading">
      <button type="button" class="back-btn" @click="$router.push('/services/tools')">
        <el-icon><ArrowLeft /></el-icon>
        <span>校园小工具</span>
      </button>

      <template v-if="questionnaire">
        <div class="fill-head">
          <div class="head-icon"><el-icon><DocumentChecked /></el-icon></div>
          <div>
            <h2>{{ questionnaire.title }}</h2>
            <p>{{ questionnaire.description || "请按实际情况填写。" }}</p>
            <div class="meta-row">
              <el-tag size="small" effect="plain">{{ questionnaire.visibility === "login" ? "需登录" : "公开填写" }}</el-tag>
              <el-tag v-if="questionnaire.oneResponsePerUser" size="small" type="warning" effect="plain">每人一次</el-tag>
              <el-tag size="small" type="info" effect="plain">{{ answeredCount }}/{{ fieldCount }} 已填写</el-tag>
            </div>
            <PrivacyPolicyNotice v-if="questionnaire.visibility === 'login'" align="left" compact />
          </div>
        </div>

        <el-progress v-if="fieldCount" class="fill-progress" :percentage="progressPercent" :show-text="false" />

        <form class="questionnaire-form" @submit.prevent="submit">
          <section v-for="(field, index) in questionnaire.fields || []" :key="field.id" class="field-card">
            <div class="field-title">
              <span>{{ index + 1 }}</span>
              <div>
                <b>{{ field.label }}<em v-if="field.required">*</em></b>
                <p v-if="field.description">{{ field.description }}</p>
              </div>
            </div>

            <el-input
              v-if="field.type === 'text'"
              v-model="answers[field.id] as string"
              :maxlength="field.maxLength || 300"
              :placeholder="field.placeholder"
              clearable
            />
            <el-input
              v-else-if="field.type === 'textarea'"
              v-model="answers[field.id] as string"
              type="textarea"
              :rows="6"
              :maxlength="field.maxLength || 2000"
              show-word-limit
              :placeholder="field.placeholder"
            />
            <el-radio-group v-else-if="field.type === 'single'" v-model="answers[field.id] as string" class="vertical-options">
              <el-radio v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-radio>
            </el-radio-group>
            <el-checkbox-group v-else-if="field.type === 'multiple'" :model-value="multiValue(field.id)" class="vertical-options" @change="setMulti(field.id, $event)">
              <el-checkbox v-for="option in field.options || []" :key="option" :label="option">{{ option }}</el-checkbox>
            </el-checkbox-group>
            <el-input
              v-else-if="field.type === 'number'"
              v-model="answers[field.id] as string"
              type="number"
              :min="field.min"
              :max="field.max"
              :step="field.step || 1"
              :placeholder="field.placeholder || '请输入数字'"
            />
            <el-date-picker
              v-else-if="field.type === 'date'"
              :model-value="answers[field.id] as string"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选择日期"
              @update:model-value="answers[field.id] = String($event || '')"
            />
            <div v-else-if="field.type === 'rating'" class="rating-field">
              <button
                v-for="score in ratingRange(field)"
                :key="score"
                type="button"
                :class="{ active: answers[field.id] === String(score) }"
                @click="answers[field.id] = answers[field.id] === String(score) ? '' : String(score)"
              >
                {{ score }}
              </button>
              <span>{{ answers[field.id] ? `${answers[field.id]} 分` : "未评分" }}</span>
            </div>
          </section>

          <div class="submit-row">
            <el-button type="primary" size="large" native-type="submit" :loading="submitting">提交问卷</el-button>
          </div>
        </form>
      </template>

      <el-empty v-else-if="!loading" description="问卷不存在或暂未开放">
        <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, DocumentChecked } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { toolsApi, type Questionnaire, type QuestionnaireField } from "@/api/tools";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const questionnaire = ref<Questionnaire | null>(null);
const answers = reactive<Record<string, string | string[]>>({});

const fieldCount = computed(() => questionnaire.value?.fields?.length ?? 0);
const answeredCount = computed(() => (questionnaire.value?.fields ?? []).filter((field) => hasAnswer(answers[field.id])).length);
const progressPercent = computed(() => fieldCount.value ? Math.round((answeredCount.value / fieldCount.value) * 100) : 0);

onMounted(load);

async function load() {
  loading.value = true;
  try {
    questionnaire.value = await toolsApi.questionnaire(String(route.params.slug));
    for (const field of questionnaire.value.fields ?? []) {
      answers[field.id] = field.type === "multiple" ? [] : "";
    }
  } finally {
    loading.value = false;
  }
}

function multiValue(fieldId: string) {
  return Array.isArray(answers[fieldId]) ? answers[fieldId] as string[] : [];
}

function setMulti(fieldId: string, value: unknown) {
  answers[fieldId] = Array.isArray(value) ? value.map(String) : [];
}

function hasAnswer(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value ?? "").trim());
}

function ratingRange(field: QuestionnaireField) {
  const min = Math.max(0, Math.round(field.min ?? 1));
  const max = Math.min(10, Math.round(field.max ?? 5));
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
}

async function submit() {
  if (!questionnaire.value) return;
  const missing = (questionnaire.value.fields ?? []).find((field) => field.required && !hasAnswer(answers[field.id]));
  if (missing) {
    ElMessage.warning(`请填写：${missing.label}`);
    return;
  }
  submitting.value = true;
  try {
    await toolsApi.submitResponse(questionnaire.value.slug, answers);
    ElMessage.success("提交成功");
    router.push("/services/tools/questionnaire");
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.questionnaire-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.fill-card {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  padding: 20px 22px 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #4b5563;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  margin-bottom: 16px;
}
.fill-head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding-bottom: 18px;
  border-bottom: 1px solid #eef0f4;
  margin-bottom: 12px;
}
.head-icon {
  width: 50px;
  height: 50px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #d97706;
  background: #fff7ed;
  flex: 0 0 auto;
}
.head-icon .el-icon { font-size: 26px; }
.fill-head h2 {
  margin: 0;
  color: #111827;
  font-size: 22px;
}
.fill-head p {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.fill-progress { margin-bottom: 18px; max-width: 820px; }
.questionnaire-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 820px;
}
.field-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
}
.field-title {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.field-title > span {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: var(--cpu-primary);
  font-size: 12px;
  font-weight: 700;
  flex: 0 0 auto;
}
.field-title div { min-width: 0; }
.field-title b {
  color: #111827;
  font-size: 14px;
}
.field-title em {
  color: #dc2626;
  font-style: normal;
  margin-left: 3px;
}
.field-title p {
  margin: 5px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
.vertical-options {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.rating-field {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.rating-field button {
  width: 40px;
  height: 40px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #4b5563;
  cursor: pointer;
  font: inherit;
  font-weight: 650;
}
.rating-field button.active {
  color: #fff;
  border-color: var(--cpu-primary);
  background: var(--cpu-primary);
}
.rating-field span { color: #6b7280; font-size: 13px; }
.submit-row {
  display: flex;
  justify-content: flex-start;
  padding-top: 4px;
}
@media (max-width: 700px) {
  .fill-card {
    padding: 16px;
    border-radius: 10px;
  }
  .back-btn {
    height: 40px;
  }
  .fill-head {
    flex-direction: column;
  }
  .fill-head h2 {
    font-size: 20px;
  }
  .field-card { padding: 14px; }
  .field-title {
    gap: 8px;
  }
  .vertical-options {
    align-items: stretch;
  }
  .vertical-options :deep(.el-radio),
  .vertical-options :deep(.el-checkbox) {
    min-height: 40px;
    margin-right: 0;
    white-space: normal;
  }
  .rating-field {
    gap: 8px;
  }
  .submit-row .el-button { width: 100%; }
}
</style>
