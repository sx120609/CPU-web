<template>
  <section v-if="detail" class="fs-metrics" aria-label="提交统计">
    <div class="fs-metrics-lead">
      <template v-if="stats?.expected">
        <span>名单内已提交</span>
        <b>{{ stats.inListSubmitted ?? 0 }}<small> / {{ stats.expected }}</small></b>
        <el-progress :percentage="completionRate" :stroke-width="8" :show-text="false" :status="completionRate >= 100 ? 'success' : undefined" />
        <small>完成率 {{ completionRate }}%</small>
      </template>
      <template v-else>
        <span>已提交</span>
        <b>{{ stats?.submitted || 0 }}</b>
        <small>未导入名单，无法计算完成率</small>
      </template>
    </div>
    <dl class="fs-metrics-grid">
      <div>
        <dt>总提交</dt>
        <dd>{{ stats?.submitted || 0 }}</dd>
      </div>
      <div :class="{ 'is-warn': stats?.missing?.length }">
        <dt>未提交</dt>
        <dd>{{ stats?.expected ? stats.missing?.length || 0 : "-" }}</dd>
      </div>
      <div :class="{ 'is-info': stats?.unexpected?.length }">
        <dt>名单外</dt>
        <dd>{{ stats?.expected ? stats.unexpected?.length || 0 : "-" }}</dd>
      </div>
      <div>
        <dt>文件</dt>
        <dd>{{ fileTotal(detail) }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { fileTotal } from "../shared";
import { useInjectedFilestoreWorkspace } from "../workspace";

const { detail, completionRate } = useInjectedFilestoreWorkspace();
const stats = computed(() => detail.value?.stats);
</script>

<style scoped lang="scss">
@use "../../../../styles/compact" as *;

.fs-metrics {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr);
  overflow: hidden;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-l);
  background: var(--cpu-card);
  box-shadow: var(--cpu-shadow-sm);
}
.fs-metrics-lead { display: flex; flex-direction: column; gap: 6px; padding: 16px 18px; border-right: 1px solid var(--cpu-border-soft); background: var(--cpu-primary-soft); }
.fs-metrics-lead > span { color: var(--cpu-text-secondary); font-size: var(--cpu-fs-xs); font-weight: 500; }
.fs-metrics-lead > b { font-size: 30px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
.fs-metrics-lead > b small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-l); font-weight: 500; }
.fs-metrics-lead > small { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.fs-metrics-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; }
.fs-metrics-grid > div { display: flex; flex-direction: column; justify-content: center; gap: 4px; padding: 14px 16px; }
.fs-metrics-grid > div + div { border-left: 1px solid var(--cpu-border-soft); }
.fs-metrics-grid dt { color: var(--cpu-text-muted); font-size: var(--cpu-fs-xs); }
.fs-metrics-grid dd { margin: 0; color: var(--cpu-text); font-size: var(--cpu-fs-xl); font-weight: 700; font-variant-numeric: tabular-nums; }
.fs-metrics-grid .is-warn dd { color: var(--cpu-warn); }
.fs-metrics-grid .is-info dd { color: var(--cpu-text-secondary); }
:global(html[data-theme="dark"] .fs-metrics-grid .is-info dd) { color: #38bdf8; }

// compact-header is "960 px or any compact layout": the phone tree on a tablet up to 1023 px keeps these too.
@include compact-header {
  .fs-metrics { grid-template-columns: minmax(0, 1fr); }
  .fs-metrics-lead { border-right: 0; border-bottom: 1px solid var(--cpu-border-soft); }
}
@include compact-layout {
  .fs-metrics-lead { padding: 14px; }
  .fs-metrics-lead > b { font-size: 26px; }
  .fs-metrics-grid > div { align-items: center; padding: 11px 4px; }
  .fs-metrics-grid dd { font-size: var(--cpu-fs-l); }
}
</style>
