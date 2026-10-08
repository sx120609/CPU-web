<template>
  <section
    class="ss-week"
    :class="[
      `ss-${visualStyle}`,
      `ss-grid-${layout.grid}`,
      {
        'ss-dark': dark,
        'ss-day-presentation': dayPresentation,
        'ss-no-header': !showsDateHeader,
        'ss-coupled': coupled,
        'ss-framed': framesPanel,
        'ss-compact': compact,
        'ss-no-slot-time': !showSlotTime,
      },
    ]"
    :style="gridStyle"
  >
    <!-- 整列的底：简约和素笺给今天铺一层淡色，表格给周末压灰、给放假画斜线。 -->
    <div
      v-for="(item, column) in days"
      :key="`bg-${item.day}`"
      class="ss-col-bg"
      :class="columnBackgroundClass(item)"
      :style="{ gridColumn: column + 2, gridRow: columnBackgroundRows }"
      aria-hidden="true"
    />

    <template v-if="showsDateHeader">
      <!-- 日期栏只写几号，月份写在节次栏上方，和日历一样。 -->
      <div class="ss-axis-head" :style="{ gridColumn: 1, gridRow: 1 }">{{ axisTitle }}</div>
      <button
        v-for="(item, column) in days"
        :key="`head-${item.day}`"
        type="button"
        class="ss-date-head"
        :class="{ today: marksToday(item) }"
        :style="{ gridColumn: column + 2, gridRow: 1 }"
        :aria-label="headerLabel(item)"
        @click="emit('day', item.day)"
      >
        <template v-if="visualStyle === 'minimal'">
          <b class="ss-date-number">{{ dayOfMonth(item) }}</b>
          <span class="ss-date-weekday">{{ marksToday(item) ? "今天" : weekdayLabel(item.day) }}</span>
          <i v-if="item.adjustmentKind" class="ss-badge ss-badge-corner" :class="item.adjustmentKind">{{ item.adjustmentKind === "off" ? "休" : "班" }}</i>
        </template>
        <template v-else>
          <b v-if="visualStyle === 'grid'" class="ss-date-char">{{ weekdayChar(item.day) }}</b>
          <span v-else class="ss-date-weekday">{{ marksToday(item) ? (visualStyle === "paper" ? "今日" : "今天") : weekdayLabel(item.day) }}</span>
          <span class="ss-date-line">
            <em class="ss-date-number">{{ dayOfMonth(item) }}</em>
            <i v-if="item.adjustmentKind" class="ss-badge" :class="item.adjustmentKind">{{ item.adjustmentKind === "off" ? "休" : "班" }}</i>
          </span>
        </template>
      </button>
    </template>

    <div
      v-for="(slot, row) in rows"
      :key="`axis-${slot.no}`"
      class="ss-slot-label"
      :class="{ 'starts-session': sessionStarts[row] }"
      :style="{ gridColumn: 1, gridRow: row + rowBase }"
      :aria-label="`第 ${slot.no} 节，${slot.start} 至 ${slot.end}`"
    >
      <template v-if="visualStyle === 'minimal'">
        <b>{{ slot.no }}</b>
        <span>{{ slot.start }}</span>
      </template>
      <template v-else-if="visualStyle === 'board'">
        <small v-if="sessionStarts[row]">{{ slotSession(slot.start) }}</small>
        <b>{{ slot.start }}</b>
        <span>第{{ slot.no }}节</span>
      </template>
      <template v-else>
        <b>{{ visualStyle === "paper" ? chineseNumeral(slot.no) : slot.no }}</b>
        <span>{{ slot.start }}</span>
        <span>{{ slot.end }}</span>
      </template>
    </div>

    <template v-for="(item, column) in days" :key="`cells-${item.day}`">
      <div
        v-for="(slot, row) in rows"
        :key="`cell-${item.day}-${slot.no}`"
        class="ss-cell"
        :class="cellClass(item, slot.no, row)"
        :style="{ gridColumn: column + 2, gridRow: row + rowBase }"
        @click="emit('slot', item.day, slot.no)"
      />
    </template>

    <!-- 简约样式在节次之间只画一条贯穿各列的细线。 -->
    <template v-if="visualStyle === 'minimal'">
      <div
        v-for="row in Math.max(0, rows.length - 1)"
        :key="`rule-${row}`"
        class="ss-row-rule"
        :style="{ gridColumn: '2 / -1', gridRow: row + rowBase }"
        aria-hidden="true"
      />
    </template>

    <article
      v-for="tile in tiles"
      :key="tile.key"
      class="ss-tile"
      :class="{
        current: tile.current,
        partner: tile.owner === 'ta',
        shared: tile.shared,
        narrow: tile.lanes > 1,
        strip: tile.strip,
        'off-week': tile.offWeek,
      }"
      :style="tile.style"
      :title="tile.title"
      role="button"
      tabindex="0"
      @click.stop="openTile(tile, $event)"
      @keydown.enter.prevent="openTile(tile, $event)"
    >
      <!-- 和我的课撞在一起的 TA 的课只是一条色带，不放字；点开看详情。 -->
      <template v-if="!tile.strip">
        <i v-if="tile.offWeek" class="ss-off-tag">非本周</i>
        <i v-else-if="tile.owner === 'ta'" class="ss-ta-tag">TA</i>
        <div v-if="layout.course === 'departure'" class="ss-tile-time">
          <i class="ss-mark" />
          <b>{{ tile.start }}</b>
        </div>
        <strong>{{ tile.block.course.name }}</strong>
        <span v-if="tile.location">@{{ tile.location }}</span>
        <span v-if="tile.teacher">{{ tile.teacher }}</span>
        <em v-if="tile.status" class="ss-tile-status">{{ tile.status }}</em>
      </template>
    </article>

    <!-- 「现在」：节次栏上一个胶囊，今天那一列一条线，在同一个高度。 -->
    <template v-if="nowPlacement">
      <div class="ss-now-anchor" :style="{ gridColumn: 1, gridRow: nowPlacement.row + rowBase }" aria-hidden="true">
        <span class="ss-now-badge" :style="nowPlacement.style">{{ nowText }}</span>
      </div>
      <div
        v-if="nowPlacement.showsLine"
        class="ss-now-anchor"
        :class="{ beneath: visualStyle === 'grid' }"
        :style="{ gridColumn: nowPlacement.column + 2, gridRow: nowPlacement.row + rowBase }"
        aria-hidden="true"
      >
        <span class="ss-now-line" :style="nowPlacement.style" />
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  blockPhase,
  blockStatusLabel,
  chineseNumeral,
  cleanLocation,
  formatClock,
  nowRowPosition,
  slotSession,
  startsSession,
  weekdayLabel,
  type DayStatus,
  type SlotClock,
} from "./nowIndicator";
import {
  classicCourseTone,
  scheduleStyleCourseTone,
  scheduleStyleFramesPanel,
  scheduleStyleLayout,
  type ScheduleStyleKey,
} from "./scheduleStyle";
import { displayBlockOf, type StyledDay, type TileOwner, type TileToneResolver } from "./styledTypes";
import type { PlacedCourseBlock } from "./displayPriority";
import type { WeekCourseBlock } from "./types";

const props = withDefaults(defineProps<{
  visualStyle: ScheduleStyleKey;
  palette: string;
  dark: boolean;
  hasBackground?: boolean;
  days: StyledDay[];
  clocks: SlotClock[];
  /** 今天那一列要标出「现在」时是当前的分钟数；null 就不画。 */
  nowMinutes?: number | null;
  showsDateHeader?: boolean;
  /** 日视图里的单列：阅读字号、靠左、带上课状态。 */
  dayPresentation?: boolean;
  /** 过去的日期：到这个分钟为止结束的课算已结束。 */
  completedBefore?: number | null;
  toneResolver?: TileToneResolver | null;
  showTeacher?: boolean;
  /** 关掉以后节次栏只写第几节。 */
  showSlotTime?: boolean;
  compact?: boolean;
}>(), {
  showTeacher: false,
  showSlotTime: true,
  compact: false,
  hasBackground: false,
  nowMinutes: null,
  showsDateHeader: true,
  dayPresentation: false,
  completedBefore: null,
  toneResolver: null,
});

const emit = defineEmits<{
  (event: "course", block: WeekCourseBlock, owner: TileOwner, source: Event): void;
  (event: "offWeek", block: WeekCourseBlock, source: Event): void;
  (event: "slot", day: number, slot: number): void;
  (event: "day", day: number): void;
}>();

const layout = computed(() => scheduleStyleLayout(props.visualStyle));
const framesPanel = computed(() => scheduleStyleFramesPanel(props.visualStyle));
const rows = computed(() => props.clocks);
const rowBase = computed(() => (props.showsDateHeader ? 2 : 1));
const rowIndex = computed(() => new Map(rows.value.map((slot, index) => [slot.no, index])));
const sessionStarts = computed(() => rows.value.map((_, index) => startsSession(rows.value, index)));
const coupled = computed(() => props.days.some((item) => item.partnerPieces !== undefined));
const columnBackgroundRows = computed(() => (
  props.visualStyle === "table" && props.showsDateHeader ? "2 / -1" : "1 / -1"
));

const gridStyle = computed(() => ({
  gridTemplateColumns: `var(--ss-axis-width) repeat(${Math.max(1, props.days.length)}, minmax(0, 1fr))`,
  gridTemplateRows: `${props.showsDateHeader ? "var(--ss-header-height) " : ""}repeat(${Math.max(1, rows.value.length)}, minmax(var(--ss-row-min), 1fr))`,
}));

const axisTitle = computed(() => {
  const match = props.days.find((item) => item.rawDate)?.rawDate.match(/^\d{4}-(\d{2})-\d{2}$/u);
  return match ? `${Number(match[1])}月` : "节次";
});

function marksToday(item: StyledDay) {
  return item.isToday;
}

function dayOfMonth(item: StyledDay) {
  const match = item.rawDate.match(/^\d{4}-\d{2}-(\d{2})$/u);
  return match ? String(Number(match[1])) : (item.dateText || "–");
}

function weekdayChar(day: number) {
  return ["一", "二", "三", "四", "五", "六", "日"][Math.max(0, Math.min(6, day - 1))];
}

function headerLabel(item: StyledDay) {
  const base = [weekdayLabel(item.day), item.dateText].filter(Boolean).join(" ");
  if (!item.adjustmentKind) return base;
  return `${base}，${item.adjustmentKind === "off" ? "休息" : "补班"}`;
}

function columnBackgroundClass(item: StyledDay) {
  return {
    today: marksToday(item),
    holiday: item.adjustmentKind === "off",
    weekend: item.day >= 6 && item.adjustmentKind !== "swap",
  };
}

function allPieces(item: StyledDay) {
  return item.partnerPieces?.length ? [...item.pieces, ...item.partnerPieces] : item.pieces;
}

/** 双人模式下，这门课是不是和对方的课撞在同一时段：撞在一起时 TA 的课收成一条色带，我的课让出这一条。 */
function sharesSlotWithOther(item: StyledDay, piece: PlacedCourseBlock, owner: TileOwner) {
  if (!coupled.value) return false;
  const others = owner === "ta" ? item.pieces : (item.partnerPieces ?? []);
  return others.some((other) => other.startSlot <= piece.endSlot && piece.startSlot <= other.endSlot);
}

function cellClass(item: StyledDay, slot: number, row: number) {
  const covering = allPieces(item).filter((piece) => piece.startSlot <= slot && slot <= piece.endSlot);
  // 并排的课没占满这一行时，剩下的格子照常露出来。
  const covered = covering.length > 0 && !coupled.value
    && new Set(covering.map((piece) => piece.lane)).size >= (covering[0]?.lanes ?? 1);
  return {
    today: marksToday(item),
    holiday: item.adjustmentKind === "off",
    "starts-session": sessionStarts.value[row],
    covered,
    occupied: covering.length > 0,
    "joins-below": covering.some((piece) => piece.endSlot > slot),
    "joins-above": covering.some((piece) => piece.startSlot < slot),
    "closes-column": row === rows.value.length - 1,
    "first-column": props.days[0]?.day === item.day,
  };
}

function statusFor(item: StyledDay): DayStatus {
  return {
    clocks: rows.value,
    now: marksToday(item) ? props.nowMinutes : null,
    completedBefore: props.completedBefore,
  };
}

interface Tile {
  key: string;
  block: WeekCourseBlock;
  owner: TileOwner;
  shared: boolean;
  /** TA 的课和我的课撞在一起：只画右边一条色带。 */
  strip: boolean;
  offWeek: boolean;
  current: boolean;
  lanes: number;
  start: string;
  location: string | null;
  teacher: string | null;
  status: string | null;
  title: string;
  style: Record<string, string | number>;
}

function toneFor(block: WeekCourseBlock, owner: TileOwner, shared: boolean) {
  const override = props.toneResolver?.(block, owner, shared);
  if (override) return override;
  if (props.visualStyle === "classic") {
    const tone = classicCourseTone(block.course.name, props.palette, props.dark);
    return { accent: tone.text, fill: tone.bg, border: tone.border, accentInverse: tone.text };
  }
  return scheduleStyleCourseTone(block.course.name, props.palette, props.dark, props.hasBackground);
}

function openTile(tile: Tile, source: Event) {
  if (tile.offWeek) emit("offWeek", tile.block, source);
  else emit("course", tile.block, tile.owner, source);
}

function buildTile(item: StyledDay, column: number, piece: PlacedCourseBlock, owner: TileOwner, offWeek = false): Tile | null {
  const first = rowIndex.value.get(piece.startSlot);
  const last = rowIndex.value.get(piece.endSlot);
  if (first === undefined && last === undefined) return null;
  const startRow = first ?? 0;
  const endRow = Math.max(startRow, last ?? rows.value.length - 1);
  const shared = owner === "me" && Boolean(item.sharedIds?.has(piece.id));
  const display = displayBlockOf(piece);
  const status = statusFor(item);
  const tone = toneFor(piece.block, owner, shared);
  // 双人模式下两人的课撞在同一时段时，TA 的课收成右边一条色带，我的课让出这一条；
  // 其余的和平时一样按重叠簇的道数分宽度。
  const clash = !shared && !offWeek && sharesSlotWithOther(item, piece, owner);
  const strip = clash && owner === "ta";
  const room = clash ? "(100% - var(--ss-couple-strip))" : "100%";
  const single = !clash && piece.lanes === 1;
  return {
    key: `${offWeek ? "off" : owner}-${item.day}-${piece.id}`,
    block: piece.block,
    owner,
    shared,
    strip,
    offWeek,
    current: !offWeek && owner === "me" && blockPhase(status, display) === "current",
    lanes: piece.lanes,
    start: rows.value[startRow]?.start ?? "",
    location: cleanLocation(piece.block.course.location),
    teacher: props.showTeacher && !props.dayPresentation ? (piece.block.course.teacher?.trim() || null) : null,
    status: props.dayPresentation && single && owner === "me" ? blockStatusLabel(status, display) : null,
    title: [
      owner === "ta" ? `TA · ${piece.block.course.name}` : piece.block.course.name,
      piece.block.course.teacher ? `教师：${piece.block.course.teacher}` : "",
      piece.block.course.location ? `地点：${piece.block.course.location}` : "",
      piece.block.course.weeks,
    ].filter(Boolean).join("\n"),
    style: {
      gridColumn: column + 2,
      gridRow: `${startRow + rowBase.value} / ${endRow + rowBase.value + 1}`,
      width: single ? "auto" : strip ? "calc(var(--ss-couple-strip) - 2px)"
        : `calc(${room} / ${piece.lanes} - var(--ss-tile-inset) * 2)`,
      marginLeft: single ? "var(--ss-tile-inset)" : strip ? "0"
        : `calc(${room} / ${piece.lanes} * ${piece.lane} + var(--ss-tile-inset))`,
      justifySelf: single ? "stretch" : strip ? "end" : "start",
      "--tile-accent": tone.accent,
      "--tile-fill": tone.fill,
      "--tile-border": tone.border,
      "--tile-accent-inverse": tone.accentInverse ?? tone.accent,
    },
  };
}

const tiles = computed(() => {
  const list: Tile[] = [];
  props.days.forEach((item, column) => {
    // 非本周的课先画，压在本周的课下面。
    for (const piece of item.offWeekPieces ?? []) {
      const tile = buildTile(item, column, piece, "me", true);
      if (tile) list.push(tile);
    }
    for (const piece of item.pieces) {
      const tile = buildTile(item, column, piece, "me");
      if (tile) list.push(tile);
    }
    for (const piece of item.partnerPieces ?? []) {
      const tile = buildTile(item, column, piece, "ta");
      if (tile) list.push(tile);
    }
  });
  return list;
});

const nowText = computed(() => (props.nowMinutes === null ? "" : formatClock(props.nowMinutes)));

const nowPlacement = computed(() => {
  if (props.nowMinutes === null) return null;
  const column = props.days.findIndex((item) => marksToday(item));
  if (column < 0) return null;
  const position = nowRowPosition(props.nowMinutes, rows.value);
  if (!position) return null;
  const slot = rows.value[position.row]?.no ?? 0;
  // 格子样式的线画在课程下面：深色的课程底是半透明的，线会从课名底下透出来，
  // 所以只在没有课盖着的地方画。
  const covering = allPieces(props.days[column]).filter((piece) => (
    piece.startSlot <= (position.inGap ? slot - 1 : slot) && slot <= piece.endSlot
  ));
  return {
    column,
    row: position.row,
    showsLine: props.visualStyle !== "grid" || covering.length === 0,
    style: { top: position.inGap ? "calc(var(--ss-row-gap) / -2)" : `${position.fraction * 100}%` },
  };
});
</script>

<style scoped lang="scss">
.ss-week {
  --ss-axis-width: 42px;
  --ss-header-height: 48px;
  --ss-row-gap: 3px;
  // 显示设置里的格子高度：页面没给这个变量时就是 1。
  --ss-row-min: calc(48px * var(--sd-row-scale, 1));
  --ss-tile-inset: 1px;
  --ss-panel-padding: 6px;
  --ss-panel-radius: 20px;
  position: relative;
  box-sizing: border-box;
  display: grid;
  width: 100%;
  max-width: 720px;
  min-height: calc(100% * var(--sd-row-scale, 1));
  margin: 0 auto;
  padding: var(--ss-panel-padding);
  column-gap: var(--ss-column-gap);
  row-gap: var(--ss-row-gap);
  border-radius: var(--ss-panel-radius);
  background: var(--ss-panel);
  color: var(--ss-ink);
  font-family: var(--ss-font);
  font-variant-numeric: tabular-nums;
  touch-action: pan-y;
}
.ss-week.ss-framed {
  border: 1px solid var(--ss-cell-border);
}
.ss-week.ss-day-presentation {
  --ss-axis-width: 48px;
  --ss-row-min: 56px;
  min-height: 100%;
  column-gap: 8px;
}
.ss-table {
  --ss-row-gap: 0px;
  --ss-tile-inset: 0.5px;
  --ss-panel-padding: 0px;
  --ss-panel-radius: 0px;
  border: 0.6px solid var(--ss-cell-border);
}
.ss-grid {
  --ss-tile-inset: 0px;
}
.ss-paper {
  --ss-panel-radius: 2px;
  border: 1.2px solid rgba(var(--ss-ink-rgb), 0.6);
  box-shadow: inset 0 0 0 3px var(--ss-panel), inset 0 0 0 3.6px rgba(var(--ss-ink-rgb), 0.24);
}
.ss-board {
  --ss-panel-radius: 2px;
}
.ss-classic {
  --ss-panel-padding: 0px;
  --ss-panel-radius: 0px;
  --ss-row-gap: 4px;
  --ss-column-gap: 4px;
  --ss-axis-width: 44px;
  --ss-header-height: 38px;
  border: 0;
  background: transparent;
  color: var(--schedule-text);
  font-family: inherit;
}

// 整列的底
.ss-col-bg {
  z-index: 0;
  pointer-events: none;
}
.ss-minimal .ss-col-bg.today {
  border-radius: 12px;
  background: rgba(var(--ss-theme-rgb), var(--ss-today-strength));
}
.ss-paper .ss-col-bg.today {
  background: var(--ss-accent);
  opacity: 0.07;
}
.ss-paper.ss-dark .ss-col-bg.today {
  opacity: 0.1;
}
.ss-table .ss-col-bg.weekend {
  background: rgba(var(--ss-ink-rgb), 0.035);
}
.ss-table .ss-col-bg.holiday {
  background: repeating-linear-gradient(135deg, transparent 0 4px, var(--ss-cell-border) 4px 4.6px);
}

// 日期栏
.ss-axis-head {
  display: grid;
  place-items: center;
  color: var(--ss-meta);
  font-size: 11px;
  font-weight: 700;
}
.ss-date-head {
  position: relative;
  z-index: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ss-ink);
  font: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  line-height: 1.1;
  cursor: pointer;
  touch-action: manipulation;
}
.ss-date-head.today {
  color: var(--ss-accent);
}
.ss-date-weekday {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.ss-date-char {
  font-size: 16px;
  font-weight: 700;
}
.ss-date-line {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.ss-date-number {
  font-size: 11px;
  font-weight: 500;
  font-style: normal;
}
.ss-minimal .ss-date-head {
  padding-top: 12px;
  color: var(--ss-ink);
}
.ss-minimal .ss-date-number {
  font-size: 16px;
  font-weight: 700;
}
.ss-minimal .ss-date-weekday {
  color: var(--ss-secondary);
}
.ss-minimal .ss-date-head.today .ss-date-number,
.ss-minimal .ss-date-head.today .ss-date-weekday {
  color: var(--ss-theme-text);
}
.ss-paper .ss-date-number {
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 15px;
}
.ss-paper .ss-date-head.today .ss-date-number {
  border-color: var(--ss-accent);
}
.ss-table .ss-date-head.today {
  background: var(--ss-theme-fill);
  color: var(--ss-theme-on-fill);
}
.ss-board .ss-date-head.today::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--ss-accent);
}
.ss-classic .ss-date-head {
  border: 1px solid var(--schedule-cell-border);
  border-radius: 10px;
  background: var(--schedule-cell-bg-strong);
  color: var(--schedule-text-secondary);
}
.ss-classic .ss-date-head.today {
  border-color: var(--schedule-accent);
  background: var(--schedule-accent-pale);
  color: var(--schedule-accent-strong);
}

// 休 / 班
.ss-badge {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: #e11d48;
  color: #fff;
  display: inline-grid;
  place-items: center;
  font-size: 9px;
  font-style: normal;
  font-weight: 600;
  line-height: 1;
}
.ss-badge.swap {
  background: #c2410c;
}
.ss-badge-corner {
  position: absolute;
  top: 0;
  right: 2px;
}
// 素笺和站牌用印章：放假是实心的，补班是空心的。
.ss-paper .ss-badge,
.ss-board .ss-badge {
  width: 13px;
  height: 13px;
  border: 1px solid var(--ss-accent);
  border-radius: 0;
  background: var(--ss-accent);
  color: var(--ss-inverse-ink);
  font-weight: 700;
}
.ss-paper .ss-badge.swap,
.ss-board .ss-badge.swap {
  background: transparent;
  color: var(--ss-accent);
}

// 节次栏
.ss-slot-label {
  z-index: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  color: var(--ss-ink);
  line-height: 1.12;
  white-space: nowrap;
}
.ss-slot-label b {
  font-size: 13px;
  font-weight: 700;
}
.ss-slot-label span {
  font-size: 9px;
}
.ss-minimal .ss-slot-label {
  gap: 3px;
}
.ss-minimal .ss-slot-label b {
  font-size: 14px;
}
.ss-minimal .ss-slot-label span {
  color: var(--ss-meta);
  font-size: 10px;
  font-weight: 600;
}
.ss-paper .ss-slot-label b {
  font-size: 12px;
}
.ss-board .ss-slot-label b {
  font-size: 12px;
}
.ss-board .ss-slot-label span,
.ss-board .ss-slot-label small {
  font-size: 8px;
}
.ss-board .ss-slot-label small {
  font-weight: 700;
}
.ss-table .ss-slot-label {
  border-top: 0.6px solid var(--ss-cell-border);
}
.ss-classic .ss-slot-label {
  color: var(--schedule-text-secondary);
}
.ss-classic .ss-slot-label b {
  color: var(--schedule-text);
}
.ss-no-slot-time .ss-slot-label span {
  display: none;
}
// 站牌的节次栏以时间为主；不显示时间时改成只写第几节。
.ss-board.ss-no-slot-time .ss-slot-label b,
.ss-board.ss-no-slot-time .ss-slot-label small {
  display: none;
}
.ss-board.ss-no-slot-time .ss-slot-label span {
  display: block;
  font-size: 10px;
  font-weight: 700;
}

// 空节次
.ss-cell {
  z-index: 1;
  min-width: 0;
  min-height: 0;
  cursor: pointer;
  touch-action: pan-y;
}
.ss-grid-cells .ss-cell {
  border: 1px solid var(--ss-cell-border);
  border-radius: var(--ss-radius);
  background: var(--ss-cell);
}
.ss-grid-cells .ss-cell.today {
  background: linear-gradient(rgba(var(--ss-theme-rgb), 0.12), rgba(var(--ss-theme-rgb), 0.12)), var(--ss-cell);
}
.ss-grid-cells .ss-cell.holiday {
  border-style: dashed;
}
// 课程盖住了整个格子：深色的课程底是半透明的，留在下面的格子会透出来。
.ss-grid-cells .ss-cell.covered {
  visibility: hidden;
}
.ss-classic .ss-cell {
  border-color: var(--schedule-cell-border);
  border-radius: 8px;
  background: var(--schedule-cell-bg);
}
.ss-classic .ss-cell.today {
  background: color-mix(in srgb, var(--schedule-accent) 14%, var(--schedule-cell-bg));
}
.ss-grid-table .ss-cell {
  border-top: 0.6px solid var(--ss-cell-border);
  border-left: 0.6px solid var(--ss-cell-border);
}
.ss-grid-table .ss-cell.today {
  background: rgba(var(--ss-theme-rgb), 0.08);
}
// 线不从跨了好几节的课中间穿过去。
.ss-grid-table .ss-cell.joins-above {
  border-top-color: transparent;
}
// 上午、下午、晚上之间的粗线总是贯通；课程内部的细线省掉。
.ss-grid-sessions .ss-cell {
  border-top: 0.5px solid rgba(var(--ss-ink-rgb), 0.12);
}
.ss-grid-sessions .ss-cell.joins-above {
  border-top-color: transparent;
}
.ss-grid-sessions .ss-cell.starts-session {
  border-top: 2px solid rgba(var(--ss-ink-rgb), 0.65);
}
.ss-paper .ss-cell {
  border-bottom: 0.5px solid rgba(var(--ss-ink-rgb), 0.16);
}
.ss-paper .ss-cell.joins-below,
.ss-paper .ss-cell.closes-column {
  border-bottom-color: transparent;
}
.ss-row-rule {
  z-index: 0;
  align-self: end;
  height: 0;
  margin-bottom: calc(var(--ss-row-gap) / -2);
  border-top: 0.5px solid var(--ss-cell-border);
  pointer-events: none;
}

// 课程
.ss-tile {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  margin: var(--ss-tile-inset) 0;
  padding: 3px 4px;
  overflow: hidden;
  border-radius: var(--ss-radius);
  background: var(--tile-fill);
  color: var(--tile-accent);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  line-height: 1.2;
  cursor: pointer;
  touch-action: pan-y;
  container-type: size;
}
.ss-tile strong,
.ss-tile span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}
.ss-tile strong {
  -webkit-line-clamp: 4;
  font-size: 11px;
  font-weight: 600;
}
.ss-tile span {
  -webkit-line-clamp: 2;
  font-size: 9px;
  font-weight: 500;
}
.ss-tile-status {
  display: none;
}
// 文字大小：整段文字一起缩放，行数限制照旧。
.ss-week:not(.ss-day-presentation) .ss-tile strong,
.ss-week:not(.ss-day-presentation) .ss-tile span {
  zoom: var(--sd-text-scale, 1);
}
.ss-compact:not(.ss-day-presentation) .ss-tile {
  padding: 2px 3px;
  gap: 1px;
  line-height: 1.12;
}
.ss-compact:not(.ss-day-presentation) .ss-tile strong {
  -webkit-line-clamp: 5;
}
// 非本周：压在本周课程下面，褪色，带一个小标记。
.ss-tile.off-week {
  z-index: 1;
  opacity: 0.5;
  filter: saturate(0.55);
}
.ss-off-tag {
  flex: 0 0 auto;
  max-width: 100%;
  padding: 0 3px;
  overflow: hidden;
  border: 0.5px solid currentColor;
  border-radius: 3px;
  font-size: 8px;
  font-style: normal;
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
}
// 列够宽、课够高时用正常的阅读字号。
@container (min-width: 70px) and (min-height: 64px) {
  .ss-tile strong {
    -webkit-line-clamp: 3;
    font-size: 13px;
  }
  .ss-tile span {
    font-size: 11px;
  }
}
@media (min-width: 761px) {
  .ss-tile:not(.narrow) {
    padding: 6px 7px;
  }
}
.ss-minimal .ss-tile {
  padding: 4px;
}
// 格子：课程就是格子本身，和旁边的空格一样大；居中，带一圈课程色的边。
.ss-grid .ss-tile,
.ss-classic .ss-tile {
  align-items: center;
  justify-content: center;
  border: var(--ss-course-border-width) solid var(--tile-accent);
  text-align: center;
}
.ss-grid .ss-tile.current {
  border: 2px solid var(--ss-theme-text);
}
.ss-classic .ss-tile {
  border-color: var(--tile-border);
  padding: 5px 3px;
}
.ss-classic .ss-tile strong {
  font-size: 10px;
  font-weight: 800;
}
// 表格：贴着线内侧，左边一条课程色的色条。
.ss-table .ss-tile {
  padding-left: 7px;
  box-shadow: inset 3px 0 0 var(--tile-accent);
}
// 素笺：保持墨色的字，课程色只是很淡的一层。
.ss-paper .ss-tile {
  padding-left: 6px;
  background: color-mix(in srgb, var(--tile-fill) 70%, transparent);
  box-shadow: inset 2px 0 0 var(--tile-accent);
  color: var(--ss-ink);
}
// 站牌：没有底色也没有色条，开始时间旁边一个课程色的小方块。
.ss-board .ss-tile {
  background: transparent;
  color: var(--ss-ink);
}
.ss-board .ss-tile.current {
  background: var(--ss-ink);
  color: var(--ss-inverse-ink);
}
.ss-tile-time {
  display: flex;
  align-items: center;
  gap: 3px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
.ss-tile-time b {
  font-size: 10px;
  font-weight: 800;
}
.ss-mark {
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  border-radius: 1px;
  background: var(--tile-accent);
}
.ss-board .ss-tile.current .ss-mark {
  background: var(--tile-accent-inverse);
}
// 情侣课表：和我的课撞在一起的 TA 的课，只是这一列右边的一条色带。
.ss {
  --ss-couple-strip: 9px;
}
.ss-tile.strip {
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: var(--tile-border);
}
.ss-tile.strip::before,
.ss-tile.strip::after {
  content: none;
}
// 情侣课表：TA 的课右上角一个小标记，颜色之外再给一个能认出来的记号。
.ss-ta-tag {
  position: absolute;
  top: 2px;
  right: 2px;
  padding: 0 2px;
  border-radius: 3px;
  background: var(--tile-accent);
  color: var(--tile-fill);
  font-size: 7px;
  font-style: normal;
  font-weight: 700;
  line-height: 1.4;
  opacity: 0.82;
}
.ss-board .ss-ta-tag,
.ss-paper .ss-ta-tag {
  color: var(--ss-panel);
}
.ss-board .ss-ta-tag {
  // 站牌的课程第一行是开始时间，标记放进排版里，免得盖住时间。
  position: static;
  align-self: flex-start;
}
.ss-day-presentation .ss-ta-tag {
  top: 6px;
  right: 8px;
  padding: 0 4px;
  font-size: 10px;
}
// 情侣课表：一起上的课右上角一颗小爱心。
.ss-tile.shared::after {
  content: "";
  position: absolute;
  top: 4px;
  right: 4px;
  width: 9px;
  height: 9px;
  background: var(--couple-accent, #e2568a);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.9 3 6.2 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.2 21 8.9c0 3.3-3 6-7.7 10.2L12 20.3z'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.9 3 6.2 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.2 21 8.9c0 3.3-3 6-7.7 10.2L12 20.3z'/%3E%3C/svg%3E") center / contain no-repeat;
}

// 日视图里的单列
.ss-day-presentation .ss-tile {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 6px 12px;
  text-align: left;
}
.ss-day-presentation .ss-tile strong {
  -webkit-line-clamp: 2;
  font-size: 15px;
}
.ss-day-presentation .ss-tile span {
  -webkit-line-clamp: 1;
  font-size: 12px;
}
.ss-day-presentation .ss-tile-status {
  position: absolute;
  top: 50%;
  right: 10px;
  display: block;
  max-width: 76px;
  transform: translateY(-50%);
  color: var(--ss-theme-text);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  text-align: right;
}
.ss-day-presentation .ss-tile:has(.ss-tile-status) {
  padding-right: 90px;
}
.ss-day-presentation .ss-slot-label b {
  font-size: 14px;
}
.ss-day-presentation .ss-slot-label span {
  font-size: 10px;
}

// 现在
.ss-now-anchor {
  position: relative;
  z-index: 4;
  min-width: 0;
  pointer-events: none;
}
.ss-now-anchor.beneath {
  z-index: 1;
}
.ss-now-badge {
  position: absolute;
  left: 50%;
  height: 16px;
  padding: 0 4px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: var(--ss-theme-fill);
  color: var(--ss-theme-on-fill);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
}
.ss-now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1.5px;
  transform: translateY(-50%);
  background: var(--ss-theme-text);
}
.ss-now-line::before {
  content: "";
  position: absolute;
  top: 50%;
  left: -3.5px;
  width: 7px;
  height: 7px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--ss-theme-fill);
}
</style>
