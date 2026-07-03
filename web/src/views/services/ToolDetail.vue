<template>
  <div class="tool-detail-page">
    <section v-if="tool" class="tool-shell">
      <div class="tool-head">
        <button type="button" class="back-btn" @click="$router.push('/services/tools')">
          <el-icon><ArrowLeft /></el-icon>
          <span>小工具</span>
        </button>
        <div class="head-main">
          <span class="head-icon" :style="{ color: tool.accent }">
            <el-icon><component :is="tool.iconComponent" /></el-icon>
          </span>
          <div class="head-copy">
            <div class="head-title-row">
              <h2>{{ tool.name }}</h2>
              <el-tag size="small" :type="currentRequireLogin ? 'warning' : 'success'" effect="plain" round>
                {{ currentRequireLogin ? "需登录" : "免登录" }}
              </el-tag>
            </div>
            <p>{{ tool.description }}</p>
          </div>
          <el-button v-if="canManage" plain type="primary" class="manage-btn" @click="openCurrentToolManage">
            <el-icon><Setting /></el-icon>
            管理
          </el-button>
        </div>
      </div>

      <FeedbackPanel v-if="tool.componentKey === 'feedback'" />
      <QuestionnairePanel v-else-if="tool.componentKey === 'questionnaire'" />
      <GradeCheckPanel v-else-if="tool.componentKey === 'grade_check'" />
      <PdfToolPanel v-else-if="tool.componentKey === 'pdf_tools'" :require-login="currentRequireLogin" />
      <FileCollectPanel v-else />
    </section>

    <section v-else class="missing-card">
      <el-empty description="没有找到这个小工具">
        <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, EditPen, Link, Setting } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { getToken } from "@/api/request";
import { toolsApi, type GradeCheckTable, type Questionnaire, type QuestionnaireField, type ServiceToolCode, type ToolMeta } from "@/api/tools";
import { findServiceTool } from "@/data/serviceTools";
import PrivacyPolicyNotice from "@/components/common/PrivacyPolicyNotice.vue";

const PdfToolPanel = defineAsyncComponent(() => import("./PdfToolPanel.vue"));

const route = useRoute();
const router = useRouter();
const tool = computed(() => findServiceTool(String(route.params.slug || "")));
const manageable = ref<ServiceToolCode[]>([]);
const toolMetas = ref<ToolMeta[]>([]);
const currentMeta = computed(() => toolMetas.value.find((item) => item.code === tool.value?.slug));
const currentRequireLogin = computed(() => Boolean(currentMeta.value?.requireLogin));
const canManage = computed(() => Boolean(tool.value && (
  manageable.value.includes(tool.value.slug as ServiceToolCode)
  || toolMetas.value.some((item) => item.code === tool.value?.slug && item.canManage)
)));

function openToolManage(toolCode: ServiceToolCode) {
  if (toolCode === "file_collect") {
    router.push("/services/tools/filestore");
    return;
  }
  router.push({ path: "/services/tools/manage", query: { tool: toolCode } });
}

function openCurrentToolManage() {
  const code = tool.value?.slug as ServiceToolCode | undefined;
  if (code) openToolManage(code);
}

onMounted(async () => {
  try {
    toolMetas.value = await toolsApi.tools();
    manageable.value = toolMetas.value.filter((item) => item.canManage).map((item) => item.code);
  } catch {
    toolMetas.value = [];
  }
  if (!getToken()) return;
  try {
    const perms = await toolsApi.myPermissions({
      suppressAuthRedirect: true,
      suppressAuthMessage: true,
      suppressErrorMessage: true,
    });
    manageable.value = uniqueToolCodes([
      ...manageable.value,
      ...perms.toolCodes,
      ...(perms.adminToolCodes ?? []),
    ]);
  } catch {
    manageable.value = uniqueToolCodes(manageable.value);
  }
});

const FeedbackPanel = defineComponent({
  name: "FeedbackPanel",
  setup() {
    const loading = ref(false);
    const submitting = ref(false);
    const questionnaire = ref<Questionnaire | null>(null);
    const needLogin = ref(false);
    const loadError = ref("");
    const answers = reactive<Record<string, string | string[]>>({});

    onMounted(load);

    async function load() {
      loading.value = true;
      needLogin.value = false;
      loadError.value = "";
      try {
        questionnaire.value = await toolsApi.questionnaire("system-feedback", {
          suppressAuthRedirect: true,
          suppressAuthMessage: true,
          suppressErrorMessage: true,
        });
        for (const field of questionnaire.value.fields ?? []) {
          answers[field.id] = field.type === "multiple" ? [] : "";
        }
      } catch (e) {
        if ((e as { response?: { status?: number } }).response?.status === 401) {
          needLogin.value = true;
        } else {
          loadError.value = normalizeFeedbackLoadError(e);
          ElMessage.error(loadError.value);
        }
      } finally {
        loading.value = false;
      }
    }

    async function submit() {
      if (!questionnaire.value || submitting.value) return;
      submitting.value = true;
      try {
        await toolsApi.submitResponse(questionnaire.value.slug, answers, {
          suppressAuthRedirect: true,
          suppressAuthMessage: true,
          suppressErrorMessage: true,
        });
        for (const field of questionnaire.value.fields ?? []) {
          answers[field.id] = field.type === "multiple" ? [] : "";
        }
        ElMessage.success("已提交反馈");
      } catch (e) {
        if ((e as { response?: { status?: number } }).response?.status === 401) {
          needLogin.value = true;
        } else {
          ElMessage.error((e as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message ?? "提交失败，请稍后再试");
        }
      } finally {
        submitting.value = false;
      }
    }

    return () => h("div", { class: "tool-content" }, [
      h("div", { class: "form-card" }, [
        h("div", { class: "form-head" }, [
          h("span", { class: "form-head-icon" }, [h(EditPen)]),
          h("div", [
            h("h3", questionnaire.value?.title ?? "需求反馈"),
            h("p", questionnaire.value?.description ?? "把想法写下来，我们会在后续工具迭代里统一处理。"),
          ]),
        ]),
        loading.value
          ? h("div", { class: "loading-card" }, "正在加载问卷...")
          : needLogin.value
            ? h("div", { class: "empty-panel" }, [
              h("p", "登录后可以提交反馈。"),
              h("button", {
                class: "plain-action",
                type: "button",
                onClick: () => router.push({ name: "login", query: { redirect: route.fullPath } }),
              }, "去登录"),
              h(PrivacyPolicyNotice, { compact: true }),
            ])
            : loadError.value
              ? h("div", { class: "empty-panel" }, loadError.value)
          : h(QuestionnaireForm, {
            fields: questionnaire.value?.fields ?? [],
            answers,
            submitText: "提交反馈",
            submitting: submitting.value,
            onSubmit: submit,
          }),
      ]),
      h("aside", { class: "side-note" }, [
        h("h3", "可以反馈什么"),
        h("p", "你可以写下希望新增的工具、现有功能哪里不顺手，或者后续问卷功能需要支持的场景。"),
        h("div", { class: "note-list" }, [
          h("span", "想收集什么信息"),
          h("span", "希望谁可以填写"),
          h("span", "结果需要怎样导出"),
        ]),
      ]),
    ]);
  },
});

const QuestionnairePanel = defineComponent({
  name: "QuestionnairePanel",
  setup() {
    const canManageQuestionnaire = computed(() => manageable.value.includes("questionnaire") || toolMetas.value.some((item) => item.code === "questionnaire" && item.canManage));

    return () => h("div", { class: "questionnaire-list" }, [
      h("div", { class: "list-head" }, [
        h("div", [
          h("h3", "在线问卷"),
          h("p", "问卷由发起者创建后通过链接分享。这里不展示全部问卷。"),
        ]),
        canManageQuestionnaire.value
          ? h("button", { class: "plain-action", type: "button", onClick: () => openToolManage("questionnaire") }, "进入管理")
          : null,
      ]),
      h("div", { class: "empty-panel" }, canManageQuestionnaire.value
        ? "在管理页创建问卷，发布后复制链接发给填写人。"
        : "请通过发起者分享的问卷链接填写。"),
    ]);
  },
});

const GradeCheckPanel = defineComponent({
  name: "GradeCheckPanel",
  setup() {
    const canManageGradeCheck = computed(() => manageable.value.includes("grade_check") || toolMetas.value.some((item) => item.code === "grade_check" && item.canManage));
    const loading = ref(false);
    const related = ref<GradeCheckTable[]>([]);

    onMounted(async () => {
      if (!getToken()) return;
      loading.value = true;
      try {
        related.value = await toolsApi.relatedGradeChecks();
      } catch {
        related.value = [];
      } finally {
        loading.value = false;
      }
    });

    return () => h("div", { class: "questionnaire-list grade-check-panel" }, [
      h("div", { class: "list-head" }, [
        h("div", [
          h("h3", "成绩表核对"),
          h("p", "查询表由发起者上传 Excel 后生成链接。学生登录打开链接，只能看到自己学号对应的信息。"),
        ]),
        canManageGradeCheck.value
          ? h("button", { class: "plain-action", type: "button", onClick: () => openToolManage("grade_check") }, "进入管理")
          : null,
      ]),
      loading.value
        ? h("div", { class: "empty-panel" }, "正在查找与你有关的查询...")
        : related.value.length
          ? h("div", { class: "related-grade-list" }, related.value.map((item) => h("button", {
            key: item.id,
            type: "button",
            class: "related-grade-item",
            onClick: () => router.push(`/services/tools/grade-checks/${item.slug}`),
          }, [
            h("span", { class: "related-grade-icon" }, [h(Link)]),
            h("span", { class: "related-grade-main" }, [
              h("b", item.title),
              h("small", `${item.rowCount} 条记录 · 更新 ${new Date(item.updatedAt).toLocaleDateString()}`),
            ]),
            h("span", { class: "related-grade-action" }, "查看"),
          ])))
          : h("div", { class: "empty-panel" }, canManageGradeCheck.value
            ? "在管理页上传带有“学号”字段的 Excel，开放后复制链接分享给需要核对的同学。"
            : getToken()
              ? "暂未找到与你学号匹配的开放查询。也可以通过发起者分享的链接进入。"
              : h("div", [
                h("p", { class: "empty-panel-copy" }, "登录后会自动显示与你学号匹配的开放查询。"),
                h(PrivacyPolicyNotice, { compact: true }),
              ])),
    ]);
  },
});

const FileCollectPanel = defineComponent({
  name: "FileCollectPanel",
  setup() {
    const canManageFileCollect = computed(() => manageable.value.includes("file_collect") || toolMetas.value.some((item) => item.code === "file_collect" && item.canManage));

    return () => h("div", { class: "questionnaire-list grade-check-panel" }, [
      h("div", { class: "list-head" }, [
        h("div", [
          h("h3", "文件收集"),
          h("p", "进入 Filestore 创建提交链接，集中收取作业、材料、照片等文件。"),
        ]),
        canManageFileCollect.value
          ? h("div", { class: "file-collect-entry-actions" }, [
            h("button", { class: "plain-action", type: "button", onClick: () => router.push("/services/tools/filestore") }, "旧版 Filestore"),
            h("button", { class: "plain-action beta-action", type: "button", onClick: () => router.push("/services/tools/filestore-beta") }, "Beta 工作台"),
          ])
          : null,
      ]),
      h("div", { class: "empty-panel" }, canManageFileCollect.value
        ? "在 Filestore 工作台创建任务、复制提交链接、查看提交记录和下载文件。"
        : "请通过发起者分享的文件收集链接上传文件。"),
    ]);
  },
});

const QuestionnaireForm = defineComponent({
  name: "QuestionnaireForm",
  props: {
    fields: { type: Array as () => QuestionnaireField[], required: true },
    answers: { type: Object as () => Record<string, string | string[]>, required: true },
    submitText: { type: String, default: "提交" },
    submitting: { type: Boolean, default: false },
  },
  emits: ["submit"],
  setup(props, { emit }) {
    function setValue(id: string, value: string | string[]) {
      props.answers[id] = value;
    }

    return () => h("form", {
      class: "questionnaire-form",
      onSubmit: (event: Event) => {
        event.preventDefault();
        emit("submit");
      },
    }, [
      ...props.fields.map((field) => h("label", { class: "field", key: field.id }, [
        h("span", [field.label, field.required ? h("b", " *") : null]),
        field.description ? h("small", field.description) : null,
        renderField(field, props.answers[field.id], setValue, props.submitting),
      ])),
      h("button", {
        class: "submit-btn",
        type: "submit",
        disabled: props.submitting,
      }, props.submitting ? "提交中..." : props.submitText),
    ]);
  },
});

function renderField(field: QuestionnaireField, value: string | string[] | undefined, setValue: (id: string, value: string | string[]) => void, disabled = false) {
  if (field.type === "textarea") {
    return h("textarea", {
      value: String(value ?? ""),
      rows: 6,
      maxlength: field.maxLength ?? 2000,
      placeholder: field.placeholder ?? "",
      disabled,
      onInput: (event: Event) => setValue(field.id, (event.target as HTMLTextAreaElement).value),
    });
  }
  if (field.type === "single") {
    return h("select", {
      value: String(value ?? ""),
      disabled,
      onChange: (event: Event) => setValue(field.id, (event.target as HTMLSelectElement).value),
    }, [
      h("option", { value: "" }, "请选择"),
      ...(field.options ?? []).map((option) => h("option", { value: option }, option)),
    ]);
  }
  if (field.type === "multiple") {
    const selected = Array.isArray(value) ? value : [];
    return h("div", { class: "choice-list" }, (field.options ?? []).map((option) => h("label", { class: ["choice-item", disabled ? "disabled" : ""] }, [
      h("input", {
        type: "checkbox",
        checked: selected.includes(option),
        disabled,
        onChange: (event: Event) => {
          const checked = (event.target as HTMLInputElement).checked;
          setValue(field.id, checked ? [...selected, option] : selected.filter((item) => item !== option));
        },
      }),
      h("span", option),
    ])));
  }
  if (field.type === "number") {
    return h("input", {
      value: String(value ?? ""),
      type: "number",
      min: field.min,
      max: field.max,
      step: field.step ?? 1,
      placeholder: field.placeholder ?? "",
      disabled,
      onInput: (event: Event) => setValue(field.id, (event.target as HTMLInputElement).value),
    });
  }
  if (field.type === "date") {
    return h("input", {
      value: String(value ?? ""),
      type: "date",
      disabled,
      onInput: (event: Event) => setValue(field.id, (event.target as HTMLInputElement).value),
    });
  }
  if (field.type === "rating") {
    const min = Math.max(0, Math.round(field.min ?? 1));
    const max = Math.min(10, Math.round(field.max ?? 5));
    return h("div", { class: "rating-list" }, Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => String(min + i)).map((score) => h("button", {
      type: "button",
      class: ["rating-btn", String(value ?? "") === score ? "active" : ""],
      disabled,
      onClick: () => setValue(field.id, score),
    }, score)));
  }
  return h("input", {
    value: String(value ?? ""),
    maxlength: field.maxLength ?? 300,
    placeholder: field.placeholder ?? "",
    disabled,
    onInput: (event: Event) => setValue(field.id, (event.target as HTMLInputElement).value),
  });
}

function normalizeFeedbackLoadError(error: unknown) {
  const status = (error as { response?: { status?: number; data?: { message?: string } } })?.response?.status;
  if (status && status < 500) {
    return (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "反馈问卷加载失败";
  }
  return "反馈问卷加载失败，请稍后再试";
}

function uniqueToolCodes(items: ServiceToolCode[]) {
  return Array.from(new Set(items));
}
</script>

<style>
.tool-detail-page { display: flex; flex-direction: column; gap: 18px; }
.tool-shell,
.missing-card {
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.tool-shell { padding: 20px 22px 22px; }
.tool-head { display: flex; flex-direction: column; gap: 16px; margin-bottom: 18px; }
.back-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--cpu-border);
  border-radius: 8px;
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.back-btn:hover { color: var(--cpu-primary); border-color: var(--cpu-primary); }
.head-main { display: flex; gap: 14px; align-items: flex-start; }
.head-icon {
  width: 50px;
  height: 50px;
  border-radius: 12px;
  background: var(--cpu-surface-subtle);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}
.head-icon .el-icon { font-size: 26px; }
.head-copy { flex: 1; min-width: 0; }
.head-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.head-title-row h2 { margin: 0; color: var(--cpu-text); font-size: 22px; }
.head-main p { margin: 6px 0 0; color: var(--cpu-text-secondary); font-size: 13px; line-height: 1.7; }
.manage-btn { flex: 0 0 auto; }
.missing-card { padding: 28px; }
.tool-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
}
.form-card,
.side-note,
.questionnaire-list {
  border: 1px solid var(--cpu-border-soft);
  border-radius: 10px;
  background: var(--cpu-card);
}
.form-card { padding: 18px; }
.form-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
.form-head-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: var(--cpu-primary);
  background: rgba(16, 185, 129, 0.12);
  flex: 0 0 auto;
}
.form-head-icon .el-icon,
.form-head-icon svg { width: 22px; height: 22px; }
.form-head h3,
.side-note h3,
.questionnaire-list h3 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 16px;
}
.form-head p,
.side-note p,
.questionnaire-list p {
  margin: 5px 0 0;
  color: var(--cpu-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}
.questionnaire-form { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 7px; color: var(--cpu-text-secondary); font-size: 13px; font-weight: 600; }
.field b { color: #dc2626; }
.field small { color: var(--cpu-text-secondary); font-size: 12px; font-weight: 400; line-height: 1.6; }
.field input,
.field select,
.field textarea {
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--cpu-border);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--cpu-text);
  font: inherit;
  line-height: 1.5;
  outline: none;
  background: var(--cpu-card);
}
.field textarea { resize: vertical; min-height: 132px; }
.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: var(--cpu-primary);
  box-shadow: 0 0 0 2px rgba(22, 135, 118, 0.1);
}
.choice-list { display: flex; flex-wrap: wrap; gap: 8px; }
.choice-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid var(--cpu-border);
  border-radius: 8px;
  background: var(--cpu-card);
  font-weight: 500;
}
.choice-item input { width: auto; }
.choice-item.disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.rating-list { display: flex; flex-wrap: wrap; gap: 8px; }
.rating-btn {
  width: 34px;
  height: 34px;
  border: 1px solid var(--cpu-border);
  border-radius: 8px;
  background: var(--cpu-card);
  color: var(--cpu-text-secondary);
  cursor: pointer;
  font: inherit;
  font-weight: 650;
}
.rating-btn.active {
  color: #fff;
  border-color: var(--cpu-primary);
  background: var(--cpu-primary);
}
.rating-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.submit-btn,
.plain-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 116px;
  height: 40px;
  padding: 0 16px;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}
.submit-btn {
  border: 1px solid var(--cpu-primary);
  color: #fff;
  background: var(--cpu-primary);
}
.submit-btn:disabled { opacity: 0.7; cursor: not-allowed; }
.plain-action {
  border: 1px solid var(--cpu-primary);
  color: var(--cpu-primary);
  background: var(--cpu-card);
}
.side-note { padding: 16px; align-self: start; background: var(--cpu-surface-subtle); }
.note-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.note-list span {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--cpu-card);
  border: 1px solid var(--cpu-border-soft);
  color: var(--cpu-text-secondary);
  font-size: 12px;
}
.questionnaire-list { padding: 18px; }
.list-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.file-collect-entry-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.beta-action {
  color: #fff;
  background: var(--cpu-primary);
}
.loading-card,
.empty-panel {
  padding: 22px;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
  color: var(--cpu-text-secondary);
  text-align: center;
}
.empty-panel-copy { margin: 0; }
.related-grade-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.related-grade-item {
  width: 100%;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 12px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 8px;
  background: var(--cpu-card);
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  min-width: 0;
  overflow: hidden;
  transition: border-color 0.16s, box-shadow 0.16s, transform 0.16s;
}
.related-grade-item:hover {
  border-color: #93c5fd;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.1);
  transform: translateY(-1px);
}
.related-grade-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: #2563eb;
  background: #eff6ff;
}
.related-grade-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.related-grade-main b {
  color: var(--cpu-text);
  overflow-wrap: anywhere;
}
.related-grade-main small {
  color: var(--cpu-text-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.related-grade-action {
  color: #2563eb;
  font-size: 13px;
  font-weight: 650;
}
@media (max-width: 800px) {
  .tool-shell { padding: 16px; }
  .tool-content { grid-template-columns: 1fr; }
  .side-note { align-self: stretch; }
  .back-btn { height: 40px; }
}
@media (max-width: 520px) {
  .head-main { flex-direction: column; }
  .head-title-row h2 { font-size: 20px; }
  .head-copy,
  .head-title-row {
    width: 100%;
  }
  .manage-btn,
  .submit-btn,
  .plain-action { width: 100%; }
  .choice-list {
    display: grid;
    grid-template-columns: 1fr;
  }
  .choice-item {
    width: 100%;
  }
  .rating-btn {
    width: 40px;
    height: 40px;
  }
  .list-head { flex-direction: column; align-items: stretch; }
  .related-grade-item {
    grid-template-columns: 34px minmax(0, 1fr);
    min-height: 80px;
  }
  .related-grade-action {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
