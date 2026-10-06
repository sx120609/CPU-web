<template>
  <div class="feedback-panel">
    <section class="pk-card">
      <header class="pk-card-head">
        <div>
          <h2 class="pk-h2">{{ questionnaire?.title ?? "需求反馈" }}</h2>
          <p class="pk-muted">{{ questionnaire?.description ?? "把想法写下来，我们会在后续工具迭代里统一处理。" }}</p>
        </div>
      </header>

      <div v-if="loading" class="pk-empty" role="status">正在加载问卷…</div>
      <div v-else-if="needLogin" class="pk-empty">
        <p>登录后可以提交反馈。</p>
        <el-button type="primary" plain @click="$router.push({ name: 'login', query: { redirect: $route.fullPath } })">去登录</el-button>
        <PrivacyPolicyNotice compact />
      </div>
      <div v-else-if="loadError" class="pk-empty" role="alert">
        <p>{{ loadError }}</p>
        <el-button plain :loading="loading" @click="load">重试</el-button>
      </div>
      <form v-else class="feedback-form" @submit.prevent="submit">
        <QuestionnaireFields :fields="questionnaire?.fields ?? []" :answers="answers" :disabled="submitting" />
        <el-button type="primary" size="large" native-type="submit" :loading="submitting" :disabled="submitting">提交反馈</el-button>
      </form>
    </section>

    <aside class="pk-card pk-card--soft">
      <h2 class="pk-h2">可以反馈什么</h2>
      <p class="pk-muted">你可以写下希望新增的工具、现有功能哪里不顺手，或者后续问卷功能需要支持的场景。</p>
      <ul>
        <li>想收集什么信息</li>
        <li>希望谁可以填写</li>
        <li>结果需要怎样导出</li>
      </ul>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { toolsApi, type Questionnaire } from "@/api/tools";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import QuestionnaireFields from "./QuestionnaireFields.vue";

const quiet = { suppressAuthRedirect: true, suppressAuthMessage: true, suppressErrorMessage: true };
const loading = ref(false);
const submitting = ref(false);
const questionnaire = ref<Questionnaire | null>(null);
const needLogin = ref(false);
const loadError = ref("");
const answers = reactive<Record<string, string | string[]>>({});

onMounted(load);

function resetAnswers() {
  for (const field of questionnaire.value?.fields ?? []) {
    answers[field.id] = field.type === "multiple" ? [] : "";
  }
}

async function load() {
  loading.value = true;
  needLogin.value = false;
  loadError.value = "";
  try {
    questionnaire.value = await toolsApi.questionnaire("system-feedback", quiet);
    resetAnswers();
  } catch (error) {
    const response = (error as { response?: { status?: number; data?: { message?: string } } }).response;
    if (response?.status === 401) needLogin.value = true;
    else {
      loadError.value = response?.status && response.status < 500
        ? response.data?.message || "反馈问卷加载失败"
        : "反馈问卷加载失败，请稍后再试";
    }
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!questionnaire.value || submitting.value) return;
  submitting.value = true;
  try {
    await toolsApi.submitResponse(questionnaire.value.slug, answers, quiet);
    resetAnswers();
    ElMessage.success("已提交反馈");
  } catch (error) {
    const response = (error as { response?: { status?: number; data?: { message?: string } } }).response;
    if (response?.status === 401) needLogin.value = true;
    else ElMessage.error(response?.data?.message ?? "提交失败，请稍后再试");
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.feedback-panel { display: grid; grid-template-columns: minmax(0, 1fr) 300px; align-items: start; gap: 16px; }
.feedback-form { display: flex; flex-direction: column; gap: 18px; }
.feedback-form > .el-button { align-self: flex-start; min-width: 140px; }
.pk-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; }
aside ul { display: grid; gap: 8px; margin: 14px 0 0; padding: 0; list-style: none; }
aside li {
  padding: 8px 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  font-size: 12px;
}
@media (max-width: 860px) {
  .feedback-panel { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .feedback-form > .el-button { align-self: stretch; }
}
</style>
