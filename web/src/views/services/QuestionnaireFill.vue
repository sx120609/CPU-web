<template>
  <div class="questionnaire-page">
    <section class="fill-card" v-loading="loading">
      <button type="button" class="back-btn" @click="$router.push('/services/tools/questionnaire')">
        <el-icon><ArrowLeft /></el-icon>
        <span>问卷</span>
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
            </div>
          </div>
        </div>

        <form class="questionnaire-form" @submit.prevent="submit">
          <label v-for="field in questionnaire.fields || []" :key="field.id" class="field">
            <span>{{ field.label }}<b v-if="field.required"> *</b></span>
            <textarea
              v-if="field.type === 'textarea'"
              v-model="answers[field.id] as string"
              rows="6"
              maxlength="2000"
              :placeholder="field.placeholder"
            />
            <select v-else-if="field.type === 'single'" v-model="answers[field.id] as string">
              <option value="">请选择</option>
              <option v-for="option in field.options || []" :key="option" :value="option">{{ option }}</option>
            </select>
            <div v-else-if="field.type === 'multiple'" class="choice-list">
              <label v-for="option in field.options || []" :key="option" class="choice-item">
                <input
                  type="checkbox"
                  :checked="Array.isArray(answers[field.id]) && (answers[field.id] as string[]).includes(option)"
                  @change="toggleMulti(field.id, option, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ option }}</span>
              </label>
            </div>
            <input
              v-else
              v-model="answers[field.id] as string"
              maxlength="300"
              :placeholder="field.placeholder"
            />
          </label>

          <el-button type="primary" size="large" native-type="submit" :loading="submitting">提交问卷</el-button>
        </form>
      </template>

      <el-empty v-else-if="!loading" description="问卷不存在或暂未开放">
        <el-button type="primary" @click="$router.push('/services/tools/questionnaire')">返回问卷列表</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, DocumentChecked } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { toolsApi, type Questionnaire } from "@/api/tools";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const questionnaire = ref<Questionnaire | null>(null);
const answers = reactive<Record<string, string | string[]>>({});

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

function toggleMulti(fieldId: string, option: string, checked: boolean) {
  const current = Array.isArray(answers[fieldId]) ? answers[fieldId] as string[] : [];
  answers[fieldId] = checked ? [...current, option] : current.filter((item) => item !== option);
}

async function submit() {
  if (!questionnaire.value) return;
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
  margin-bottom: 18px;
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
.questionnaire-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: #374151;
  font-size: 13px;
  font-weight: 600;
}
.field b { color: #dc2626; }
.field input,
.field select,
.field textarea {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  padding: 10px 12px;
  color: #1f2937;
  font: inherit;
  line-height: 1.5;
  outline: none;
  background: #fff;
}
.field textarea {
  resize: vertical;
  min-height: 132px;
}
.choice-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.choice-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  font-weight: 500;
}
.choice-item input { width: auto; }
@media (max-width: 700px) {
  .fill-card {
    padding: 16px;
    border-radius: 10px;
  }
  .fill-head {
    flex-direction: column;
  }
  .fill-head h2 {
    font-size: 20px;
  }
}
</style>
