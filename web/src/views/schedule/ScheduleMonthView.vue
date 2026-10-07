<template>
  <!-- 月视图不画节次网格，而是一张日历：每天一格，格子里是公历日、农历或节日和当天
       课程的彩色圆点，下面跟着所选那天的课程清单。 -->
  <section class="sm" :class="[`sm-${visualStyle}`, { 'sm-dark': dark }]">
    <div class="sm-calendar">
      <h3 v-if="visualStyle === 'paper'" class="sm-month-title">{{ paperTitle }}</h3>
      <div class="sm-weekdays">
        <span v-if="showsGutter" class="sm-gutter">周</span>
        <span v-for="(label, index) in weekdayLabels" :key="label" :class="{ weekend: index >= 5 }">{{ label }}</span>
      </div>
      <div v-for="row in rows" :key="row[0].date" class="sm-row">
        <span v-if="showsGutter" class="sm-gutter">{{ rowWeek(row) }}</span>
        <button
          v-for="item in row"
          :key="item.date"
          type="button"
          class="sm-day"
          :class="{
            selected: item.date === selectedDate,
            today: item.date === todayDate,
            outside: !item.inMonth,
            festival: item.isFestival,
            off: item.adjustment?.kind === 'off',
          }"
          :aria-label="dayLabel(item)"
          :aria-pressed="item.date === selectedDate"
          @click="emit('select', item.date)"
        >
          <b class="sm-number">{{ item.number }}</b>
          <small class="sm-subtitle">{{ item.subtitle }}</small>
          <!-- 表格样式把课名直接写进格子里，每行最多四个字；完整的名字在下面的清单里。 -->
          <span v-if="visualStyle === 'table'" class="sm-names">
            <i v-for="entry in courseMarks(item).slice(0, 2)" :key="entry.name" :style="{ color: entry.accent }">{{ entry.name.slice(0, 4) }}</i>
          </span>
          <span v-else class="sm-dots">
            <i v-for="entry in courseMarks(item).slice(0, 4)" :key="entry.name" :style="{ background: entry.accent }" />
          </span>
          <em v-if="item.adjustment" class="sm-badge" :class="item.adjustment.kind">{{ item.adjustment.kind === "off" ? "休" : "班" }}</em>
        </button>
      </div>
    </div>

    <div class="sm-summary">
      <header>
        <div>
          <h4>{{ selectedTitle }}</h4>
          <p>{{ selectedSubtitle }}</p>
        </div>
        <button v-if="canOpenDay" type="button" class="sm-open" @click="emit('open-day', selectedDate)">查看当天</button>
      </header>
      <p v-if="adjustmentText" class="sm-adjustment">{{ adjustmentText }}</p>
      <p v-if="emptyText" class="sm-empty">{{ emptyText }}</p>
      <article
        v-for="entry in selectedCourses"
        :key="entry.block.id"
        class="sm-course"
        :style="{ '--tile-accent': entry.accent, '--tile-fill': entry.fill }"
        role="button"
        tabindex="0"
        @click="emit('course', entry.block.source, selectedDate, $event)"
        @keydown.enter.prevent="emit('course', entry.block.source, selectedDate, $event)"
      >
        <div class="time"><b>{{ entry.start }}</b><span>{{ entry.end }}</span></div>
        <i class="bar" />
        <div class="body">
          <strong>{{ entry.block.course.name }}</strong>
          <span>{{ entry.meta }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { dayOfWeekForCalendarYmd } from "./calendar";
import { placeCourseBlocks, type SchedulePriorityMap } from "./displayPriority";
import { lunarDateText, monthDayTitle, monthKeyOf, monthRows, paperMonthTitle, type MonthDay } from "./monthModel";
import { blockEnd, blockStart, cleanLocation, slotText, weekdayLabel, type DayStatus, type SlotClock } from "./nowIndicator";
import { classicCourseTone, scheduleStyleCourseTone, type ScheduleStyleKey } from "./scheduleStyle";
import { displayBlockOf } from "./styledTypes";
import type { WeekCourseBlock } from "./types";

const props = withDefaults(defineProps<{
  visualStyle: ScheduleStyleKey;
  palette: string;
  dark: boolean;
  hasBackground?: boolean;
  days: MonthDay[];
  selectedDate: string;
  todayDate: string;
  clocks: SlotClock[];
  priorities?: SchedulePriorityMap;
  /** 能不能从这里跳到所选那天的日视图。 */
  canOpenDay?: boolean;
}>(), {
  hasBackground: false,
  priorities: () => ({}),
  canOpenDay: false,
});

const emit = defineEmits<{
  (event: "select", date: string): void;
  (event: "open-day", date: string): void;
  (event: "course", block: WeekCourseBlock, date: string, source: Event): void;
}>();

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const rows = computed(() => monthRows(props.days));
// 经典样式在每行左边留一栏教学周，月历和学期周次就能对上。
const showsGutter = computed(() => props.visualStyle === "classic");
const selected = computed(() => props.days.find((item) => item.date === props.selectedDate) ?? null);
const paperTitle = computed(() => {
  const first = props.days.find((item) => item.inMonth);
  return first ? paperMonthTitle(monthKeyOf(first.date)) : "";
});

function rowWeek(row: MonthDay[]) {
  return row.find((item) => item.slot)?.slot?.week ?? "";
}

function toneOf(name: string) {
  if (props.visualStyle === "classic") {
    const tone = classicCourseTone(name, props.palette, props.dark);
    return { accent: props.dark ? tone.border : tone.text, fill: tone.bg };
  }
  const tone = scheduleStyleCourseTone(name, props.palette, props.dark, props.hasBackground);
  return { accent: tone.accent, fill: tone.fill };
}

function visibleBlocks(item: MonthDay) {
  return placeCourseBlocks(item.blocks, props.priorities)
    .map(displayBlockOf)
    .sort((a, b) => a.startSlot - b.startSlot || a.endSlot - b.endSlot);
}

function courseMarks(item: MonthDay) {
  const names = [...new Set(visibleBlocks(item).map((block) => block.course.name))];
  return names.map((name) => ({ name, accent: toneOf(name).accent }));
}

function dayLabel(item: MonthDay) {
  const count = courseMarks(item).length;
  return [
    monthDayTitle(item.date),
    item.subtitle,
    item.adjustment ? (item.adjustment.kind === "off" ? "休息" : "补班") : "",
    count ? `${count} 门课` : "没有课",
  ].filter(Boolean).join("，");
}

const selectedTitle = computed(() => monthDayTitle(props.selectedDate));
const selectedSubtitle = computed(() => [
  selected.value?.slot ? `第 ${selected.value.slot.week} 周` : "",
  lunarDateText(props.selectedDate),
].filter(Boolean).join(" · "));

const adjustmentText = computed(() => {
  const adjustment = selected.value?.adjustment;
  if (!adjustment) return "";
  if (adjustment.kind === "off") return adjustment.note ? `放假：${adjustment.note}` : "放假";
  const match = adjustment.source?.match(/^\d{4}-(\d{2})-(\d{2})$/u);
  if (!match || !adjustment.source) return "补班";
  return `补班，上 ${Number(match[1])} 月 ${Number(match[2])} 日（${weekdayLabel(dayOfWeekForCalendarYmd(adjustment.source))}）的课`;
});

const selectedCourses = computed(() => {
  const item = selected.value;
  if (!item) return [];
  const status: DayStatus = { clocks: props.clocks, now: null, completedBefore: null };
  return visibleBlocks(item).map((block) => ({
    block,
    start: blockStart(status, block),
    end: blockEnd(status, block),
    meta: [
      cleanLocation(block.course.location) ? `@${cleanLocation(block.course.location)}` : "",
      block.course.teacher?.trim() ?? "",
      // 只有一节的课写成「第 9 节」，不写「第 9-9 节」。
      slotText(block),
    ].filter(Boolean).join(" · "),
    ...toneOf(block.course.name),
  }));
});

const emptyText = computed(() => {
  if (!selected.value?.slot) return "这一天不在当前学期的教学周内。";
  if (selectedCourses.value.length) return "";
  return selected.value.adjustment?.kind === "off" ? "这一天放假，没有课程。" : "这一天没有课程。";
});
</script>

<style scoped lang="scss">
.sm {
  --sm-ink: var(--ss-ink);
  --sm-meta: var(--ss-meta);
  --sm-accent: var(--ss-accent);
  --sm-fill: var(--ss-theme-fill);
  --sm-on-fill: var(--ss-theme-on-fill);
  --sm-rule: rgba(var(--ss-ink-rgb), 0.24);
  --sm-row-height: 62px;
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  border: 1px solid var(--ss-cell-border);
  border-radius: 20px;
  background: var(--ss-panel);
  color: var(--sm-ink);
  font-family: var(--ss-font);
  font-variant-numeric: tabular-nums;
  touch-action: pan-y;
}
.sm-calendar {
  padding: 14px 10px 10px;
}
.sm-month-title {
  height: 30px;
  margin: 0;
  padding: 0 2px;
  font-size: 15px;
  font-weight: 600;
  line-height: 30px;
}
.sm-weekdays,
.sm-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  column-gap: 4px;
}
.sm-weekdays {
  height: 16px;
  margin-bottom: 12px;
  color: var(--sm-meta);
  font-size: 11px;
  font-weight: 500;
  text-align: center;
}
.sm-row + .sm-row {
  margin-top: 6px;
}
.sm-gutter {
  color: var(--sm-meta);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  align-self: center;
}
.sm-day {
  position: relative;
  min-width: 0;
  height: var(--sm-row-height);
  padding: 4px 0 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  touch-action: manipulation;
}
.sm-day.outside {
  opacity: 0.4;
}
.sm-number {
  min-width: 26px;
  height: 26px;
  border-radius: 13px;
  font-size: 16px;
  font-weight: 500;
  line-height: 26px;
  text-align: center;
}
.sm-day.today .sm-number {
  color: var(--sm-accent);
  font-weight: 700;
}
.sm-day.selected .sm-number {
  background: var(--sm-fill);
  color: var(--sm-on-fill);
  font-weight: 700;
}
.sm-subtitle {
  max-width: 100%;
  overflow: hidden;
  color: var(--sm-meta);
  font-size: 9px;
  line-height: 1.2;
  white-space: nowrap;
}
.sm-day.festival .sm-subtitle {
  color: #e11d48;
  font-weight: 700;
}
.sm-dark .sm-day.festival .sm-subtitle {
  color: #ff8ca6;
}
.sm-dots {
  height: 5px;
  display: flex;
  gap: 2px;
}
.sm-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.sm-names {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: hidden;
}
.sm-names i {
  max-width: 100%;
  overflow: hidden;
  font-size: 9px;
  font-style: normal;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
}
.sm-badge {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 13px;
  height: 13px;
  border-radius: 3px;
  background: #e11d48;
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
}
.sm-badge.swap {
  background: #c2410c;
}

// 所选那天
.sm-summary {
  margin: 0 12px;
  padding: 14px 2px 14px;
  border-top: 0.7px solid var(--sm-rule);
}
.sm-summary header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.sm-summary h4 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.sm-summary header p {
  margin: 3px 0 0;
  color: var(--sm-meta);
  font-size: 12px;
}
.sm-open {
  flex: 0 0 auto;
  padding: 6px 12px;
  border: 0;
  border-radius: 999px;
  background: rgba(var(--ss-theme-rgb), 0.1);
  color: var(--ss-theme-text);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.sm-dark .sm-open {
  background: rgba(var(--ss-theme-rgb), 0.2);
}
.sm-adjustment {
  margin: 0 0 10px;
  color: var(--sm-accent);
  font-size: 12px;
  font-weight: 600;
}
.sm-empty {
  margin: 14px 0 6px;
  color: var(--sm-meta);
  font-size: 14px;
}
.sm-course {
  min-height: 56px;
  padding: 8px 0;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.sm-course + .sm-course {
  border-top: 0.5px solid rgba(var(--ss-ink-rgb), 0.12);
}
.sm-course .time {
  flex: 0 0 48px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sm-course .time b {
  font-size: 15px;
  font-weight: 600;
}
.sm-course .time span {
  color: var(--sm-meta);
  font-size: 11px;
}
.sm-course .bar {
  align-self: stretch;
  flex: 0 0 3px;
  border-radius: 2px;
  background: var(--tile-accent);
}
.sm-course .body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sm-course strong {
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-course .body span {
  overflow: hidden;
  color: var(--sm-meta);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// 经典：玻璃底的月历，下面一张所选日期的卡片。
.sm-classic {
  --sm-ink: var(--schedule-text);
  --sm-meta: var(--schedule-text-secondary);
  --sm-accent: var(--schedule-accent-strong);
  --sm-fill: var(--schedule-accent);
  --sm-on-fill: var(--schedule-accent-contrast);
  --sm-rule: var(--schedule-border);
  --sm-row-height: 54px;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-family: inherit;
}
.sm-classic .sm-calendar {
  padding: 10px 8px;
  border: 1px solid var(--schedule-cell-border);
  border-radius: 12px;
  background: var(--schedule-surface-bg);
}
.sm-classic .sm-weekdays,
.sm-classic .sm-row {
  grid-template-columns: 26px repeat(7, minmax(0, 1fr));
  column-gap: 2px;
}
.sm-classic .sm-weekdays {
  margin-bottom: 6px;
  font-weight: 600;
}
.sm-classic .sm-weekdays .weekend {
  color: #ec6a9a;
}
.sm-classic .sm-summary {
  margin: 12px 0 0;
  padding: 14px;
  border: 1px solid var(--schedule-cell-border);
  border-radius: 12px;
  background: var(--schedule-surface-bg);
}
.sm-classic .sm-open {
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}

// 简约
.sm-minimal {
  --sm-row-height: 58px;
}
.sm-minimal .sm-summary {
  border-top-color: color-mix(in srgb, var(--sm-rule) 50%, transparent);
}

// 格子：每天一个独立的小方格。
.sm-grid {
  border-radius: 12px;
}
.sm-grid .sm-row + .sm-row {
  margin-top: 6px;
}
.sm-grid .sm-day {
  border: 1px solid var(--ss-cell-border);
  border-radius: 8px;
  background: var(--ss-cell);
}
.sm-grid .sm-day.off {
  border-style: dashed;
}
.sm-grid .sm-day.selected {
  border-color: var(--sm-fill);
  background: var(--sm-fill);
  color: var(--sm-on-fill);
}
.sm-grid .sm-day.selected .sm-number,
.sm-grid .sm-day.selected .sm-subtitle {
  background: transparent;
  color: inherit;
}

// 表格：整齐的行列，课名写在格子里。
.sm-table {
  --sm-row-height: 70px;
  border: 0.6px solid var(--sm-rule);
  border-radius: 0;
}
.sm-table .sm-calendar {
  padding: 0;
}
.sm-table .sm-weekdays {
  height: 28px;
  margin: 0;
  align-items: center;
  column-gap: 0;
  background: rgba(var(--ss-ink-rgb), 0.06);
}
.sm-table .sm-row {
  column-gap: 0;
  border-top: 0.6px solid var(--sm-rule);
}
.sm-table .sm-row + .sm-row {
  margin-top: 0;
}
.sm-table .sm-day {
  border-radius: 0;
  border-left: 0.6px solid var(--sm-rule);
}
.sm-table .sm-day:first-of-type {
  border-left: 0;
}
.sm-table .sm-number {
  min-width: 22px;
  height: 22px;
  border-radius: 0;
  font-size: 14px;
  line-height: 22px;
}
.sm-table .sm-subtitle {
  display: none;
}
.sm-table .sm-day.selected {
  background: rgba(var(--ss-theme-rgb), 0.1);
}
.sm-table .sm-summary {
  margin: 0;
  padding: 14px 12px;
  border-top: 0.6px solid var(--sm-rule);
}

// 素笺：纸墨色调，粗细两道边。
.sm-paper {
  border: 1.2px solid rgba(var(--ss-ink-rgb), 0.6);
  border-radius: 0;
  box-shadow: inset 0 0 0 3px var(--ss-panel), inset 0 0 0 3.6px var(--sm-rule);
  --sm-fill: var(--ss-accent);
  --sm-on-fill: var(--ss-inverse-ink);
}
.sm-paper .sm-weekdays {
  font-size: 12px;
}
.sm-paper .sm-number {
  font-weight: 500;
}
.sm-paper .sm-badge,
.sm-board .sm-badge {
  border: 1px solid var(--ss-accent);
  border-radius: 0;
  background: var(--ss-accent);
  color: var(--ss-inverse-ink);
}
.sm-paper .sm-badge.swap,
.sm-board .sm-badge.swap {
  background: transparent;
  color: var(--ss-accent);
}

// 站牌：等宽字，粗线分隔。
.sm-board {
  border: 0;
  border-radius: 0;
  --sm-fill: var(--ss-accent);
  --sm-on-fill: var(--ss-inverse-ink);
}
.sm-board .sm-weekdays {
  padding-bottom: 8px;
  height: 24px;
  border-bottom: 2px solid rgba(var(--ss-ink-rgb), 0.65);
  font-weight: 700;
}
.sm-board .sm-day {
  border-radius: 0;
}
.sm-board .sm-number {
  border-radius: 0;
}
.sm-board .sm-summary {
  margin: 0;
  padding: 14px 12px;
  border-top: 2px solid rgba(var(--ss-ink-rgb), 0.65);
}
</style>
