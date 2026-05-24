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
              <el-tag size="small" type="success" effect="plain" round>可用</el-tag>
            </div>
            <p>{{ tool.description }}</p>
          </div>
          <el-button v-if="canManage" plain type="primary" class="manage-btn" @click="$router.push('/services/tools/manage')">
            <el-icon><Setting /></el-icon>
            管理
          </el-button>
        </div>
      </div>

      <FeedbackPanel v-if="tool.componentKey === 'feedback'" />
      <QuestionnairePanel v-else />
    </section>

    <section v-else class="missing-card">
      <el-empty description="没有找到这个小工具">
        <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowLeft, DocumentChecked, EditPen, Setting } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { getToken } from "@/api/request";
import { toolsApi, type Questionnaire, type QuestionnaireField, type ServiceToolCode } from "@/api/tools";
import { findServiceTool } from "@/data/serviceTools";

const route = useRoute();
const router = useRouter();
const tool = computed(() => findServiceTool(String(route.params.slug || "")));
const manageable = ref<ServiceToolCode[]>([]);
const canManage = computed(() => Boolean(tool.value && manageable.value.includes(tool.value.slug as ServiceToolCode)));

onMounted(async () => {
  if (!getToken()) return;
  try {
    manageable.value = (await toolsApi.myPermissions()).toolCodes;
  } catch {
    manageable.value = [];
  }
});

const FeedbackPanel = defineComponent({
  name: "FeedbackPanel",
  setup() {
    const loading = ref(false);
    const submitting = ref(false);
    const questionnaire = ref<Questionnaire | null>(null);
    const answers = reactive<Record<string, string | string[]>>({});

    onMounted(load);

    async function load() {
      loading.value = true;
      try {
        questionnaire.value = await toolsApi.questionnaire("system-feedback");
        for (const field of questionnaire.value.fields ?? []) {
          answers[field.id] = field.type === "multiple" ? [] : "";
        }
      } finally {
        loading.value = false;
      }
    }

    async function submit() {
      if (!questionnaire.value) return;
      submitting.value = true;
      try {
        await toolsApi.submitResponse(questionnaire.value.slug, answers);
        for (const field of questionnaire.value.fields ?? []) {
          answers[field.id] = field.type === "multiple" ? [] : "";
        }
        ElMessage.success("已提交反馈");
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
    const loading = ref(false);
    const list = ref<Questionnaire[]>([]);
    const canManageQuestionnaire = computed(() => manageable.value.includes("questionnaire"));

    onMounted(load);

    async function load() {
      loading.value = true;
      try {
        list.value = await toolsApi.questionnaires({ toolCode: "questionnaire" });
      } finally {
        loading.value = false;
      }
    }

    return () => h("div", { class: "questionnaire-list" }, [
      h("div", { class: "list-head" }, [
        h("div", [
          h("h3", "可填写问卷"),
          h("p", "公开问卷会显示在这里，点击后进入填写页。"),
        ]),
        canManageQuestionnaire.value
          ? h("button", { class: "plain-action", type: "button", onClick: () => router.push("/services/tools/manage") }, "创建问卷")
          : null,
      ]),
      loading.value
        ? h("div", { class: "loading-card" }, "正在加载问卷...")
        : list.value.length
          ? h("div", { class: "questionnaire-grid" }, list.value.map((item) => h("button", {
            class: "questionnaire-card",
            type: "button",
            onClick: () => router.push({ name: "questionnaire-fill", params: { slug: item.slug } }),
          }, [
            h("span", { class: "q-icon" }, [h(DocumentChecked)]),
            h("span", { class: "q-main" }, [
              h("span", { class: "q-title" }, item.title),
              h("span", { class: "q-desc" }, item.description || "点击填写问卷"),
            ]),
            h("span", { class: "q-meta" }, item.visibility === "login" ? "需登录" : "公开"),
          ])))
          : h("div", { class: "empty-panel" }, "暂时没有开放中的问卷"),
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
        renderField(field, props.answers[field.id], setValue),
      ])),
      h("button", {
        class: "submit-btn",
        type: "submit",
        disabled: props.submitting,
      }, props.submitting ? "提交中..." : props.submitText),
    ]);
  },
});

function renderField(field: QuestionnaireField, value: string | string[] | undefined, setValue: (id: string, value: string | string[]) => void) {
  if (field.type === "textarea") {
    return h("textarea", {
      value: String(value ?? ""),
      rows: 6,
      maxlength: field.maxLength ?? 2000,
      placeholder: field.placeholder ?? "",
      onInput: (event: Event) => setValue(field.id, (event.target as HTMLTextAreaElement).value),
    });
  }
  if (field.type === "single") {
    return h("select", {
      value: String(value ?? ""),
      onChange: (event: Event) => setValue(field.id, (event.target as HTMLSelectElement).value),
    }, [
      h("option", { value: "" }, "请选择"),
      ...(field.options ?? []).map((option) => h("option", { value: option }, option)),
    ]);
  }
  if (field.type === "multiple") {
    const selected = Array.isArray(value) ? value : [];
    return h("div", { class: "choice-list" }, (field.options ?? []).map((option) => h("label", { class: "choice-item" }, [
      h("input", {
        type: "checkbox",
        checked: selected.includes(option),
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
      onInput: (event: Event) => setValue(field.id, (event.target as HTMLInputElement).value),
    });
  }
  if (field.type === "date") {
    return h("input", {
      value: String(value ?? ""),
      type: "date",
      onInput: (event: Event) => setValue(field.id, (event.target as HTMLInputElement).value),
    });
  }
  if (field.type === "rating") {
    const min = Math.max(0, Math.round(field.min ?? 1));
    const max = Math.min(10, Math.round(field.max ?? 5));
    return h("div", { class: "rating-list" }, Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => String(min + i)).map((score) => h("button", {
      type: "button",
      class: ["rating-btn", String(value ?? "") === score ? "active" : ""],
      onClick: () => setValue(field.id, score),
    }, score)));
  }
  return h("input", {
    value: String(value ?? ""),
    maxlength: field.maxLength ?? 300,
    placeholder: field.placeholder ?? "",
    onInput: (event: Event) => setValue(field.id, (event.target as HTMLInputElement).value),
  });
}
</script>

<style>
.tool-detail-page { display: flex; flex-direction: column; gap: 18px; }
.tool-shell,
.missing-card {
  background: #fff;
  border: 1px solid #eef0f4;
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
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #4b5563;
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
  background: #f9fafb;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}
.head-icon .el-icon { font-size: 26px; }
.head-copy { flex: 1; min-width: 0; }
.head-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.head-title-row h2 { margin: 0; color: #111827; font-size: 22px; }
.head-main p { margin: 6px 0 0; color: #6b7280; font-size: 13px; line-height: 1.7; }
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
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
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
  background: #ecfdf5;
  flex: 0 0 auto;
}
.form-head-icon .el-icon,
.form-head-icon svg { width: 22px; height: 22px; }
.form-head h3,
.side-note h3,
.questionnaire-list h3 {
  margin: 0;
  color: #111827;
  font-size: 16px;
}
.form-head p,
.side-note p,
.questionnaire-list p {
  margin: 5px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}
.questionnaire-form { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 7px; color: #374151; font-size: 13px; font-weight: 600; }
.field b { color: #dc2626; }
.field small { color: #6b7280; font-size: 12px; font-weight: 400; line-height: 1.6; }
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
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  font-weight: 500;
}
.choice-item input { width: auto; }
.rating-list { display: flex; flex-wrap: wrap; gap: 8px; }
.rating-btn {
  width: 34px;
  height: 34px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #4b5563;
  cursor: pointer;
  font: inherit;
  font-weight: 650;
}
.rating-btn.active {
  color: #fff;
  border-color: var(--cpu-primary);
  background: var(--cpu-primary);
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
  background: #fff;
}
.side-note { padding: 16px; align-self: start; background: #f9fafb; }
.note-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.note-list span {
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #eef0f4;
  color: #4b5563;
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
.questionnaire-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.questionnaire-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 104px;
  padding: 14px;
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.questionnaire-card:hover { border-color: var(--cpu-primary); box-shadow: 0 6px 18px rgba(22, 135, 118, 0.1); }
.q-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: #d97706;
  background: #fff7ed;
  flex: 0 0 auto;
}
.q-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.q-title { color: #111827; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-desc { color: #6b7280; font-size: 12px; line-height: 1.5; }
.q-meta { color: #9ca3af; font-size: 12px; flex: 0 0 auto; }
.loading-card,
.empty-panel {
  padding: 22px;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
  color: #6b7280;
  text-align: center;
}
@media (max-width: 800px) {
  .tool-shell { padding: 16px; }
  .tool-content { grid-template-columns: 1fr; }
  .side-note { align-self: stretch; }
}
@media (max-width: 520px) {
  .head-main { flex-direction: column; }
  .head-title-row h2 { font-size: 20px; }
  .manage-btn,
  .submit-btn,
  .plain-action { width: 100%; }
  .list-head { flex-direction: column; align-items: stretch; }
  .questionnaire-grid { grid-template-columns: 1fr; }
}
</style>
