import { NativeCourseBlock, NativeScheduleCourse } from './NativeScheduleStore';

// Which course shows when several sit in the same periods (NativeSchedulePriority on iOS).
// A priority belongs to a course, not to one of its meetings, so it is keyed by the course name
// and saved with the schedule edits (`priority` in the edit payload; server/src/shared/schedulePriority.ts).

/** One visible piece of a course on one day. */
export interface PlacedCourseBlock {
  // Stable within a day: the block's position, plus the piece when a course in front covers part of it.
  id: string;
  day: number;
  bigSlot: number;
  // The periods this piece is drawn over.
  startSlot: number;
  endSlot: number;
  lane: number;
  // Lane count of the overlap cluster the piece belongs to; courses that overlap, directly or
  // through a chain, share the column width.
  lanes: number;
  course: NativeScheduleCourse;
  // The whole course, for the quick look and the editor.
  whole: NativeCourseBlock;
  // A course that does not run this week, drawn faded in a period this week leaves free.
  offWeek?: boolean;
  // Set while the couple timetable is drawn: whose course this is (me | ta | both).
  owner?: string;
}

/** The saved key for a course name: trimmed, inner whitespace collapsed. */
export function schedulePriorityKey(name: string): string {
  return (name ?? '').trim().replace(/\s+/g, ' ');
}

/** 0 means the course has no priority. */
export function schedulePriorityValue(name: string, priorities: Record<string, number>): number {
  const value = Number(priorities[schedulePriorityKey(name)] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The value that puts a course in front of every other one. */
export function schedulePriorityTop(priorities: Record<string, number>): number {
  let top = 0;
  Object.keys(priorities).forEach((key: string) => { top = Math.max(top, Number(priorities[key]) || 0); });
  return top + 1;
}

/**
 * Lays out one day's blocks, already filtered to the week on screen.
 *
 * A course with a strictly higher priority covers the periods it shares with a lower one. The
 * lower course keeps the runs of periods left uncovered and disappears only when nothing is left.
 * Courses of equal priority, which includes every course when none is set, sit side by side in
 * lanes. Nothing is removed from the timetable itself: `whole` is always the original block.
 */
export function placeScheduleBlocks(blocks: NativeCourseBlock[], priorities: Record<string, number>): PlacedCourseBlock[] {
  const pieces: PlacedCourseBlock[] = [];
  blocks.forEach((block: NativeCourseBlock, index: number) => {
    if (block.startSlot > block.endSlot) return;
    const own = schedulePriorityValue(block.course.name, priorities);
    const covering = blocks.filter((other: NativeCourseBlock) => {
      return schedulePriorityValue(other.course.name, priorities) > own
        && other.startSlot <= block.endSlot && block.startSlot <= other.endSlot;
    });
    let start = -1;
    const close = (end: number): void => {
      if (start < 0) return;
      const whole = start === block.startSlot && end === block.endSlot;
      pieces.push({ id: whole ? `${block.day}-${index}` : `${block.day}-${index}-segment-${start}-${end}`,
        day: block.day, bigSlot: block.bigSlot, startSlot: start, endSlot: end, lane: 0, lanes: 1,
        course: block.course, whole: block });
      start = -1;
    };
    for (let slot = block.startSlot; slot <= block.endSlot; slot += 1) {
      if (covering.some((other: NativeCourseBlock) => other.startSlot <= slot && slot <= other.endSlot)) {
        close(slot - 1);
      } else if (start < 0) {
        start = slot;
      }
    }
    close(block.endSlot);
  });
  pieces.sort((left: PlacedCourseBlock, right: PlacedCourseBlock) => {
    return left.startSlot - right.startSlot || left.endSlot - right.endSlot || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
  const laneEnds: number[] = [];
  pieces.forEach((piece: PlacedCourseBlock) => {
    let lane = laneEnds.findIndex((end: number) => end < piece.startSlot);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(piece.endSlot); } else { laneEnds[lane] = piece.endSlot; }
    piece.lane = lane;
  });
  // Lane counts per overlap cluster: everything else stays full width.
  let cluster: PlacedCourseBlock[] = [];
  let clusterEnd = -1;
  const flush = (): void => {
    let lanes = 1;
    cluster.forEach((piece: PlacedCourseBlock) => { lanes = Math.max(lanes, piece.lane + 1); });
    cluster.forEach((piece: PlacedCourseBlock) => { piece.lanes = lanes; });
    cluster = [];
  };
  pieces.forEach((piece: PlacedCourseBlock) => {
    if (cluster.length && piece.startSlot > clusterEnd) flush();
    cluster.push(piece);
    clusterEnd = cluster.length === 1 ? piece.endSlot : Math.max(clusterEnd, piece.endSlot);
  });
  flush();
  return pieces;
}

/** Names of the other courses a block overlaps on its day. */
export function overlappingCourseNames(block: NativeCourseBlock, blocks: NativeCourseBlock[]): string[] {
  const names: string[] = [];
  blocks.forEach((other: NativeCourseBlock) => {
    if (other === block || other.course.name === block.course.name) return;
    if (other.startSlot <= block.endSlot && block.startSlot <= other.endSlot && !names.includes(other.course.name)) {
      names.push(other.course.name);
    }
  });
  return names;
}
