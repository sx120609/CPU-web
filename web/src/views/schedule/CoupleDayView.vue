<template>
  <!-- 双人模式的日视图：时间轴在中间，左边是我的课，右边是 TA 的课。两人各占一边，
       谁也不用给谁让宽度；一起上的课两边各画一格，带一颗小爱心。 -->
  <section class="cd" :class="[`cd-${visualStyle}`, { 'cd-dark': dark }]" aria-label="两人当日课表">
    <header class="cd-head">
      <span class="cd-who" :style="ownChipStyle">我</span>
      <span class="cd-head-axis">节次</span>
      <span class="cd-who ta" :style="partnerChipStyle">{{ partnerName || "TA" }}</span>
    </header>
    <div class="cd-body" :style="{ gridTemplateRows: `repeat(${clocks.length}, var(--cd-row))` }">
      <template v-for="(slot, row) in clocks" :key="slot.no">
        <button
          type="button"
          class="cd-cell"
          :style="{ gridColumn: 1, gridRow: row + 1 }"
          :disabled="!canAdd"
          :aria-label="`第 ${slot.no} 节，添加课程`"
          @click="emit('slot', slot.no)"
        />
        <div class="cd-axis" :class="{ now: nowRow === row }" :style="{ gridColumn: 2, gridRow: row + 1 }">
          <b>{{ slot.no }}</b>
          <span>{{ slot.start }}</span>
        </div>
        <div class="cd-cell" :style="{ gridColumn: 3, gridRow: row + 1 }" aria-hidden="true" />
      </template>

      <article
        v-for="tile in tiles"
        :key="tile.key"
        class="cd-tile"
        :class="[tile.owner, { shared: tile.shared, short: tile.span === 1, narrow: tile.lanes > 1 }]"
        :style="tile.style"
        :title="tile.title"
        role="button"
        tabindex="0"
        @click.stop="emit('course', tile.block, tile.owner, $event)"
        @keydown.enter.prevent="emit('course', tile.block, tile.owner, $event)"
      >
        <strong>{{ tile.block.course.name }}</strong>
        <span v-if="tile.location">@{{ tile.location }}</span>
        <em v-if="tile.span > 1">{{ tile.time }}</em>
      </article>

      <div v-if="nowLine" class="cd-now" :style="{ gridRow: nowLine.row + 1 }" aria-hidden="true">
        <i :style="{ top: nowLine.top }" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { coupleCourseTone, type CoupleColor } from "./couple";
import type { PlacedCourseBlock } from "./displayPriority";
import { cleanLocation, nowRowPosition, type SlotClock } from "./nowIndicator";
import type { ScheduleStyleKey } from "./scheduleStyle";
import type { TileOwner } from "./styledTypes";
import type { WeekCourseBlock } from "./types";

const props = withDefaults(defineProps<{
  visualStyle: ScheduleStyleKey;
  palette: string;
  dark: boolean;
  hasBackground?: boolean;
  clocks: SlotClock[];
  /** 我这一天的课，已经分好道。 */
  pieces: PlacedCourseBlock[];
  /** TA 这一天的课，不含一起上的那些。 */
  partnerPieces: PlacedCourseBlock[];
  /** 两人一起上的课（`pieces` 里的标识）。 */
  sharedIds?: Set<string>;
  partnerName: string;
  partnerColor: CoupleColor;
  myColor: CoupleColor;
  /** 这一天是今天时的当前分钟数，用来画「现在」。 */
  nowMinutes?: number | null;
  canAdd?: boolean;
}>(), {
  hasBackground: false,
  sharedIds: () => new Set<string>(),
  nowMinutes: null,
  canAdd: true,
});

const emit = defineEmits<{
  (event: "course", block: WeekCourseBlock, owner: TileOwner, source: Event): void;
  (event: "slot", slot: number): void;
}>();

const rowIndex = computed(() => new Map(props.clocks.map((slot, index) => [slot.no, index])));

// 一个人一种颜色：左边全是我的颜色，右边全是 TA 的颜色。
function personTone(color: CoupleColor) {
  const tone = coupleCourseTone(color, "", props.dark);
  return { accent: tone.text, fill: tone.bg, border: tone.border };
}
const ownTone = computed(() => personTone(props.myColor));
const partnerTone = computed(() => personTone(props.partnerColor));

function chipStyle(tone: { accent: string; fill: string; border: string }) {
  return { color: tone.accent, background: tone.fill, borderColor: tone.border };
}
const ownChipStyle = computed(() => chipStyle(ownTone.value));
const partnerChipStyle = computed(() => chipStyle(partnerTone.value));

function buildTile(piece: PlacedCourseBlock, owner: TileOwner, shared: boolean, lane = piece.lane, lanes = piece.lanes) {
  const first = rowIndex.value.get(piece.startSlot);
  const last = rowIndex.value.get(piece.endSlot);
  if (first === undefined && last === undefined) return null;
  const startRow = first ?? 0;
  const endRow = Math.max(startRow, last ?? props.clocks.length - 1);
  const tone = owner === "ta" ? partnerTone.value : ownTone.value;
  const start = piece.block.course.customStartTime?.trim() || props.clocks[startRow]?.start || "";
  const end = piece.block.course.customEndTime?.trim() || props.clocks[endRow]?.end || "";
  const share = 100 / lanes;
  return {
    key: `${owner}-${piece.id}`,
    block: piece.block,
    owner,
    shared,
    lanes,
    span: endRow - startRow + 1,
    location: cleanLocation(piece.block.course.location),
    time: start && end ? `${start}–${end}` : "",
    title: [
      owner === "ta" ? `${props.partnerName || "TA"} · ${piece.block.course.name}` : piece.block.course.name,
      piece.block.course.location ? `地点：${piece.block.course.location}` : "",
    ].filter(Boolean).join("\n"),
    style: {
      gridColumn: owner === "ta" ? 3 : 1,
      gridRow: `${startRow + 1} / ${endRow + 2}`,
      ...(lanes > 1 ? { width: `calc(${share}% - 2px)`, marginLeft: `calc(${share * lane}% + 1px)`, justifySelf: "start" } : {}),
      "--tile-accent": tone.accent,
      "--tile-fill": tone.fill,
      "--tile-border": tone.border,
    },
  };
}

const tiles = computed(() => {
  const list: NonNullable<ReturnType<typeof buildTile>>[] = [];
  const push = (tile: ReturnType<typeof buildTile>) => { if (tile) list.push(tile); };
  for (const piece of props.pieces) {
    const shared = props.sharedIds.has(piece.id);
    push(buildTile(piece, "me", shared));
    // 一起上的课也是 TA 的课：右边照样有一格。
    if (shared) push(buildTile(piece, "ta", true, 0, 1));
  }
  for (const piece of props.partnerPieces) push(buildTile(piece, "ta", false));
  return list;
});

const nowPlace = computed(() => (props.nowMinutes === null ? null : nowRowPosition(props.nowMinutes, props.clocks)));
const nowRow = computed(() => (nowPlace.value && !nowPlace.value.inGap ? nowPlace.value.row : -1));
const nowLine = computed(() => {
  const place = nowPlace.value;
  if (!place) return null;
  // 课间时线落在两节之间的缝里。
  return { row: place.row, top: place.inGap ? "-2px" : `${Math.round(place.fraction * 100)}%` };
});
</script>

<style scoped lang="scss">
.cd {
  --cd-ink: var(--ss-ink);
  --cd-meta: var(--ss-meta);
  --cd-rule: var(--ss-cell-border);
  --cd-theme: var(--ss-theme-fill);
  --cd-on-theme: var(--ss-theme-on-fill);
  --cd-row: 50px;
  --cd-axis: 46px;
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 2px 0 8px;
  color: var(--cd-ink);
  font-family: var(--ss-font);
  font-variant-numeric: tabular-nums;
}
.cd-classic {
  --cd-ink: var(--schedule-text);
  --cd-meta: var(--schedule-text-secondary);
  --cd-rule: var(--schedule-cell-border);
  --cd-theme: var(--schedule-accent);
  --cd-on-theme: var(--schedule-accent-contrast);
  font-family: inherit;
}
.cd-head,
.cd-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--cd-axis) minmax(0, 1fr);
  column-gap: 6px;
}
.cd-head {
  height: 30px;
  align-items: center;
  color: var(--cd-meta);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}
.cd-who {
  justify-self: center;
  max-width: 100%;
  overflow: hidden;
  padding: 2px 12px;
  border: 1px solid var(--cd-rule);
  border-radius: 999px;
  color: var(--cd-ink);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cd-body {
  position: relative;
  row-gap: 3px;
}
.cd-cell {
  min-width: 0;
  padding: 0;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--cd-rule) 70%, transparent);
  background: transparent;
  font: inherit;
}
button.cd-cell:not(:disabled) {
  cursor: pointer;
}
.cd-axis {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--cd-ink) 5%, transparent);
}
.cd-axis b {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.1;
}
.cd-axis span {
  color: var(--cd-meta);
  font-size: 10px;
  line-height: 1.1;
}
// 现在正在上的那一节：时间轴上这一格换成主题色。
.cd-axis.now {
  background: var(--cd-theme);
  color: var(--cd-on-theme);
}
.cd-axis.now span {
  color: inherit;
  opacity: 0.85;
}
.cd-tile {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  min-width: 0;
  overflow: hidden;
  padding: 5px 9px;
  border: 1px solid var(--tile-border);
  border-radius: 10px;
  background: var(--tile-fill);
  color: var(--tile-accent);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
}
.cd-tile strong {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.cd-tile.short strong {
  -webkit-line-clamp: 1;
}
.cd-tile span,
.cd-tile em {
  overflow: hidden;
  font-size: 11px;
  font-style: normal;
  line-height: 1.25;
  opacity: 0.86;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cd-tile.narrow {
  padding: 4px 5px;
}
.cd-tile.narrow strong {
  font-size: 12px;
}
// 一起上的课右上角一颗小爱心。
.cd-tile.shared::after {
  content: "";
  position: absolute;
  top: 5px;
  right: 6px;
  width: 11px;
  height: 11px;
  background: var(--couple-accent, #e2568a);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.9 3 6.2 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.2 21 8.9c0 3.3-3 6-7.7 10.2L12 20.3z'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.9 3 6.2 5.1 4 7.8 4c1.5 0 3 .7 4.2 1.9C13.2 4.7 14.7 4 16.2 4 18.9 4 21 6.2 21 8.9c0 3.3-3 6-7.7 10.2L12 20.3z'/%3E%3C/svg%3E") center / contain no-repeat;
}
.cd-tile.shared strong {
  padding-right: 14px;
}
.cd-now {
  grid-column: 1 / -1;
  position: relative;
  z-index: 2;
  pointer-events: none;
}
.cd-now i {
  position: absolute;
  left: 0;
  right: 0;
  height: 1.5px;
  background: var(--cd-theme);
  opacity: 0.8;
}

// 表格、素笺、站牌是直角的。
.cd-table .cd-tile,
.cd-paper .cd-tile,
.cd-board .cd-tile,
.cd-table .cd-axis,
.cd-paper .cd-axis,
.cd-board .cd-axis {
  border-radius: 2px;
}
.cd-board .cd-axis b,
.cd-board .cd-axis span {
  font-family: var(--ss-font);
}

@media (max-width: 420px) {
  .cd {
    --cd-axis: 40px;
  }
  .cd-tile {
    padding: 4px 7px;
  }
  .cd-tile strong {
    font-size: 13px;
  }
}
</style>
