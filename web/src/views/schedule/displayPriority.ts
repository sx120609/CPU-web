// 重叠课程的显示优先级：同几节里有多门课时哪一门显示在前面。
// 优先级跟着课程走，不跟着某一节走，所以按课程名保存在课表编辑的 `priority` 里
// （服务端见 server/src/shared/schedulePriority.ts，iOS 见 NativeSchedulePriority）。
import {
  normalizeSchedulePriority,
  schedulePriorityKey,
  type SchedulePriorityMap,
} from "../../../../server/src/shared/schedulePriority";
import type { WeekCourseBlock } from "./types";

export { normalizeSchedulePriority, schedulePriorityKey };
export type { SchedulePriorityMap };

/** 0 表示这门课没有指定优先级。 */
export function schedulePriorityValue(name: string, priorities: SchedulePriorityMap) {
  return Math.max(0, Number(priorities[schedulePriorityKey(name)]) || 0);
}

/** 排到所有课前面要用的值。 */
export function topSchedulePriority(priorities: SchedulePriorityMap) {
  return Math.max(0, ...Object.values(priorities).map((value) => Number(value) || 0)) + 1;
}

/**
 * 保存编辑器里「优先显示这门课」之后的优先级表。关掉就删掉这门课的键；打开时
 * 如果它还不是唯一最高的，就排到所有已有优先级的前面。
 */
export function withCoursePreferred(priorities: SchedulePriorityMap, name: string, preferred: boolean): SchedulePriorityMap {
  const key = schedulePriorityKey(name);
  const next: SchedulePriorityMap = { ...priorities };
  if (!key) return next;
  if (!preferred) {
    delete next[key];
    return next;
  }
  const own = Number(next[key]) || 0;
  const tied = Object.entries(next).some(([other, value]) => other !== key && Number(value) >= own);
  if (own <= 0 || tied) next[key] = topSchedulePriority(next);
  return next;
}

/** 一门课在某一天里看得见的一段。 */
export interface PlacedCourseBlock {
  /** 整块课程自己的标识；被前面的课盖掉一部分时，是这一段的标识。 */
  id: string;
  /** 始终是完整的原课程，速览和编辑用它的节次。 */
  block: WeekCourseBlock;
  startSlot: number;
  endSlot: number;
  lane: number;
  /** 这一段所在的重叠簇一共分成几道。 */
  lanes: number;
}

export function courseBlockId(block: WeekCourseBlock) {
  return [
    block.day,
    block.startSlot,
    block.endSlot,
    block.index,
    block.course.customId ?? "",
    block.course.name,
  ].join("-");
}

/**
 * 排好一天里的课程块（已经按当前周筛过）。
 *
 * 优先级严格更高的课盖住它和低优先级课共用的节次；低优先级的课留下没被盖住的
 * 那几段，一节都不剩时才不画。优先级相同的课（都没设时就是全部）和以前一样并排
 * 分道。课表本身什么都不删：`block` 永远是完整的原课程。
 */
export function placeCourseBlocks(blocks: WeekCourseBlock[], priorities: SchedulePriorityMap = {}): PlacedCourseBlock[] {
  const priorityOf = (block: WeekCourseBlock) => schedulePriorityValue(block.course.name, priorities);
  const pieces: PlacedCourseBlock[] = [];
  for (const block of blocks) {
    if (block.startSlot > block.endSlot) continue;
    const own = priorityOf(block);
    const covering = blocks.filter((other) => (
      other.day === block.day
      && priorityOf(other) > own
      && other.startSlot <= block.endSlot
      && block.startSlot <= other.endSlot
    ));
    const id = courseBlockId(block);
    let start: number | null = null;
    const close = (end: number) => {
      if (start === null) return;
      const whole = start === block.startSlot && end === block.endSlot;
      pieces.push({
        id: whole ? id : `${id}-segment-${start}-${end}`,
        block,
        startSlot: start,
        endSlot: end,
        lane: 0,
        lanes: 1,
      });
      start = null;
    };
    for (let slot = block.startSlot; slot <= block.endSlot; slot += 1) {
      if (covering.some((other) => other.startSlot <= slot && slot <= other.endSlot)) close(slot - 1);
      else if (start === null) start = slot;
    }
    close(block.endSlot);
  }

  const placed: PlacedCourseBlock[] = [];
  const days = [...new Set(pieces.map((piece) => piece.block.day))].sort((a, b) => a - b);
  for (const day of days) {
    const dayPieces = pieces
      .filter((piece) => piece.block.day === day)
      .sort((a, b) => a.startSlot - b.startSlot || a.endSlot - b.endSlot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const laneEnds: number[] = [];
    for (const piece of dayPieces) {
      let lane = laneEnds.findIndex((end) => end < piece.startSlot);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = piece.endSlot;
      piece.lane = lane;
    }
    // 直接或经由一串课互相重叠的课分享宽度；其余的课保持整列宽。
    let cluster: PlacedCourseBlock[] = [];
    let clusterEnd = Number.NEGATIVE_INFINITY;
    const flush = () => {
      const lanes = Math.max(1, ...cluster.map((piece) => piece.lane + 1));
      for (const piece of cluster) piece.lanes = lanes;
      cluster = [];
    };
    for (const piece of dayPieces) {
      if (cluster.length && piece.startSlot > clusterEnd) flush();
      cluster.push(piece);
      clusterEnd = cluster.length === 1 ? piece.endSlot : Math.max(clusterEnd, piece.endSlot);
    }
    if (cluster.length) flush();
    placed.push(...dayPieces);
  }
  return placed;
}
