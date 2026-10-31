<template>
  <div class="ai-management-pane">
    <header class="pane-heading">
      <div>
        <h2>AI 管理</h2>
        <p>在一个入口里管理服务线路、功能与审核、统一日志、用户额度和学习通题库。</p>
      </div>
      <el-radio-group v-model="section" class="section-switch">
        <el-radio-button value="routing">服务线路</el-radio-button>
        <el-radio-button value="configuration">功能与审核</el-radio-button>
        <el-radio-button value="usage">使用日志</el-radio-button>
        <el-radio-button value="quota">额度与策略</el-radio-button>
        <el-radio-button value="answer-bank">学习通题库</el-radio-button>
      </el-radio-group>
    </header>

    <AiRoutingPane v-if="section === 'routing'" />
    <AiReviewPane v-else-if="section === 'configuration'" />
    <AiUsagePane v-else-if="section === 'usage'" />
    <LearningAnswerBankPane v-else-if="section === 'answer-bank'" />
    <AiQuotaPane v-else />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";

const AiRoutingPane = defineAsyncComponent(() => import("./AiRoutingPane.vue"));
const AiReviewPane = defineAsyncComponent(() => import("./AiReviewPane.vue"));
const AiUsagePane = defineAsyncComponent(() => import("./AiUsagePane.vue"));
const AiQuotaPane = defineAsyncComponent(() => import("./AiQuotaPane.vue"));
const LearningAnswerBankPane = defineAsyncComponent(() => import("./LearningAnswerBankPane.vue"));

const section = ref<"routing" | "configuration" | "usage" | "quota" | "answer-bank">("routing");
</script>

<style scoped>
.ai-management-pane {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.pane-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 4px 2px 0;
}

.pane-heading h2 {
  margin: 0;
  color: var(--cpu-text);
  font-size: 22px;
}

.pane-heading p {
  margin: 6px 0 0;
  color: var(--cpu-text-muted);
  font-size: 13px;
}

.section-switch {
  flex-shrink: 0;
}

@media (max-width: 820px) {
  .pane-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .section-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .section-switch :deep(.el-radio-button),
  .section-switch :deep(.el-radio-button__inner) {
    width: 100%;
  }
}
</style>
