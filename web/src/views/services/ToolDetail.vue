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
          <div>
            <div class="head-title-row">
              <h2>{{ tool.name }}</h2>
              <el-tag
                size="small"
                :type="tool.status === 'ready' ? 'success' : 'info'"
                effect="plain"
                round
              >
                {{ tool.status === "ready" ? "可用" : "待开发" }}
              </el-tag>
            </div>
            <p>{{ tool.description }}</p>
          </div>
        </div>
      </div>

      <component :is="currentComponent" :tool="tool" />
    </section>

    <section v-else class="missing-card">
      <el-empty description="没有找到这个小工具">
        <el-button type="primary" @click="$router.push('/services/tools')">返回小工具</el-button>
      </el-empty>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref } from "vue";
import { ArrowLeft, DocumentChecked, Finished, Message, Tools } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { useRoute } from "vue-router";
import { findServiceTool, type ServiceTool } from "@/data/serviceTools";

const route = useRoute();
const tool = computed(() => findServiceTool(String(route.params.slug || "")));

const FeedbackTool = defineComponent({
  name: "FeedbackTool",
  props: {
    tool: {
      type: Object as () => ServiceTool,
      required: true,
    },
  },
  setup(props) {
    const category = ref("工具建议");
    const content = ref("");
    const contact = ref("");

    function submit() {
      const text = content.value.trim();
      if (text.length < 5) {
        ElMessage.warning("再多写一点点，方便后面处理");
        return;
      }
      const saved = {
        category: category.value,
        content: text,
        contact: contact.value.trim(),
        createdAt: new Date().toISOString(),
      };
      const key = "cpu-service-tool-feedback";
      const oldList = readFeedbackList(key);
      localStorage.setItem(key, JSON.stringify([saved, ...oldList].slice(0, 20)));
      content.value = "";
      contact.value = "";
      ElMessage.success("已暂存反馈，后续可接入后端提交");
    }

    function readFeedbackList(key: string): any[] {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    return () => h("div", { class: "feedback-tool" }, [
      h("div", { class: "form-card" }, [
        h("div", { class: "form-head" }, [
          h("span", { class: "form-head-icon" }, [h(Message)]),
          h("div", [
            h("h3", props.tool.name),
            h("p", "想要新的校园小工具，或者使用时遇到问题，都可以先记在这里。"),
          ]),
        ]),
        h("label", { class: "field" }, [
          h("span", "类型"),
          h("select", {
            value: category.value,
            onChange: (event: Event) => {
              category.value = (event.target as HTMLSelectElement).value;
            },
          }, [
            h("option", "工具建议"),
            h("option", "问题反馈"),
            h("option", "问卷需求"),
            h("option", "其他"),
          ]),
        ]),
        h("label", { class: "field" }, [
          h("span", "内容"),
          h("textarea", {
            value: content.value,
            rows: 6,
            maxlength: 500,
            placeholder: "想要什么小工具、希望怎么用，或者遇到了什么问题...",
            onInput: (event: Event) => {
              content.value = (event.target as HTMLTextAreaElement).value;
            },
          }),
          h("em", `${content.value.length} / 500`),
        ]),
        h("label", { class: "field" }, [
          h("span", "联系方式"),
          h("input", {
            value: contact.value,
            maxlength: 80,
            placeholder: "选填，例如 QQ / 邮箱 / 站内昵称",
            onInput: (event: Event) => {
              contact.value = (event.target as HTMLInputElement).value;
            },
          }),
        ]),
        h("button", { class: "submit-btn", type: "button", onClick: submit }, [
          h(Finished),
          h("span", "暂存反馈"),
        ]),
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

const PlaceholderTool = defineComponent({
  name: "PlaceholderTool",
  props: {
    tool: {
      type: Object as () => ServiceTool,
      required: true,
    },
  },
  setup(props) {
    return () => h("div", { class: "placeholder-tool" }, [
      h("span", { class: "placeholder-icon" }, [h(DocumentChecked)]),
      h("h3", `${props.tool.name}功能预留中`),
      h("p", props.tool.summary),
      h("div", { class: "placeholder-steps" }, [
        h("span", [h(Tools), " 入口已预留"]),
        h("span", [h(DocumentChecked), " 能力建设中"]),
        h("span", [h(Finished), " 完成后开放"]),
      ]),
    ]);
  },
});

const componentMap = {
  feedback: FeedbackTool,
  placeholder: PlaceholderTool,
};

const currentComponent = computed(() => componentMap[tool.value?.componentKey ?? "placeholder"]);
</script>

<style scoped>
.tool-detail-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.tool-shell,
.missing-card {
  background: #fff;
  border: 1px solid #eef0f4;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}

.tool-shell {
  padding: 20px 22px 22px;
}

.tool-head {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 18px;
}

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

.back-btn:hover {
  color: var(--cpu-primary);
  border-color: var(--cpu-primary);
}

.head-main {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.head-icon {
  width: 50px;
  height: 50px;
  border-radius: 12px;
  background: #f9fafb;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.head-icon .el-icon {
  font-size: 26px;
}

.head-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.head-title-row h2 {
  margin: 0;
  color: #111827;
  font-size: 22px;
}

.head-main p {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}

.missing-card {
  padding: 28px;
}

:deep(.feedback-tool) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 14px;
}

:deep(.form-card),
:deep(.side-note),
:deep(.placeholder-tool) {
  border: 1px solid #eef0f4;
  border-radius: 10px;
  background: #fff;
}

:deep(.form-card) {
  padding: 18px;
}

:deep(.form-head) {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 16px;
}

:deep(.form-head-icon) {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: var(--cpu-primary);
  background: #ecfdf5;
  flex: 0 0 auto;
}

:deep(.form-head svg) {
  width: 22px;
  height: 22px;
}

:deep(.form-head h3),
:deep(.side-note h3),
:deep(.placeholder-tool h3) {
  margin: 0;
  color: #111827;
  font-size: 16px;
}

:deep(.form-head p),
:deep(.side-note p),
:deep(.placeholder-tool p) {
  margin: 5px 0 0;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}

:deep(.field) {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 12px;
  color: #374151;
  font-size: 13px;
  font-weight: 600;
}

:deep(.field input),
:deep(.field select),
:deep(.field textarea) {
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

:deep(.field textarea) {
  resize: vertical;
  min-height: 132px;
}

:deep(.field input:focus),
:deep(.field select:focus),
:deep(.field textarea:focus) {
  border-color: var(--cpu-primary);
  box-shadow: 0 0 0 2px rgba(22, 135, 118, 0.1);
}

:deep(.field em) {
  align-self: flex-end;
  color: #9ca3af;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
}

:deep(.submit-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 132px;
  height: 40px;
  margin-top: 16px;
  padding: 0 16px;
  border: 1px solid var(--cpu-primary);
  border-radius: 8px;
  color: #fff;
  background: var(--cpu-primary);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}

:deep(.submit-btn svg) {
  width: 18px;
  height: 18px;
}

:deep(.side-note) {
  padding: 16px;
  align-self: start;
  background: #f9fafb;
}

:deep(.note-list) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

:deep(.note-list span) {
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #eef0f4;
  color: #4b5563;
  font-size: 12px;
}

:deep(.placeholder-tool) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 34px 18px;
  text-align: center;
  background: #fafafa;
}

:deep(.placeholder-icon) {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: #d97706;
  background: #fff7ed;
}

:deep(.placeholder-icon svg) {
  width: 26px;
  height: 26px;
}

:deep(.placeholder-steps) {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}

:deep(.placeholder-steps span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid #fed7aa;
  border-radius: 999px;
  color: #9a3412;
  background: #fff7ed;
  font-size: 12px;
}

:deep(.placeholder-steps svg) {
  width: 15px;
  height: 15px;
}

@media (max-width: 800px) {
  .tool-shell {
    padding: 16px;
  }

  :deep(.feedback-tool) {
    grid-template-columns: 1fr;
  }

  :deep(.side-note) {
    align-self: stretch;
  }
}

@media (max-width: 520px) {
  .head-main {
    flex-direction: column;
  }

  .head-title-row h2 {
    font-size: 20px;
  }

  :deep(.form-card) {
    padding: 14px;
  }

  :deep(.submit-btn) {
    width: 100%;
  }
}
</style>
