import { NativeCourseBlock, NativeScheduleCourse, NativeSchedulePeriod } from './NativeScheduleStore';

// Somebody else's timetable drawn over the user's (the couple timetable, or a shared one laid on
// top, iOS ScheduleOverlayTiming) may come from another school with other bells: NJMU's third period
// is not CPU's. Their courses are placed on the user's periods by clock time and keep their real
// clock times for every label. Plain values, so the rules can be checked without a device.

export interface OverlayPeriod {
  number: number;
  start: number;
  end: number;
}

/** Minutes since midnight of "HH:mm"; -1 when it is not a time of day. */
export function overlayMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec((value ?? '').trim());
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : -1;
}

export function overlayClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function overlayPeriods(periods: NativeSchedulePeriod[]): OverlayPeriod[] {
  const result: OverlayPeriod[] = [];
  periods.forEach((period: NativeSchedulePeriod) => {
    const start = overlayMinutes(period.startTime);
    const end = overlayMinutes(period.endTime);
    if (start >= 0 && end > start) result.push({ number: period.number, start, end });
  });
  return result.sort((left: OverlayPeriod, right: OverlayPeriod) => left.start - right.start);
}

/**
 * The user's periods a class from `start` to `end` covers, [first, last]: from the first period still
 * running at its start to the last one begun before its end. A class wholly inside a break takes the
 * nearest period. Empty when the user has no periods.
 */
export function overlayPlace(start: number, end: number, mine: OverlayPeriod[]): number[] {
  if (!mine.length) return [];
  const first = mine.find((period: OverlayPeriod) => period.end > start);
  let lastIndex = -1;
  for (let index = 0; index < mine.length; index += 1) {
    if (mine[index].start < end) lastIndex = index;
  }
  if (first && lastIndex >= 0 && first.number <= mine[lastIndex].number) return [first.number, mine[lastIndex].number];
  const middle = (start + end) / 2;
  let nearest = mine[0];
  mine.forEach((period: OverlayPeriod) => {
    if (Math.abs((period.start + period.end) / 2 - middle) < Math.abs((nearest.start + nearest.end) / 2 - middle)) nearest = period;
  });
  return [nearest.number, nearest.number];
}

/** Two bell schedules agree on every period both have: period numbers can be used as they are. */
export function overlaySameBells(theirs: OverlayPeriod[], mine: OverlayPeriod[]): boolean {
  return theirs.every((period: OverlayPeriod) => mine.some((own: OverlayPeriod) =>
    own.number === period.number && own.start === period.start && own.end === period.end));
}

/** `block`, read with their bells, moved onto the user's; it keeps its real clock times. */
export function overlayRemap(block: NativeCourseBlock, theirs: OverlayPeriod[], mine: OverlayPeriod[]): NativeCourseBlock {
  if (!mine.length || overlaySameBells(theirs, mine)) return block;
  const course = block.course;
  const own = overlayMinutes(course.customStartTime ?? '');
  const ownEnd = overlayMinutes(course.customEndTime ?? '');
  const start = own >= 0 ? own : (theirs.find((period: OverlayPeriod) => period.number === block.startSlot)?.start ?? -1);
  const end = ownEnd >= 0 ? ownEnd : (theirs.find((period: OverlayPeriod) => period.number === block.endSlot)?.end ?? -1);
  if (start < 0 || end <= start) return block;
  const placed = overlayPlace(start, end, mine);
  if (!placed.length) return block;
  const moved: NativeScheduleCourse = JSON.parse(JSON.stringify(course)) as NativeScheduleCourse;
  moved.customStartTime = overlayClock(start);
  moved.customEndTime = overlayClock(end);
  moved.startSlot = placed[0];
  moved.endSlot = placed[1];
  return { day: block.day, bigSlot: Math.ceil(placed[0] / 2), startSlot: placed[0], endSlot: placed[1], course: moved,
    cancelled: block.cancelled };
}

/** One card of a half-width strip column: overlapping courses become one card with 「+N」. */
export interface OverlayStripCard {
  id: string;
  startSlot: number;
  endSlot: number;
  // The first course of the cluster, drawn and opened; the rest are counted.
  block: NativeCourseBlock;
  more: number;
}

export function overlayStripCards(blocks: NativeCourseBlock[], prefix: string): OverlayStripCard[] {
  const sorted = blocks.slice().sort((left: NativeCourseBlock, right: NativeCourseBlock) =>
    left.startSlot - right.startSlot || right.endSlot - left.endSlot);
  const cards: OverlayStripCard[] = [];
  sorted.forEach((block: NativeCourseBlock) => {
    const last = cards.length ? cards[cards.length - 1] : undefined;
    if (last && block.startSlot <= last.endSlot) {
      last.endSlot = Math.max(last.endSlot, block.endSlot);
      last.more += 1;
      // A course that meets beats a cancelled one as the card's face.
      if (last.block.cancelled && !block.cancelled) last.block = block;
      return;
    }
    cards.push({ id: `${prefix}-${block.startSlot}-${block.endSlot}-${block.course.name}`, startSlot: block.startSlot,
      endSlot: block.endSlot, block, more: 0 });
  });
  return cards;
}

/** A phone held upright shows three days, a wider window up to seven. */
export function overlayStripDayCount(width: number, axis: number): number {
  return Math.min(7, Math.max(3, Math.floor((width - axis) / 96)));
}

/** The leftmost day for a selected date: that date, or the first after it, kept to the last full screen. */
export function overlayStripLeading(selection: string, dates: string[], count: number): number {
  if (!dates.length) return 0;
  let index = dates.findIndex((date: string) => date >= selection);
  if (index < 0) index = dates.length - 1;
  return Math.max(0, Math.min(index, dates.length - count));
}

// ---- 一起看的周视图：并排 or 合并 ----

/** `split` (并排, the two-column strip) unless the stored value says `merged` (合并, one week grid). */
export function coupleWeekLayout(raw: string): string {
  return raw === 'merged' ? 'merged' : 'split';
}

/**
 * Whether the week view is the two-column strip. With 合并 the week goes back to the one grid both
 * people's courses were drawn in before the strip.
 */
export function overlayStripWanted(viewMode: string, readOnly: boolean, showing: boolean, hasWeeks: boolean,
  layout: string): boolean {
  return viewMode === 'week' && !readOnly && showing && hasWeeks && coupleWeekLayout(layout) === 'split';
}

/** The one-time note over the strip: until it was closed, the layout was changed, or the guide told the same. */
export function overlayStripHintDue(stripShown: boolean, hintSeen: boolean): boolean {
  return stripShown && !hintSeen;
}
