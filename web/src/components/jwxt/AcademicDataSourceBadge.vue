<template>
  <!-- 触屏设备没有悬停：提示改为点按打开，再点一次或点别处关闭。 -->
  <el-tooltip v-if="meta" :content="meta.hint" placement="top" :trigger="canHover ? 'hover' : 'click'">
    <button
      data-cpu-button="surface"
      type="button"
      class="academic-data-source-badge"
      :class="`is-${meta.tone}`"
      :aria-label="`当前数据来自${meta.label}。${meta.hint}`"
    >
      <span class="source-dot" aria-hidden="true"></span>
      {{ meta.label }}
    </button>
  </el-tooltip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useFormFactor } from "@/utils/formFactor";

const props = defineProps<{ source?: unknown }>();
const formFactor = useFormFactor();
const canHover = computed(() => formFactor.value.canHover);

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
  border-radius: var(--cpu-radius-pill);
  background: var(--cpu-surface-subtle);
  color: var(--cpu-text-secondary);
  font-size: var(--cpu-fs-xs);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  box-sizing: border-box;
  margin: 0;
  font-family: inherit;
  cursor: help;
}

.source-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
}

.academic-data-source-badge.is-modern {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-primary-soft);
  color: var(--cpu-primary);
}

.academic-data-source-badge.is-legacy {
  border-color: var(--cpu-border-soft);
  background: var(--cpu-accent-soft);
  color: var(--cpu-accent);
}
</style>
