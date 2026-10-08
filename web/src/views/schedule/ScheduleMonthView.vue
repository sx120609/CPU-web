<template>
  <!-- 月视图不画节次网格，而是一张日历：每天一格，格子里是公历日、农历或节日，
       下面直接列出当天的课，一门一行，放不下的收成「+N」。点一天进入那天的日视图。 -->
  <section class="sm" :class="[`sm-${visualStyle}`, { 'sm-dark': dark, 'sm-coupled': coupled }]">
    <div class="sm-calendar">
      <h3 v-if="visualStyle === 'paper'" class="sm-month-title">{{ paperTitle }}</h3>
      <div class="sm-weekdays">
        <span v-if="showsGutter" class="sm-gutter">周</span>
        <span v-for="(label, index) in weekdayLabels" :key="label" :class="{ weekend: index >= 5 }">{{ label }}</span>
      </div>
      <!-- 上下拖动换月：格子跟着手指走，松手后翻到下一个月或者弹回来。 -->
      <div
        :key="monthId"
        class="sm-rows"
        :class="[enterClass, { dragging: drag.active }]"
        :style="rowsStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
        @click.capture="onClickCapture"
      >
      <div v-for="row in rows" :key="row[0].date" class="sm-row">
        <span v-if="showsGutter" class="sm-gutter">{{ rowWeek(row) }}</span>
        <button
          v-for="item in row"
          :key="item.date"
          type="button"
          class="sm-day"
          :class="{
            today: item.date === todayDate,
            outside: !item.inMonth,
            festival: item.isFestival,
            off: item.adjustment?.kind === 'off',
          }"
          :aria-label="dayLabel(item)"
          @click="onDayClick(item)"
        >
          <b class="sm-number">{{ item.number }}</b>
          <small class="sm-subtitle">{{ item.subtitle }}</small>
          <span class="sm-courses">
            <i v-for="entry in courseLines(item).shown" :key="entry.name" :style="{ color: entry.accent, background: entry.fill }">{{ entry.name }}</i>
            <u v-if="courseLines(item).more">+{{ courseLines(item).more }}</u>
            <!-- 情侣课表：TA 这一天有几门课，单独一行，用 TA 的颜色。 -->
            <i v-if="partnerCounts[item.date]" class="sm-ta" :style="partnerStyle"><b>TA</b>{{ partnerCounts[item.date] }} 门</i>
          </span>
          <em v-if="item.adjustment" class="sm-badge" :class="item.adjustment.kind">{{ item.adjustment.kind === "off" ? "休" : "班" }}</em>
        </button>
      </div>
      </div>
    </div>

  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { placeCourseBlocks, type SchedulePriorityMap } from "./displayPriority";
import { monthCourseLines, monthDayTitle, monthKeyOf, monthRows, paperMonthTitle, type MonthDay } from "./monthModel";
import type { SlotClock } from "./nowIndicator";
import { classicCourseTone, scheduleStyleCourseTone, type ScheduleStyleKey } from "./scheduleStyle";
import { displayBlockOf } from "./styledTypes";

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
  /** 情侣课表：日期 → TA 这一天的课程门数；没开双人模式时是空的。 */
  partnerCounts?: Record<string, number>;
  /** TA 那一行的颜色。 */
  partnerTone?: { accent: string; fill: string } | null;
  /** 双人模式下我的课统一用的颜色；平时是 null，各门课用自己的颜色。 */
  ownTone?: { accent: string; fill: string } | null;
  /** 还有没有上一个月、下一个月可以翻。 */
  canShiftPrevious?: boolean;
  canShiftNext?: boolean;
}>(), {
  hasBackground: false,
  priorities: () => ({}),
  canOpenDay: false,
  partnerCounts: () => ({}),
  partnerTone: null,
  ownTone: null,
  canShiftPrevious: false,
  canShiftNext: false,
});

const emit = defineEmits<{
  (event: "select", date: string): void;
  (event: "open-day", date: string): void;
  /** 上下拖动换月：1 是下一个月，-1 是上一个月。 */
  (event: "shift", delta: number): void;
}>();

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];
const rows = computed(() => monthRows(props.days));
// 经典样式在每行左边留一栏教学周，月历和学期周次就能对上。
const showsGutter = computed(() => props.visualStyle === "classic");
const paperTitle = computed(() => {
  const first = props.days.find((item) => item.inMonth);
  return first ? paperMonthTitle(monthKeyOf(first.date)) : "";
});

// MARK: 上下拖动换月

const SHIFT_DISTANCE = 44;
const monthId = computed(() => {
  const first = props.days.find((item) => item.inMonth);
  return first ? monthKeyOf(first.date) : "";
});
const drag = reactive({ pointer: -1, startX: 0, startY: 0, active: false, offset: 0, moved: false });
/** 换月以后新的一页从哪边滑进来。 */
const enterClass = ref("");

const rowsStyle = computed(() => (drag.offset ? { transform: `translateY(${drag.offset}px)` } : {}));

function canShift(delta: number) {
  return delta > 0 ? props.canShiftNext : props.canShiftPrevious;
}

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  drag.pointer = event.pointerId;
  drag.startX = event.clientX;
  drag.startY = event.clientY;
  drag.active = false;
  drag.moved = false;
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerId !== drag.pointer) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.active) {
    if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx)) return;
    drag.active = true;
    drag.moved = true;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      /* 指针已经抬起就不用接管了 */
    }
  }
  // 往上拖是下一个月。没有月份可翻的那一边只给一点阻尼，表示到头了。
  const delta = dy < 0 ? 1 : -1;
  drag.offset = dy * (canShift(delta) ? 0.55 : 0.18);
}

function onPointerEnd(event: PointerEvent) {
  if (event.pointerId !== drag.pointer) return;
  drag.pointer = -1;
  if (!drag.active) return;
  const dy = event.clientY - drag.startY;
  const delta = dy < 0 ? 1 : -1;
  drag.active = false;
  drag.offset = 0;
  if (event.type === "pointerup" && Math.abs(dy) >= SHIFT_DISTANCE && canShift(delta)) {
    enterClass.value = delta > 0 ? "enter-from-below" : "enter-from-above";
    emit("shift", delta);
  }
}

/** 拖动结束时落在某一天上的那一下不算点选。 */
function onClickCapture(event: MouseEvent) {
  if (!drag.moved) return;
  drag.moved = false;
  event.stopPropagation();
  event.preventDefault();
}

function rowWeek(row: MonthDay[]) {
  return row.find((item) => item.slot)?.slot?.week ?? "";
}

function toneOf(name: string) {
  if (props.ownTone) return props.ownTone;
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

/** 一格里写得下几门课：三行，课再多最后一行让给「+N」。 */
const MAX_COURSE_LINES = 3;

function courseMarks(item: MonthDay) {
  const names = [...new Set(visibleBlocks(item).map((block) => block.course.name))];
  return names.map((name) => ({ name, ...toneOf(name) }));
}

function courseLines(item: MonthDay) {
  return monthCourseLines(courseMarks(item), MAX_COURSE_LINES);
}

const coupled = computed(() => Object.keys(props.partnerCounts).length > 0);
const partnerStyle = computed(() => (props.partnerTone ? { color: props.partnerTone.accent, background: props.partnerTone.fill } : {}));

/** 点一天：教学周里的日子进入那天的日视图，其余只是选中。 */
function onDayClick(item: MonthDay) {
  if (props.canOpenDay && item.slot) emit("open-day", item.date);
  else emit("select", item.date);
}

function dayLabel(item: MonthDay) {
  const names = courseMarks(item).map((entry) => entry.name);
  const theirs = props.partnerCounts[item.date] ?? 0;
  return [
    monthDayTitle(item.date),
    item.subtitle,
    item.adjustment ? (item.adjustment.kind === "off" ? "休息" : "补班") : "",
    names.length ? `${names.length} 门课：${names.join("、")}` : "没有课",
    theirs ? `TA ${theirs} 门课` : "",
  ].filter(Boolean).join("，");
}
</script>

<style scoped lang="scss">
.sm {
  --sm-ink: var(--ss-ink);
  --sm-meta: var(--ss-meta);
  --sm-accent: var(--ss-accent);
  --sm-fill: var(--ss-theme-fill);
  --sm-on-fill: var(--ss-theme-on-fill);
  --sm-rule: rgba(var(--ss-ink-rgb), 0.24);
  --sm-row-height: 92px;
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
// 上下拖动换月：竖向的手势归这一块自己处理，页面不跟着滚。
.sm-rows {
  touch-action: pan-x;
  transition: transform 0.22s ease-out;
  will-change: transform;
}
.sm-rows.dragging {
  transition: none;
}
.sm-rows.enter-from-below {
  animation: sm-enter-below 0.24s ease-out;
}
.sm-rows.enter-from-above {
  animation: sm-enter-above 0.24s ease-out;
}
@keyframes sm-enter-below {
  from { opacity: 0; transform: translateY(36px); }
  to { opacity: 1; transform: none; }
}
@keyframes sm-enter-above {
  from { opacity: 0; transform: translateY(-36px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .sm-rows {
    transition: none;
  }
  .sm-rows.enter-from-below,
  .sm-rows.enter-from-above {
    animation: none;
  }
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
  padding: 3px 1px 2px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  overflow: hidden;
  cursor: pointer;
  touch-action: manipulation;
}
.sm-day.outside {
  opacity: 0.4;
}
.sm-number {
  flex: 0 0 auto;
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  text-align: center;
}
// 今天：日期落在主题色的圆里。
.sm-day.today .sm-number {
  background: var(--sm-fill);
  color: var(--sm-on-fill);
  font-weight: 700;
}
.sm-subtitle {
  flex: 0 0 auto;
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
// 当天的课：一门一行，只写课名，底色是这门课自己的颜色。
.sm-courses {
  width: 100%;
  min-height: 0;
  margin-top: 1px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.sm-courses i {
  box-sizing: border-box;
  width: 100%;
  height: 14px;
  padding: 0 2px;
  overflow: hidden;
  border-radius: 3px;
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  line-height: 14px;
  text-align: left;
  white-space: nowrap;
}
// TA 的那一行排在最下面，和上面我的课隔开一点。
.sm-courses .sm-ta {
  margin-top: 2px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-weight: 600;
}
.sm-courses .sm-ta b {
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.3px;
}
.sm.sm-coupled {
  --sm-row-height: 108px;
}
.sm-courses u {
  height: 12px;
  color: var(--sm-meta);
  font-size: 9px;
  font-weight: 600;
  line-height: 12px;
  text-align: left;
  text-decoration: none;
  padding-left: 2px;
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

// 经典：玻璃底的月历。
.sm-classic {
  --sm-ink: var(--schedule-text);
  --sm-meta: var(--schedule-text-secondary);
  --sm-accent: var(--schedule-accent-strong);
  --sm-fill: var(--schedule-accent);
  --sm-on-fill: var(--schedule-accent-contrast);
  --sm-rule: var(--schedule-border);
  --sm-row-height: 88px;
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
// 简约
.sm-minimal .sm-row + .sm-row {
  border-top: 0.5px solid color-mix(in srgb, var(--sm-rule) 45%, transparent);
  margin-top: 3px;
  padding-top: 3px;
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
.sm-grid .sm-day.today {
  border-color: var(--sm-fill);
}

// 表格：整齐的行列，课名写在格子里。
.sm-table {
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
  border-radius: 0;
}
.sm-table .sm-courses i {
  border-radius: 0;
}
.sm-table .sm-day.today {
  background: rgba(var(--ss-theme-rgb), 0.1);
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
.sm-board .sm-number,
.sm-board .sm-courses i,
.sm-paper .sm-courses i {
  border-radius: 0;
}
</style>
