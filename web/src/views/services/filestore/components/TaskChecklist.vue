<template>
  <div v-if="detail" class="fs-check">
    <section class="fs-check-block">
      <header>
        <div>
          <b>缺交名单</b>
          <span>{{ stats?.expected ? `名单 ${stats.expected} 人，${missing.length} 人未提交` : "未导入应提交名单" }}</span>
        </div>
        <el-button :icon="CopyDocument" :disabled="!missing.length" @click="copyMissing">复制名单</el-button>
      </header>
      <div v-if="missing.length" class="fs-check-chips is-warn">
        <span v-for="item in missing" :key="item">{{ item }}</span>
      </div>
      <p v-else class="fs-check-empty">{{ stats?.expected ? "名单内的人都已提交。" : "在任务设置第 5 步粘贴名单后，这里会列出未提交的人。" }}</p>
    </section>
    <section class="fs-check-block">
      <header>
        <div>
          <b>名单外提交</b>
          <span>身份信息不在名单里的提交，可能是填错了学号 / 考试号</span>
        </div>
      </header>
      <div v-if="unexpected.length" class="fs-check-chips is-info">
        <span v-for="item in unexpected" :key="item.id">{{ unexpectedLabel(item) }}<small v-if="item.name && item.identity">{{ item.name }}</small></span>
      </div>
      <p v-else class="fs-check-empty">暂无名单外提交。</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { CopyDocument } from "@element-plus/icons-vue";
import { unexpectedLabel } from "../shared";
import { useInjectedFilestoreWorkspace } from "../workspace";

const { detail, copyMissing } = useInjectedFilestoreWorkspace();
const stats = computed(() => detail.value?.stats);
const missing = computed(() => stats.value?.missing || []);
const unexpected = computed(() => stats.value?.unexpected || []);
</script>

<style scoped>
.fs-check { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.fs-check-block { display: flex; min-width: 0; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--cpu-border-soft); border-radius: 14px; background: var(--cpu-surface-soft); }
.fs-check-block header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.fs-check-block header > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.fs-check-block header b { font-size: 14px; font-weight: 650; }
.fs-check-block header span { color: var(--cpu-text-muted); font-size: 12px; line-height: 1.5; }
.fs-check-block header .el-button { flex: 0 0 auto; margin: 0; }
.fs-check-chips { --tone: var(--cpu-warn); display: flex; flex-wrap: wrap; gap: 6px; }
.fs-check-chips.is-info { --tone: #0284c7; }
.fs-check-chips span {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tone) 12%, var(--cpu-card));
  color: color-mix(in srgb, var(--tone) 85%, var(--cpu-text));
  font-family: var(--cpu-font-mono);
  font-size: 12px;
  font-weight: 600;
}
.fs-check-chips small { color: var(--cpu-text-secondary); font-family: var(--cpu-font-sans); font-size: 11px; font-weight: 500; }
.fs-check-empty { margin: 0; color: var(--cpu-text-muted); font-size: 12px; line-height: 1.6; }

@media (max-width: 960px) {
  .fs-check { grid-template-columns: minmax(0, 1fr); gap: 10px; }
}
@media (max-width: 768px) {
  .fs-check-block { border-radius: 16px; background: var(--cpu-card); box-shadow: var(--cpu-shadow-sm); }
}
</style>
