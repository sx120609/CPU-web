<template>
  <el-tooltip v-if="meta" :content="meta.hint" placement="top">
    <span
      class="academic-data-source-badge"
      :class="`is-${meta.tone}`"
      :aria-label="`当前数据来自${meta.label}`"
      role="status"
    >
      <span class="source-dot" aria-hidden="true"></span>
      {{ meta.label }}
    </span>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ source?: unknown }>();

const meta = computed(() => {
  if (props.source === "modern") {
    return {
      label: "新版教务",
      hint: "本次展示的数据由新版教务接口返回。",
      tone: "modern" as const,
    };
  }
  if (props.source === "legacy") {
    return {
      label: "旧版教务",
      hint: "本次展示的数据由旧版教务接口返回。",
      tone: "legacy" as const,
    };
  }
  return null;
});
</script>

<style scoped>
.academic-data-source-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-height: 24px;
  padding: 3px 9px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: 999px;
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  box-sizing: border-box;
}

.source-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
}

.academic-data-source-badge.is-modern {
  border-color: color-mix(in srgb, var(--cpu-primary) 22%, var(--cpu-border-soft));
  background: color-mix(in srgb, var(--cpu-primary) 7%, var(--cpu-card));
  color: var(--cpu-primary);
}

.academic-data-source-badge.is-legacy {
  border-color: color-mix(in srgb, #d97706 24%, var(--cpu-border-soft));
  background: color-mix(in srgb, #f59e0b 8%, var(--cpu-card));
  color: #b45309;
}
</style>
