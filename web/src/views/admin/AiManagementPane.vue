<template>
  <div class="ai-management-pane">
    <header class="pane-heading">
      <div>
        <h2>AI 管理</h2>
        <p>在一个入口里管理模型与审核、统一日志和用户额度。</p>
      </div>
      <el-radio-group v-model="section" class="section-switch">
        <el-radio-button value="configuration">配置与审核</el-radio-button>
        <el-radio-button value="usage">使用日志</el-radio-button>
        <el-radio-button value="quota">额度与策略</el-radio-button>
      </el-radio-group>
    </header>

    <AiReviewPane v-if="section === 'configuration'" />
    <AiUsagePane v-else-if="section === 'usage'" />
    <AiQuotaPane v-else />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";

const AiReviewPane = defineAsyncComponent(() => import("./AiReviewPane.vue"));
const AiUsagePane = defineAsyncComponent(() => import("./AiUsagePane.vue"));
const AiQuotaPane = defineAsyncComponent(() => import("./AiQuotaPane.vue"));

const section = ref<"configuration" | "usage" | "quota">("configuration");
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .section-switch :deep(.el-radio-button),
  .section-switch :deep(.el-radio-button__inner) {
    width: 100%;
  }
}
</style>
