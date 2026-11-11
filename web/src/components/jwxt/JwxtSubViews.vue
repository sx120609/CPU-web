<template>
  <!-- 一个标签里的几个相关视图（例如 成绩：课程成绩 / 等级考试 / 成绩单）。打开过的视图保持挂载，切回来不丢筛选。 -->
  <div class="sub-views">
    <div v-if="views.length > 1" class="sub-switch" role="tablist" :aria-label="label" :style="{ '--sub-count': views.length }">
      <button
        v-for="view in views"
        :id="`${idPrefix}-tab-${view.key}`"
        :key="view.key"
        type="button"
        role="tab"
        class="sub-btn"
        :class="{ active: current === view.key }"
        :aria-selected="current === view.key"
        :aria-controls="`${idPrefix}-panel-${view.key}`"
        @click="select(view.key)"
      >{{ view.label }}</button>
    </div>
    <div
      v-for="view in views"
      v-show="current === view.key"
      :id="`${idPrefix}-panel-${view.key}`"
      :key="view.key"
      class="sub-panel"
      role="tabpanel"
      :aria-labelledby="`${idPrefix}-tab-${view.key}`"
    >
      <slot v-if="visited.has(view.key)" :name="view.key" :active="active && current === view.key" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  views: Array<{ key: string; label: string }>;
  label: string;
  idPrefix: string;
  active?: boolean;
}>(), { active: false });

// 视图清单随学校档案变化时（例如档案晚到一步），选中的视图不在清单里就回到第一个。
const chosen = ref(props.views[0]?.key ?? "");
const current = computed(() => (
  props.views.some((view) => view.key === chosen.value) ? chosen.value : props.views[0]?.key ?? ""
));
const visited = reactive(new Set<string>([current.value]));
watch(current, (key) => { if (key) visited.add(key); });

function select(key: string) {
  chosen.value = key;
  visited.add(key);
}
</script>

<style scoped lang="scss">
.sub-views { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
// 与成绩页“统计口径”开关同一种分段样式。
.sub-switch {
  display: inline-grid;
  grid-template-columns: repeat(var(--sub-count), minmax(84px, 1fr));
  gap: 2px;
  align-self: flex-start;
  max-width: 100%;
  padding: 3px;
  border: 1px solid var(--cpu-border-soft);
  border-radius: var(--cpu-radius-m);
  background: var(--cpu-surface-subtle);
}
.sub-btn {
  min-width: 0;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--cpu-radius-s);
  background: transparent;
  color: var(--cpu-text-secondary);
  font: inherit;
  font-size: var(--cpu-fs-s);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.sub-btn:hover { color: var(--cpu-primary); }
.sub-btn.active { background: var(--cpu-card); color: var(--cpu-primary); }
.sub-btn:focus-visible { outline: 2px solid var(--cpu-primary-soft); outline-offset: 2px; }
.sub-panel { min-width: 0; }

@media (max-width: 640px) {
  .sub-switch { display: grid; align-self: stretch; grid-template-columns: repeat(var(--sub-count), minmax(0, 1fr)); }
  .sub-btn { padding: 0 4px; }
}
</style>
