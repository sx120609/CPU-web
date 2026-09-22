import type { SchedulePeriod } from './scheduleTermConfig';

export const PROTOCOL_VERSION = 2;
export const SCHEDULE_ID = 'main-campus';
export const SCHOOL_TIMEZONE = 'Asia/Shanghai';
export type Segment = { period: number; startAt: number; endAt: number };
export type Occurrence = {
  occurrenceId: string; supersedes: string[]; dateKey: string;
  startPeriod: number; endPeriod: number; segments: Segment[];
  start: number; end: number; plannedStart: number; expiresAt: number;
};
export function normalizeLead(value: unknown): 15 | 30 | 60 {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 60) return 15;
  return value <= 15 ? 15 : value <= 30 ? 30 : 60;
}
export function resolveTimeline(segments: Segment[], mode: 'whole' | 'segmented', now: number) {
  const first = segments[0], last = segments.at(-1);
  if (!first || !last) throw new Error('课程缺少节次');
  if (now >= last.endAt) return { phase: 'finished', index: segments.length - 1, start: last.endAt, target: last.endAt, finalEnd: last.endAt };
  if (now < first.startAt) return { phase: 'upcoming', index: 0, start: now, target: first.startAt, finalEnd: last.endAt };
  const index = segments.findIndex(s => now < s.endAt);
  const segment = segments[index];
  return { phase: mode === 'segmented' && now < segment.startAt ? 'break' : 'inClass', index,
    start: mode === 'whole' ? first.startAt : now < segment.startAt ? segments[index - 1].endAt : segment.startAt,
    target: mode === 'whole' ? last.endAt : now < segment.startAt ? segment.startAt : segment.endAt, finalEnd: last.endAt };
}
export function dateSeconds(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期无效');
  const seconds = Date.parse(`${value}T00:00:00+08:00`) / 1000;
  if (!Number.isFinite(seconds) || new Date((seconds + 28800) * 1000).toISOString().slice(0, 10) !== value) throw new Error('日期无效');
  return seconds;
}
const clock = (s: string) => Number(s.slice(0, 2)) * 3600 + Number(s.slice(3)) * 60;
const identity = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s);
/** Validate the entire snapshot before any writes. Times are always school times. */
export function parseCoursePlan(input: any, periods: SchedulePeriod[], now = Date.now() / 1000): Occurrence[] {
  if (input?.protocolVersion !== 2 || ![15, 30, 60].includes(input.leadMinutes)) throw new Error('需要协议 v2 和 15/30/60 分钟提前量');
  if (!Number.isSafeInteger(input.planRevision) || input.planRevision < 1) throw new Error('计划版本无效');
  const coverageStart = dateSeconds(input.coverageStart), coverageEnd = dateSeconds(input.coverageEndExclusive);
  if (coverageStart >= coverageEnd || coverageEnd > now + 371 * 86400 || coverageEnd - coverageStart > 550 * 86400) throw new Error('计划覆盖范围无效');
  if (!periods.length || !Array.isArray(input.items) || !Array.isArray(input.busyIntervals) || input.items.length + input.busyIntervals.length > 10000) throw new Error('计划最多包含 10000 个课程及占用区间');
  const seen = new Set<string>();
  const courses: Occurrence[] = input.items.map((item: any) => {
    if (!identity(item?.occurrenceId) || seen.has(item.occurrenceId)) throw new Error('课程身份无效或重复');
    seen.add(item.occurrenceId);
    if (!Array.isArray(item.supersedes) || item.supersedes.length > 100 || item.supersedes.some((id: unknown) => !identity(id) || id === item.occurrenceId)) throw new Error('替代关系无效');
    const midnight = dateSeconds(item.dateKey);
    if (midnight < coverageStart || midnight >= coverageEnd || midnight > now + 370 * 86400) throw new Error('课程不在覆盖范围内');
    if (!Number.isInteger(item.startPeriod) || !Number.isInteger(item.endPeriod) || item.startPeriod > item.endPeriod) throw new Error('课程节次无效');
    const segments = periods.filter(p => p.id >= item.startPeriod && p.id <= item.endPeriod)
      .map(p => ({ period: p.id, startAt: midnight + clock(p.start), endAt: midnight + clock(p.end) }));
    if (segments.length !== item.endPeriod - item.startPeriod + 1) throw new Error('课程节次不存在');
    return { occurrenceId: item.occurrenceId, supersedes: [...new Set<string>(item.supersedes)], dateKey: item.dateKey,
      startPeriod: item.startPeriod, endPeriod: item.endPeriod, segments,
      start: segments[0].startAt, end: segments.at(-1)!.endAt, plannedStart: 0, expiresAt: 0 };
  });
  const busy = input.busyIntervals.map((b: any) => {
    if (!Number.isFinite(b.startAt) || !Number.isFinite(b.endAt) || b.startAt >= b.endAt || b.startAt < coverageStart || b.endAt > coverageEnd) throw new Error('占用区间无效');
    return { start: b.startAt, end: b.endAt };
  });
  const sorted = [...courses, ...busy].sort((a, b) => a.start - b.start || a.end - b.end);
  let previousEnd = -Infinity;
  for (const row of sorted) {
    if (row.start < previousEnd) throw new Error('存在未解决的课程时间冲突');
    if ('occurrenceId' in row) {
      row.plannedStart = Math.max(row.start - input.leadMinutes * 60, previousEnd);
      row.expiresAt = Math.min(row.end, row.plannedStart < now ? now + 300 : Math.max(row.start + 60, row.plannedStart + 300));
    }
    previousEnd = Math.max(previousEnd, row.end);
  }
  return courses.sort((a, b) => a.plannedStart - b.plannedStart || a.start - b.start || a.occurrenceId.localeCompare(b.occurrenceId));
}
