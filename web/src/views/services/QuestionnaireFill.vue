<template>
  <div class="pk-page pk-page--narrow q-fill" :aria-busy="loading">
    <template v-if="questionnaire">
      <header class="pk-head">
        <router-link class="pk-back" to="/services/tools"><el-icon aria-hidden="true"><ArrowLeft /></el-icon>校园小工具</router-link>
        <div class="pk-title">
          <span class="pk-tile" style="--tone: #d97706" aria-hidden="true"><el-icon><DocumentChecked /></el-icon></span>
          <div class="pk-title-copy">
            <h1>{{ questionnaire.title }}</h1>
            <p>{{ questionnaire.description || "请按实际情况填写。" }}</p>
          </div>
        </div>
        <div class="q-fill-meta">
          <span class="pk-badge" :class="questionnaire.visibility === 'login' ? 'is-login' : 'is-open'">{{ questionnaire.visibility === "login" ? "需登录" : "公开填写" }}</span>
          <span v-if="questionnaire.oneResponsePerUser" class="pk-badge is-info">每人一次</span>
        </div>
        <PrivacyPolicyNotice v-if="questionnaire.visibility === 'login'" align="left" compact />
      </header>

      <form class="pk-card q-fill-form" @submit.prevent="submit">
        <div v-if="fieldCount" class="q-fill-progress">
          <el-progress :percentage="progressPercent" :show-text="false" :stroke-width="6" />
          <span>{{ answeredCount }}/{{ fieldCount }} 已填写</span>
        </div>
        <QuestionnaireFields :fields="visibleFields" :answers="answers" :disabled="submitting" />
        <el-button type="primary" size="large" native-type="submit" :loading="submitting" :disabled="submitting">提交问卷</el-button>
      </form>
    </template>

    <section v-else-if="loading" class="pk-card"><div class="pk-empty" role="status">正在加载问卷…</div></section>
    <section v-else class="pk-card">
      <el-empty :description="error || '问卷不存在或暂未开放'">
        <el-button v-if="error" type="primary" :loading="loading" @click="load">重新加载</el-button>
        <el-button v-else type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, DocumentChecked } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { toolsApi, type Questionnaire, type QuestionnaireField } from "@/api/tools";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";
import QuestionnaireFields from "./components/QuestionnaireFields.vue";
import "@/styles/page-kit.css";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const questionnaire = ref<Questionnaire | null>(null);
const error = ref("");
const answers = reactive<Record<string, string | string[]>>({});
let loadSeq = 0;

const visibleFields = computed(() => resolveVisibleFields(questionnaire.value?.fields ?? []));
const fieldCount = computed(() => visibleFields.value.length);
const answeredCount = computed(() => visibleFields.value.filter((field) => hasAnswer(answers[field.id])).length);
const progressPercent = computed(() => fieldCount.value ? Math.round((answeredCount.value / fieldCount.value) * 100) : 0);

watch(() => route.params.slug, () => {
  void load();
}, { immediate: true });

async function load() {
  const seq = ++loadSeq;
  const slug = String(route.params.slug || "").trim();
  loading.value = true;
  error.value = "";
  questionnaire.value = null;
  Object.keys(answers).forEach((key) => delete answers[key]);
  if (!slug) {
    error.value = "问卷地址无效";
    loading.value = false;
    return;
  }
  try {
    const next = await toolsApi.questionnaire(slug, {
      suppressErrorMessage: true,
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
    });
    if (seq !== loadSeq) return;
    questionnaire.value = next;
    for (const field of next.fields ?? []) {
      answers[field.id] = field.type === "multiple" ? [] : "";
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    const status = (e as { response?: { status?: number; data?: { message?: string } } }).response?.status;
    if (status === 401) {
      error.value = "请先登录后再填写问卷";
      router.push({ name: "login", query: { redirect: route.fullPath } });
      return;
    }
    if (status === 404) {
      error.value = "问卷不存在或暂未开放";
    } else if (status && status < 500) {
      error.value = (e as { response?: { data?: { message?: string } } }).response?.data?.message || "问卷加载失败";
    } else {
      error.value = "问卷加载失败，请稍后再试";
    }
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

function hasAnswer(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(String(value ?? "").trim());
}

function resolveVisibleFields(fields: QuestionnaireField[]) {
  const result: QuestionnaireField[] = [];
  const indexById = new Map(fields.map((field, index) => [field.id, index]));
  for (let index = 0; index < fields.length;) {
    const field = fields[index];
    result.push(field);
    if (field.type === "single") {
      const value = String(answers[field.id] ?? "").trim();
      const rule = value ? field.branching?.[value] : undefined;
      if (rule?.action === "end") break;
      if (rule?.action === "jump" && rule.targetId) {
        const targetIndex = indexById.get(rule.targetId);
        if (targetIndex !== undefined && targetIndex > index) {
          index = targetIndex;
          continue;
        }
      }
    }
    index += 1;
  }
  return result;
}

function visibleAnswers() {
  const result: Record<string, string | string[]> = {};
  for (const field of visibleFields.value) {
    result[field.id] = answers[field.id] ?? (field.type === "multiple" ? [] : "");
  }
  return result;
}

async function submit() {
  if (submitting.value) return;
  if (!questionnaire.value) return;
  const missing = visibleFields.value.find((field) => field.required && !hasAnswer(answers[field.id]));
  if (missing) {
    ElMessage.warning(`请填写：${missing.label}`);
    return;
  }
  submitting.value = true;
  try {
    await toolsApi.submitResponse(questionnaire.value.slug, visibleAnswers(), {
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    ElMessage.success("提交成功");
    router.push("/services/tools/questionnaire");
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 401) {
      ElMessage.warning("请先登录后再提交问卷");
      router.push({ name: "login", query: { redirect: route.fullPath } });
      return;
    }
    ElMessage.error(
      (error as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message
        ?? "提交失败，请稍后再试"
    );
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.q-fill-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.q-fill-form { display: flex; flex-direction: column; gap: 18px; }
.q-fill-form > .el-button { align-self: flex-start; min-width: 160px; }
.q-fill-progress { display: flex; align-items: center; gap: 12px; }
.q-fill-progress .el-progress { flex: 1; }
.q-fill-progress span { flex: 0 0 auto; color: var(--cpu-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
@media (max-width: 560px) {
  .q-fill-form > .el-button { align-self: stretch; }
}
</style>
