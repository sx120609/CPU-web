<template>
  <!-- 简约、素笺和站牌在没课的日子显示休息卡；格子和表格保留空行，这样还能在那里加课。 -->
  <div v-if="showsRestCard" class="sd-rest" :class="[`sd-${visualStyle}`, { 'sd-dark': dark }]">
    <div class="sd-rest-card">
      <svg class="sd-rest-art" viewBox="0 0 116 88" aria-hidden="true">
        <ellipse cx="54" cy="43" rx="39" ry="39" class="halo" />
        <ellipse cx="56.5" cy="77.5" rx="32.5" ry="2.5" class="ground" />
        <circle cx="79.5" cy="25.5" r="14.5" class="sun" />
        <path
          class="cloud"
          d="M32 67C11 67 10 39 30 37C29 15 60 11 66 30C76 26 87 32 85 42C105 43 103 67 84 67Z"
        />
        <path class="eyes" d="M41 48Q46 54 51 48M63 48Q68 54 73 48" />
      </svg>
      <h3>这天没有课程</h3>
      <p>{{ emptyNote || "留点时间，做喜欢的事" }}</p>
    </div>
  </div>

  <StyledWeekGrid
    v-else-if="visualStyle === 'grid' || visualStyle === 'classic'"
    :visual-style="visualStyle"
    :palette="palette"
    :dark="dark"
    :has-background="hasBackground"
    :days="gridDays"
    :clocks="clocks"
    :now-minutes="nowMinutes"
    :completed-before="completedBefore"
    :shows-date-header="false"
    day-presentation
    @course="(block, _owner, source) => emit('course', block, source)"
    @slot="(_day, slot) => emit('slot', slot)"
  />

  <!-- 简约：按开始时间排的时间线，不给空节次留行；同时开始的课共用一个节点。 -->
  <div v-else-if="visualStyle === 'minimal'" class="sd-timeline" :class="{ 'sd-dark': dark }">
    <section v-for="group in timelineGroups" :key="group.key" class="sd-group" :class="`phase-${group.phase}`">
      <div class="sd-rail" aria-hidden="true"><i class="sd-node" /></div>
      <div class="sd-times">
        <b>{{ group.start }}</b>
        <span>{{ group.end }}</span>
        <em v-if="group.statusText" class="chip">{{ group.statusText }}</em>
        <em v-else>{{ group.slotText }}</em>
      </div>
      <div class="sd-cards">
        <article
          v-for="item in group.items"
          :key="item.block.id"
          class="sd-card"
          :class="{ completed: item.completed }"
          :style="toneStyle(item.block)"
          role="button"
          tabindex="0"
          @click="emit('course', item.block.source, $event)"
          @keydown.enter.prevent="emit('course', item.block.source, $event)"
        >
          <strong>{{ item.block.course.name }}</strong>
          <span v-if="item.detail">{{ item.detail }}</span>
          <small v-if="item.slotLabel">{{ item.slotLabel }}</small>
          <i v-if="item.completed" class="sd-check" aria-hidden="true">✓</i>
        </article>
      </div>
    </section>
  </div>

  <!-- 表格：每节一行，空节次也在。 -->
  <div v-else-if="visualStyle === 'table'" class="sd-table" :class="{ 'sd-dark': dark }">
    <div class="sd-table-head"><span>节</span><span>时间</span><span>课程</span><span>教室</span></div>
    <div v-for="row in tableRows" :key="row.slot.no" class="sd-table-row">
      <b class="no">{{ row.slot.no }}</b>
      <div class="time"><span>{{ row.slot.start }}</span><span>{{ row.slot.end }}</span></div>
      <div v-if="!row.items.length" class="sd-table-empty" role="button" tabindex="0" @click="emit('slot', row.slot.no)">
        <span>—</span><span>—</span>
      </div>
      <div v-else class="sd-table-courses">
        <article
          v-for="item in row.items"
          :key="item.block.id"
          class="sd-table-course"
          :style="toneStyle(item.block)"
          role="button"
          tabindex="0"
          @click="emit('course', item.block.source, $event)"
          @keydown.enter.prevent="emit('course', item.block.source, $event)"
        >
          <div class="name">
            <strong>{{ item.block.course.name }}</strong>
            <!-- 状态属于整门课，只在它的第一节写一次。 -->
            <small v-if="item.continuation">续课</small>
            <small v-else-if="item.label">{{ item.label }}</small>
          </div>
          <span class="room">{{ cleanLocation(item.block.course.location) || "—" }}</span>
        </article>
      </div>
    </div>
  </div>

  <!-- 素笺：上午、下午、晚上分段的清单。 -->
  <div v-else-if="visualStyle === 'paper'" class="sd-paper" :class="{ 'sd-dark': dark }">
    <template v-for="section in paperSections" :key="section.title">
      <h4 class="sd-section"><span>{{ section.title }}</span><i /></h4>
      <article
        v-for="item in section.items"
        :key="item.block.id"
        class="sd-paper-row"
        :style="toneStyle(item.block)"
        role="button"
        tabindex="0"
        @click="emit('course', item.block.source, $event)"
        @keydown.enter.prevent="emit('course', item.block.source, $event)"
      >
        <div class="time"><b>{{ item.start }}</b><span>{{ item.end }}</span></div>
        <i class="bar" />
        <div class="body">
          <strong>{{ item.block.course.name }}</strong>
          <span v-if="cleanLocation(item.block.course.location)">@{{ cleanLocation(item.block.course.location) }}</span>
          <small>{{ slotText(item.block) }}</small>
          <em v-if="item.label">{{ item.label }}</em>
        </div>
      </article>
    </template>
  </div>

  <!-- 站牌：现在在上什么、接下来是什么、还剩多久。别的日子没有「现在」，只是一张普通的时刻表。 -->
  <div v-else class="sd-board" :class="{ 'sd-dark': dark }">
    <template v-if="nowMinutes !== null">
      <div class="sd-board-now">
        <span class="tag">现在</span>
        <b>{{ formatClock(nowMinutes, true) }}</b>
        <span class="rest">{{ boardRemaining > 0 ? `今天还有 ${boardRemaining} 门课` : "今天的课上完了" }}</span>
      </div>
      <article
        v-for="item in boardCurrent"
        :key="item.block.id"
        class="sd-board-hero"
        :style="toneStyle(item.block)"
        role="button"
        tabindex="0"
        @click="emit('course', item.block.source, $event)"
        @keydown.enter.prevent="emit('course', item.block.source, $event)"
      >
        <div class="top"><span>正在上 · {{ slotText(item.block) }}</span><b>还剩 {{ item.remaining }} 分</b></div>
        <div class="range">{{ item.start }} — {{ item.end }}</div>
        <div class="name"><i class="mark" /><strong>{{ item.block.course.name }}</strong></div>
        <p v-if="item.detail">{{ item.detail }}</p>
        <div class="progress"><i :style="{ width: `${item.progress * 100}%` }" /></div>
      </article>
      <template v-if="boardUpcoming.length">
        <h4 class="sd-board-heading ruled">接下来</h4>
        <article
          v-for="(item, index) in boardUpcoming"
          :key="item.block.id"
          class="sd-board-row"
          :style="toneStyle(item.block)"
          role="button"
          tabindex="0"
          @click="emit('course', item.block.source, $event)"
          @keydown.enter.prevent="emit('course', item.block.source, $event)"
        >
          <b class="start">{{ item.start }}</b>
          <div class="body">
            <div class="name"><i class="mark" /><strong>{{ item.block.course.name }}</strong></div>
            <span>{{ item.meta }}</span>
          </div>
          <em v-if="index === 0 && item.countdown" class="emphasized">{{ item.countdown }}</em>
          <em v-else-if="item.session">{{ item.session }}</em>
        </article>
      </template>
      <template v-if="boardFinished.length">
        <h4 class="sd-board-heading">已结束</h4>
        <article
          v-for="item in boardFinished"
          :key="item.block.id"
          class="sd-board-finished"
          role="button"
          tabindex="0"
          @click="emit('course', item.block.source, $event)"
          @keydown.enter.prevent="emit('course', item.block.source, $event)"
        >
          <b>{{ item.start }}</b>
          <span>{{ item.block.course.name }}</span>
          <small v-if="cleanLocation(item.block.course.location)">{{ cleanLocation(item.block.course.location) }}</small>
        </article>
      </template>
    </template>
    <template v-else>
      <h4 class="sd-board-heading ruled">课程安排</h4>
      <article
        v-for="item in boardItems"
        :key="item.block.id"
        class="sd-board-row"
        :style="toneStyle(item.block)"
        role="button"
        tabindex="0"
        @click="emit('course', item.block.source, $event)"
        @keydown.enter.prevent="emit('course', item.block.source, $event)"
      >
        <b class="start">{{ item.start }}</b>
        <div class="body">
          <div class="name"><i class="mark" /><strong>{{ item.block.course.name }}</strong></div>
          <span>{{ item.meta }}</span>
        </div>
        <em v-if="item.phase === 'completed'">已结束</em>
        <em v-else-if="item.session">{{ item.session }}</em>
      </article>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import StyledWeekGrid from "./StyledWeekGrid.vue";
import type { PlacedCourseBlock } from "./displayPriority";
import {
  blockEnd,
  blockPhase,
  blockStart,
  blockStatusLabel,
  cleanLocation,
  clockMinutes,
  formatClock,
  slotSession,
  slotText,
  type CoursePhase,
  type DayStatus,
  type SlotClock,
} from "./nowIndicator";
import { scheduleStyleCourseTone, type ScheduleStyleKey } from "./scheduleStyle";
import { displayBlockOf, type DisplayBlock, type StyledDay } from "./styledTypes";
import type { WeekCourseBlock } from "./types";

const props = withDefaults(defineProps<{
  visualStyle: ScheduleStyleKey;
  palette: string;
  dark: boolean;
  hasBackground?: boolean;
  /** 这一页是星期几（1–7）。 */
  day: number;
  pieces: PlacedCourseBlock[];
  clocks: SlotClock[];
  /** 这一页是今天、并且要标出「现在」时才有值。 */
  nowMinutes?: number | null;
  completedBefore?: number | null;
  /** 休息卡下面的说明，比如放假的原因。 */
  emptyNote?: string;
}>(), {
  hasBackground: false,
  nowMinutes: null,
  completedBefore: null,
  emptyNote: "",
});

const emit = defineEmits<{
  (event: "course", block: WeekCourseBlock, source: Event): void;
  (event: "slot", slot: number): void;
}>();

const status = computed<DayStatus>(() => ({
  clocks: props.clocks,
  now: props.nowMinutes,
  completedBefore: props.completedBefore,
}));

const blocks = computed<DisplayBlock[]>(() => props.pieces
  .map(displayBlockOf)
  .sort((a, b) => a.startSlot - b.startSlot || a.endSlot - b.endSlot || (a.id < b.id ? -1 : 1)));

const showsRestCard = computed(() => (
  !blocks.value.length && (props.visualStyle === "minimal" || props.visualStyle === "paper" || props.visualStyle === "board")
));

const gridDays = computed<StyledDay[]>(() => [{
  day: props.day,
  dateText: "",
  rawDate: "",
  isToday: props.nowMinutes !== null,
  adjustmentKind: null,
  pieces: props.pieces,
}]);

function toneStyle(block: DisplayBlock) {
  const tone = scheduleStyleCourseTone(block.course.name, props.palette, props.dark, props.hasBackground);
  return {
    "--tile-accent": tone.accent,
    "--tile-accent-inverse": tone.accentInverse,
    "--tile-fill": tone.fill,
    "--tile-border": tone.border,
  };
}

function detailOf(block: DisplayBlock, withAt = true) {
  const location = cleanLocation(block.course.location);
  return [
    location ? (withAt ? `@${location}` : location) : "",
    block.course.teacher?.trim() ?? "",
  ].filter(Boolean).join(" · ");
}

// MARK: 简约

type GroupPhase = "none" | "past" | "current" | "next";

const timelineGroups = computed(() => {
  const byStart = new Map<number, DisplayBlock[]>();
  for (const block of blocks.value) {
    const list = byStart.get(block.startSlot) ?? [];
    list.push(block);
    byStart.set(block.startSlot, list);
  }
  const groups = [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([startSlot, items]) => {
    const sorted = [...items].sort((a, b) => a.lane - b.lane || a.endSlot - b.endSlot);
    const last = sorted.reduce((best, item) => (item.endSlot > best.endSlot ? item : best), sorted[0]);
    const start = clockMinutes(blockStart(status.value, sorted[0]));
    const end = clockMinutes(blockEnd(status.value, last));
    return { startSlot, endSlot: last.endSlot, items: sorted, last, range: start !== null && end !== null ? { start, end } : null };
  });
  const now = status.value.now;
  const inClass = now !== null && groups.some((group) => group.range && group.range.start <= now && now <= group.range.end);
  let foundNext = false;
  return groups.map((group) => {
    let phase: GroupPhase = "none";
    let statusText = "";
    if (group.range) {
      if (now === null) {
        // 过去的日子：全都结束了，没有可以倒数的「现在」。
        if (status.value.completedBefore !== null && group.range.end <= status.value.completedBefore) phase = "past";
      } else if (now > group.range.end) {
        phase = "past";
      } else if (now >= group.range.start) {
        phase = "current";
        statusText = `还剩 ${Math.max(1, group.range.end - now)} 分`;
      } else if (!inClass && !foundNext) {
        foundNext = true;
        phase = "next";
        const wait = group.range.start - now;
        statusText = wait < 60 ? `${Math.max(1, wait)} 分钟后` : `约 ${Math.round(wait / 60)} 小时后`;
      }
    }
    return {
      key: group.startSlot,
      phase,
      statusText,
      start: blockStart(status.value, group.items[0]),
      end: props.clocks.find((slot) => slot.no === group.endSlot)?.end ?? "—",
      slotText: group.startSlot === group.endSlot ? `第 ${group.startSlot} 节` : `${group.startSlot}–${group.endSlot} 节`,
      items: group.items.map((block) => ({
        block,
        completed: blockPhase(status.value, block) === "completed",
        detail: detailOf(block),
        // 左边那一栏已经写了节次；只有几门课同时开始时，卡片上才再写一遍。
        slotLabel: group.items.length > 1
          ? `${slotText(block)} · ${blockStart(status.value, block)}–${blockEnd(status.value, block)}`
          : "",
      })),
    };
  });
});

// MARK: 表格

const tableRows = computed(() => props.clocks.map((slot) => ({
  slot,
  items: blocks.value
    .filter((block) => block.startSlot <= slot.no && slot.no <= block.endSlot)
    .map((block) => ({
      block,
      continuation: slot.no > block.startSlot,
      label: blockStatusLabel(status.value, block),
    })),
})));

// MARK: 素笺

const paperSections = computed(() => ["上午", "下午", "晚上", "课程"]
  .map((title) => ({
    title,
    items: blocks.value
      .filter((block) => slotSession(blockStart(status.value, block)) === title)
      .map((block) => ({
        block,
        start: blockStart(status.value, block),
        end: blockEnd(status.value, block),
        label: blockStatusLabel(status.value, block),
      })),
  }))
  .filter((section) => section.items.length));

// MARK: 站牌

interface BoardItem {
  block: DisplayBlock;
  phase: CoursePhase;
  start: string;
  end: string;
  detail: string;
  meta: string;
  session: string;
  countdown: string;
  remaining: number;
  progress: number;
}

const boardItems = computed<BoardItem[]>(() => blocks.value.map((block) => {
  const start = blockStart(status.value, block);
  const end = blockEnd(status.value, block);
  const startMinutes = clockMinutes(start);
  const endMinutes = clockMinutes(end);
  const now = status.value.now;
  const session = slotSession(start);
  let countdown = "";
  if (now !== null && startMinutes !== null && startMinutes > now) {
    const wait = startMinutes - now;
    countdown = wait < 60
      ? `${wait} 分钟后`
      : (wait % 60 === 0 ? `${wait / 60} 小时后` : `${Math.floor(wait / 60)} 小时 ${wait % 60} 分后`);
  }
  const spans = startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;
  return {
    block,
    phase: blockPhase(status.value, block),
    start,
    end,
    detail: detailOf(block, false),
    meta: [cleanLocation(block.course.location), slotText(block)].filter(Boolean).join(" · "),
    session: session === "课程" ? "" : session,
    countdown,
    remaining: Math.max(1, (endMinutes ?? now ?? 0) - (now ?? 0)),
    progress: spans && now !== null ? Math.min(1, Math.max(0, (now - startMinutes) / (endMinutes - startMinutes))) : 0,
  };
}));

const boardCurrent = computed(() => boardItems.value.filter((item) => item.phase === "current"));
const boardUpcoming = computed(() => boardItems.value.filter((item) => item.phase === "upcoming"));
const boardFinished = computed(() => boardItems.value.filter((item) => item.phase === "completed"));
const boardRemaining = computed(() => boardCurrent.value.length + boardUpcoming.value.length);
</script>

<style scoped lang="scss">
.sd-rest,
.sd-timeline,
.sd-table,
.sd-paper,
.sd-board {
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  color: var(--ss-ink);
  font-family: var(--ss-font);
  font-variant-numeric: tabular-nums;
  touch-action: pan-y;
}
[role="button"] {
  cursor: pointer;
}

// 休息卡
.sd-rest {
  min-height: 100%;
  padding: 0 12px;
  display: grid;
  place-items: center;
}
.sd-rest-card {
  width: 100%;
  max-width: 360px;
  padding: 32px 24px;
  border: 1px solid rgba(var(--ss-theme-rgb), 0.07);
  border-radius: 32px;
  background: linear-gradient(rgba(var(--ss-theme-rgb), 0.025), rgba(var(--ss-theme-rgb), 0.025)), var(--ss-card);
  text-align: center;
}
.sd-dark .sd-rest-card {
  border-color: rgba(var(--ss-theme-rgb), 0.12);
  background: linear-gradient(rgba(var(--ss-theme-rgb), 0.06), rgba(var(--ss-theme-rgb), 0.06)), var(--ss-card);
}
.sd-paper .sd-rest-card,
.sd-board .sd-rest-card {
  border-color: rgba(var(--ss-ink-rgb), 0.18);
  border-radius: 2px;
  background: var(--ss-panel);
}
.sd-rest-art {
  width: 184px;
  height: 140px;
  margin-bottom: 24px;
  color: var(--ss-accent);
}
.sd-rest-art .halo { fill: currentColor; opacity: 0.05; }
.sd-rest-art .ground { fill: currentColor; opacity: 0.07; }
.sd-rest-art .sun { fill: currentColor; opacity: 0.24; }
.sd-rest-art .cloud { fill: #fff; stroke: currentColor; stroke-width: 1.2; stroke-opacity: 0.2; }
.sd-rest-art .eyes { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; opacity: 0.7; }
.sd-dark .sd-rest-art .halo,
.sd-dark .sd-rest-art .ground { opacity: 0.1; }
.sd-dark .sd-rest-art .sun { opacity: 0.48; }
.sd-dark .sd-rest-art .cloud { fill: #333; stroke-opacity: 0.35; }
.sd-dark .sd-rest-art .eyes { opacity: 0.85; }
.sd-rest-card h3 {
  margin: 0 0 10px;
  color: var(--ss-ink);
  font-size: 20px;
  font-weight: 600;
}
.sd-rest-card p {
  margin: 0;
  color: var(--ss-meta);
  font-size: 15px;
  line-height: 1.6;
}

// 简约：时间线
.sd-timeline {
  display: flex;
  flex-direction: column;
  // 已结束的勾有一半露在卡片上沿外面，顶上要给它留出地方。
  padding: 14px 0 12px;
}
.sd-group {
  position: relative;
  display: grid;
  grid-template-columns: 5px 56px minmax(0, 1fr);
  column-gap: 12px;
  padding: 0 0 20px 16px;
}
.sd-group:last-child {
  padding-bottom: 0;
}
// 轨道在时间的外侧，经过每个节点。
.sd-rail {
  position: relative;
  grid-row: 1;
}
.sd-rail::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: -20px;
  left: 2px;
  width: 1px;
  background: color-mix(in srgb, var(--ss-secondary) 25%, transparent);
}
.sd-group:first-child .sd-rail::before {
  top: 28px;
}
.sd-group:last-child .sd-rail::before {
  bottom: auto;
  height: 28px;
}
.sd-group:first-child:last-child .sd-rail::before {
  display: none;
}
.sd-group.phase-past .sd-rail::before {
  background: color-mix(in srgb, var(--ss-theme-text) 60%, transparent);
}
.sd-group.phase-current .sd-rail::before,
.sd-group.phase-next .sd-rail::before {
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--ss-theme-text) 60%, transparent) 0 28px,
    color-mix(in srgb, var(--ss-secondary) 25%, transparent) 28px
  );
}
.sd-node {
  position: absolute;
  top: 28px;
  left: 2.5px;
  width: 5px;
  height: 5px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ss-secondary) 75%, transparent);
}
.phase-past .sd-node {
  width: 7px;
  height: 7px;
  background: var(--ss-theme-text);
}
// 正在上：实心圆点带一圈光晕。接下来：一个主题色的圆环。
.phase-current .sd-node {
  width: 7px;
  height: 7px;
  background: var(--ss-theme-fill);
  box-shadow: 0 0 0 3px rgba(var(--ss-theme-rgb), 0.2);
}
.phase-next .sd-node {
  width: 8px;
  height: 8px;
  border: 1.5px solid var(--ss-theme-text);
  background: var(--ss-panel);
  box-sizing: border-box;
}
.sd-times {
  padding-top: 17px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  line-height: 1.15;
  white-space: nowrap;
}
.sd-times b {
  color: var(--ss-ink);
  font-size: 17px;
  font-weight: 600;
}
.phase-current .sd-times b,
.phase-next .sd-times b {
  color: var(--ss-theme-text);
}
.phase-past .sd-times b {
  color: var(--ss-meta);
}
.sd-times span {
  color: var(--ss-meta);
  font-size: 12px;
  font-weight: 500;
}
.sd-times em {
  margin-top: 2px;
  color: var(--ss-meta);
  font-size: 11px;
  font-style: normal;
  font-weight: 500;
}
.sd-times em.chip {
  padding: 2px 5px;
  border-radius: 999px;
  background: rgba(var(--ss-theme-rgb), 0.12);
  color: var(--ss-theme-text);
  font-size: 10px;
  font-weight: 600;
}
.sd-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
// 简约的日视图卡片：淡彩底，一圈浅边，一点柔和的投影。
.sd-card {
  position: relative;
  box-sizing: border-box;
  min-height: 92px;
  padding: 16px 18px;
  border: 1px solid var(--tile-border);
  border-radius: 20px;
  background: var(--tile-fill);
  box-shadow: inset 0 0 0 0.6px rgba(255, 255, 255, 0.62), 0 3px 7px rgba(0, 0, 0, 0.07);
  color: var(--tile-accent);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 7px;
  line-height: 1.25;
}
.sd-dark .sd-card {
  box-shadow: inset 0 0 0 0.6px rgba(255, 255, 255, 0.1), 0 3px 7px rgba(0, 0, 0, 0.18);
}
.sd-card strong {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 17px;
  font-weight: 600;
}
.sd-card span {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sd-card small {
  font-size: 11px;
  font-weight: 500;
}
.sd-card.completed {
  border-color: color-mix(in srgb, var(--ss-secondary) 20%, transparent);
  box-shadow: none;
}
.sd-card.completed strong {
  padding-right: 26px;
  font-weight: 500;
}
.sd-card.completed small {
  color: var(--ss-meta);
}
.sd-check {
  position: absolute;
  top: -12px;
  right: 12px;
  width: 25px;
  height: 25px;
  transform: rotate(10deg);
  border: 1px solid color-mix(in srgb, var(--tile-accent) 22%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--tile-accent) 12%, var(--ss-canvas-solid, #fff));
  color: var(--tile-accent);
  display: grid;
  place-items: center;
  font-size: 13px;
  font-style: normal;
  font-weight: 700;
}
.sd-dark .sd-check {
  background: color-mix(in srgb, var(--tile-accent) 20%, #1a1d21);
}

// 表格
.sd-table {
  border: 0.5px solid var(--ss-cell-border);
  background: var(--ss-panel);
}
.sd-table-head,
.sd-table-row {
  display: grid;
  grid-template-columns: 28px 58px minmax(0, 1fr);
}
.sd-table-head {
  grid-template-columns: 28px 58px minmax(0, 1fr) 80px;
  height: 32px;
  align-items: center;
  background: rgba(var(--ss-ink-rgb), 0.06);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}
.sd-table-head span:nth-child(3) {
  padding-left: 8px;
  text-align: left;
}
.sd-table-head span:nth-child(4) {
  padding-left: 6px;
  text-align: left;
}
.sd-table-row {
  min-height: 58px;
  border-top: 0.5px solid var(--ss-cell-border);
}
.sd-table-row .no {
  display: grid;
  place-items: center;
  font-size: 12px;
}
.sd-table-row .time {
  border-left: 0.5px solid var(--ss-cell-border);
  border-right: 0.5px solid var(--ss-cell-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px;
}
.sd-table-empty {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 80px;
  align-items: center;
  color: var(--ss-meta);
}
.sd-table-empty span:first-child {
  padding-left: 8px;
}
.sd-table-empty span:last-child {
  align-self: stretch;
  padding-left: 6px;
  border-left: 0.5px solid var(--ss-cell-border);
  display: flex;
  align-items: center;
}
.sd-table-courses {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sd-table-course {
  flex: 1 1 auto;
  min-height: 58px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 80px;
  background: var(--tile-fill);
  box-shadow: inset 3px 0 0 var(--tile-accent);
  color: var(--tile-accent);
}
.sd-table-course .name {
  min-width: 0;
  padding: 4px 5px 4px 8px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
}
.sd-table-course strong {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}
.sd-table-course small {
  font-size: 11px;
}
.sd-table-course .room {
  padding: 4px 6px;
  border-left: 0.5px solid var(--ss-cell-border);
  display: flex;
  align-items: center;
  font-size: 12px;
  line-height: 1.2;
  word-break: break-all;
}

// 素笺
.sd-paper {
  padding: 12px;
  border: 1.2px solid rgba(var(--ss-ink-rgb), 0.6);
  border-radius: 2px;
  background: var(--ss-panel);
  box-shadow: inset 0 0 0 3px var(--ss-panel), inset 0 0 0 3.6px rgba(var(--ss-ink-rgb), 0.24);
}
.sd-section {
  height: 40px;
  margin: 0;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 700;
}
.sd-section i {
  flex: 1 1 auto;
  height: 0.5px;
  background: rgba(var(--ss-ink-rgb), 0.2);
}
.sd-paper-row {
  min-height: 96px;
  padding: 0 12px;
  border-bottom: 0.5px solid rgba(var(--ss-ink-rgb), 0.15);
  display: flex;
  align-items: center;
  gap: 10px;
}
.sd-paper-row:last-child {
  border-bottom: 0;
}
.sd-paper-row .time {
  flex: 0 0 64px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sd-paper-row .time b {
  font-size: 20px;
  font-weight: 700;
}
.sd-paper-row .time span {
  font-size: 12px;
}
.sd-paper-row .bar {
  align-self: stretch;
  flex: 0 0 2px;
  margin: 16px 0;
  background: var(--tile-accent);
}
.sd-paper-row .body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  line-height: 1.2;
}
.sd-paper-row strong {
  font-size: 17px;
  font-weight: 600;
}
.sd-paper-row .body span {
  font-size: 15px;
}
.sd-paper-row small {
  font-size: 11px;
}
.sd-paper-row em {
  color: var(--ss-accent);
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
}

// 站牌
.sd-board {
  padding: 8px 0;
  border-radius: 2px;
  background: var(--ss-panel);
}
.sd-board-now {
  height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
}
.sd-board-now .tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  opacity: 0.72;
}
.sd-board-now b {
  font-size: 16px;
  font-weight: 700;
}
.sd-board-now .rest {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
  opacity: 0.72;
}
.sd-board-heading {
  height: 40px;
  margin: 0;
  padding: 0 12px 6px;
  box-sizing: border-box;
  display: flex;
  align-items: flex-end;
  color: rgba(var(--ss-ink-rgb), 0.72);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
}
// 开启一张清单的粗线。「已结束」是比较安静的收尾，不画。
.sd-board-heading.ruled {
  border-bottom: 2px solid rgba(var(--ss-ink-rgb), 0.65);
}
// 正在上的那节反色显示：时间段、课名、教室和老师、剩余时间和进度。
.sd-board-hero {
  box-sizing: border-box;
  min-height: 148px;
  margin-bottom: 4px;
  padding: 14px;
  background: var(--ss-ink);
  color: var(--ss-inverse-ink);
  display: flex;
  flex-direction: column;
  gap: 4px;
  white-space: nowrap;
}
.sd-board-hero .top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.sd-board-hero .top span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  opacity: 0.72;
}
.sd-board-hero .top b {
  color: var(--tile-accent-inverse);
  font-size: 13px;
}
.sd-board-hero .range {
  margin: 4px 0;
  font-size: 30px;
  font-weight: 700;
}
.sd-board-hero .name,
.sd-board-row .name {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.sd-board-hero strong {
  overflow: hidden;
  font-size: 17px;
  font-weight: 700;
  text-overflow: ellipsis;
}
.sd-board-hero p {
  margin: 3px 0 0;
  overflow: hidden;
  font-size: 15px;
  opacity: 0.72;
  text-overflow: ellipsis;
}
.sd-board-hero .progress {
  height: 3px;
  margin-top: auto;
  background: color-mix(in srgb, var(--ss-inverse-ink) 25%, transparent);
}
.sd-board-hero .progress i {
  display: block;
  height: 100%;
  background: var(--tile-accent-inverse);
}
.mark {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 1.5px;
  background: var(--tile-accent);
}
.sd-board-hero .mark {
  background: var(--tile-accent-inverse);
}
.sd-board-row {
  min-height: 68px;
  padding: 0 12px;
  border-bottom: 0.5px solid rgba(var(--ss-ink-rgb), 0.15);
  display: flex;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
}
.sd-board-row:last-of-type {
  border-bottom: 0;
}
.sd-board-row .start {
  flex: 0 0 82px;
  font-size: 24px;
  font-weight: 700;
}
.sd-board-row .body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sd-board-row strong {
  overflow: hidden;
  font-size: 17px;
  font-weight: 600;
  text-overflow: ellipsis;
}
.sd-board-row .body span {
  overflow: hidden;
  font-size: 12px;
  opacity: 0.72;
  text-overflow: ellipsis;
}
.sd-board-row em {
  flex: 0 0 auto;
  color: rgba(var(--ss-ink-rgb), 0.72);
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
}
.sd-board-row em.emphasized {
  color: var(--ss-theme-text);
}
.sd-board-finished {
  height: 34px;
  padding: 0 12px;
  color: rgba(var(--ss-ink-rgb), 0.62);
  display: flex;
  align-items: baseline;
  gap: 12px;
  white-space: nowrap;
}
.sd-board-finished b {
  flex: 0 0 82px;
  font-size: 14px;
  font-weight: 600;
}
.sd-board-finished span {
  flex: 1 1 auto;
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
}
.sd-board-finished small {
  font-size: 12px;
}
</style>
