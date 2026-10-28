<template>
  <!-- 课表周视图里一列上的日程。父组件把它放进那一列、跨满全部节次的格子里。 -->
  <div class="agenda-grid-layer" :class="{ centered, bare }" aria-hidden="false">
    <button
      v-for="chip in chips"
      :key="chip.key"
      type="button"
      class="agenda-grid-chip"
      :class="{ beside: chip.beside, done: chip.done }"
      :style="{ top: `${chip.top}%`, height: `${chip.height}%` }"
      :aria-label="`日程，${chip.item.title}，${chip.label}${chip.done ? '，已完成' : ''}`"
      :title="`${chip.label} ${chip.item.title}${chip.item.location ? ` @${chip.item.location}` : ''}`"
      @click.stop="emit('open', chip.item, chip.date)"
    >
      <span>{{ chip.done ? "✓ " : "" }}{{ chip.item.title }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { AgendaItem } from "@/utils/agenda";
import type { AgendaChip } from "./agendaChips";

// centered：课表样式把课名居中（经典、格子）；bare：样式的课本身没有底色（站牌）。
defineProps<{ chips: AgendaChip[]; centered?: boolean; bare?: boolean }>();

const emit = defineEmits<{
  (event: "open", item: AgendaItem, date: string): void;
}>();
</script>

<style scoped lang="scss">
.agenda-grid-layer {
  position: relative;
  pointer-events: none;
  z-index: 4;
  min-width: 0;
}
.agenda-grid-chip {
  position: absolute;
  left: 1px;
  right: 1px;
  min-height: 18px;
  box-sizing: border-box;
  padding: 2px 3px;
  // 字体、圆角、颜色跟着课表样式走（样式周视图给出 --agenda-* 变量），虚线框表明这是日程而不是课。
  border: 1px dashed var(--agenda-ink, var(--schedule-accent, var(--cpu-primary)));
  border-radius: var(--agenda-radius, 6px);
  background: var(--agenda-surface, var(--schedule-surface-bg, var(--cpu-card)));
  background: color-mix(in srgb, var(--agenda-tint, var(--schedule-accent, var(--cpu-primary))) var(--agenda-tint-share, 16%), var(--agenda-surface, var(--schedule-surface-bg, var(--cpu-card))));
  color: var(--agenda-ink, var(--schedule-accent-strong, var(--cpu-primary-dark)));
  font: inherit;
  font-size: 10px;
  line-height: 12px;
  font-weight: 600;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
}
.agenda-grid-chip span {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  word-break: break-all;
}
.centered .agenda-grid-chip {
  justify-content: center;
  text-align: center;
}
.bare .agenda-grid-chip {
  background: transparent;
}
.agenda-grid-chip.beside {
  left: auto;
  width: 46%;
}
.agenda-grid-chip.done {
  opacity: 0.55;
}
.agenda-grid-chip.done span {
  text-decoration: line-through;
}
</style>
