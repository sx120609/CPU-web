import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { getSchedulePeriods, normalizeSchedulePeriods, type SchedulePeriod } from './scheduleTermConfig';
import { SCHEDULE_ID, SCHOOL_TIMEZONE } from './liveActivityTimeline';
export function timingVersion(periods: SchedulePeriod[]) {
  return crypto.createHash('sha256').update(JSON.stringify([SCHEDULE_ID, SCHOOL_TIMEZONE, periods.map(p => [p.id, p.start, p.end])])).digest('hex').slice(0, 24);
}
export async function currentTiming(db: Prisma.TransactionClient = prisma) {
  const periods = normalizeSchedulePeriods(await getSchedulePeriods(db));
  const id = timingVersion(periods);
  const row = await db.liveActivityScheduleVersion.upsert({ where: { id },
    create: { id, scheduleId: SCHEDULE_ID, timezone: SCHOOL_TIMEZONE, periods: JSON.stringify(periods) }, update: {} });
  return { ...row, periods };
}
export async function retainTiming(id: string, until: Date, db: Prisma.TransactionClient = prisma) {
  await db.liveActivityScheduleVersion.updateMany({ where: { id, broadcastUntil: { lt: until } }, data: { broadcastUntil: until } });
}
export const endChannelKey = (environment: string, version: string, period: number) => `${environment}:${SCHEDULE_ID}:${version}:end-period-${period}`;
/**
 * 日程的实时活动在任意钟点结束，没有哪一节的频道可用：一天按这个步长切成若干个钟点，每个钟点一个频道，
 * 到点发一条 end。结束时间往后取整到最近的钟点。频道与作息版本无关，建好后一直用。
 * `LIVE_ACTIVITY_CLOCK_STEP_MINUTES=0` 关掉（不建频道、不广播，客户端不再安排日程活动）。
 */
export function clockStepMinutes() {
  const raw = process.env.LIVE_ACTIVITY_CLOCK_STEP_MINUTES;
  if (raw === undefined || raw === '') return 5;
  const step = Number(raw);
  return [5, 10, 15, 30, 60].includes(step) ? step : 0;
}
/** The minutes of the day that have a clock channel, from 00:00. */
export function clockMarks(step = clockStepMinutes()) {
  return step > 0 ? Array.from({ length: 1440 / step }, (_, index) => index * step) : [];
}
export const clockLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}${String(minute % 60).padStart(2, '0')}`;
export const clockChannelKey = (environment: string, minute: number) => `${environment}:${SCHEDULE_ID}:clock-${clockLabel(minute)}`;
/** The mark that ends something due at `seconds`: the same minute if it is one, else the next. Midnight wraps to 00:00. */
export function clockMark(seconds: number, step = clockStepMinutes()) {
  if (step <= 0) return undefined;
  const minute = Math.ceil(((seconds + 8 * 3600) % 86400) / 60);
  return (Math.ceil(minute / step) * step) % 1440;
}
/** 「上课时收起」的活动订这个频道：它只在这一节上课那一刻发一条 end。 */
export const startChannelKey = (environment: string, version: string, period: number) => `${environment}:${SCHEDULE_ID}:${version}:start-period-${period}`;
