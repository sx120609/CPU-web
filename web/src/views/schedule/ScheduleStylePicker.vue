<template>
  <!-- 选课表风格。每种风格用的是同一份课程数据和同样的点按行为，选了立刻生效。 -->
  <div class="style-picker" role="radiogroup" aria-label="选择课表风格">
    <button
      v-for="option in scheduleStyleOptions"
      :key="option.key"
      type="button"
      class="style-choice"
      :class="{ active: option.key === modelValue }"
      role="radio"
      :aria-checked="option.key === modelValue"
      @click="emit('update:modelValue', option.key)"
    >
      <!-- 缩略图用真正的周网格按原尺寸画出来再缩小。 -->
      <span class="style-preview" :style="previewVars(option.key)" aria-hidden="true">
        <span class="style-preview-canvas">
          <StyledWeekGrid
            :visual-style="option.key"
            :palette="palette"
            :dark="dark"
            :days="sampleDays"
            :clocks="sampleClocks"
          />
        </span>
      </span>
      <span class="style-text">
        <b>{{ option.title }}</b>
        <small>{{ option.subtitle }}</small>
      </span>
      <el-icon v-if="option.key === modelValue" class="style-check"><CircleCheckFilled /></el-icon>
    </button>
    <p class="style-note">课表风格不改变课程数据、课程配色或背景图片。</p>
  </div>
</template>

<script setup lang="ts">
import { CircleCheckFilled } from "@element-plus/icons-vue";
import StyledWeekGrid from "./StyledWeekGrid.vue";
import { placeCourseBlocks } from "./displayPriority";
import { scheduleStyleCssVars, scheduleStyleOptions, type ScheduleStyleKey } from "./scheduleStyle";
import type { StyledDay } from "./styledTypes";
import type { WeekCourseBlock } from "./types";

const props = defineProps<{
  modelValue: ScheduleStyleKey;
  /** 课程配色，缩略图用的就是课表会用的颜色。 */
  palette: string;
  dark: boolean;
}>();

const emit = defineEmits<{ (event: "update:modelValue", value: ScheduleStyleKey): void }>();

const sampleClocks = [
  { no: 1, start: "08:00", end: "08:45" },
  { no: 2, start: "08:55", end: "09:40" },
  { no: 3, start: "09:55", end: "10:40" },
  { no: 4, start: "10:50", end: "11:35" },
];

function sample(day: number, name: string, start: number): StyledDay {
  const block: WeekCourseBlock = {
    day,
    bigSlot: Math.ceil(start / 2),
    startSlot: start,
    endSlot: start + 1,
    index: 0,
    course: { name, weeks: "", weekList: [], location: `A10${day}` },
  };
  return {
    day,
    dateText: `10/0${day + 5}`,
    rawDate: `2026-10-0${day + 5}`,
    isToday: false,
    adjustmentKind: null,
    pieces: placeCourseBlocks([block]),
  };
}

// 每门示例课占两节。
const sampleDays = [sample(1, "高等数学", 1), sample(2, "大学英语", 3), sample(3, "药物化学", 1)];

function previewVars(style: ScheduleStyleKey) {
  return scheduleStyleCssVars({ style, palette: props.palette, dark: props.dark });
}
</script>

<style scoped lang="scss">
.style-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.style-choice {
  width: 100%;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: var(--cpu-radius-m, 10px);
  background: transparent;
  color: var(--schedule-text);
  font: inherit;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  touch-action: manipulation;
}
.style-choice:hover,
.style-choice.active {
  background: var(--schedule-surface-bg-soft);
}
.style-choice.active {
  border-color: var(--schedule-border);
}
.style-preview {
  position: relative;
  flex: 0 0 82px;
  width: 82px;
  height: 59px;
  overflow: hidden;
  border-radius: 5px;
  pointer-events: none;
}
// 整张画布用一个比例缩小，面板的边就不会被切掉。
.style-preview-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 264px;
  height: 190px;
  transform: scale(0.3106);
  transform-origin: top left;
  display: block;
}
.style-preview-canvas :deep(.ss-week) {
  --ss-row-min: 32px;
  --ss-axis-width: 0px;
  min-height: 0;
  height: 190px;
  padding: 8px;
  border-radius: 12px;
}
.style-preview-canvas :deep(.ss-table),
.style-preview-canvas :deep(.ss-paper),
.style-preview-canvas :deep(.ss-board) {
  border-radius: 2px;
}
.style-preview-canvas :deep(.ss-axis-head),
.style-preview-canvas :deep(.ss-slot-label) {
  display: none;
}
.style-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.style-text b {
  font-size: var(--cpu-fs-m, 15px);
  font-weight: 600;
}
.style-text small {
  color: var(--schedule-text-secondary);
  font-size: var(--cpu-fs-xs, 12px);
  line-height: 1.35;
}
.style-check {
  flex: 0 0 auto;
  color: var(--schedule-accent);
  font-size: 18px;
}
.style-note {
  margin: 6px 4px 2px;
  color: var(--schedule-text-muted);
  font-size: var(--cpu-fs-xs, 12px);
  line-height: 1.5;
}
</style>
