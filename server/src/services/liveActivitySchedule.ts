import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { getSchedulePeriods, normalizeSchedulePeriods, type SchedulePeriod } from './scheduleTermConfig';
import { SCHEDULE_ID, SCHOOL_TIMEZONE } from './liveActivityTimeline';
import { DEFAULT_SCHOOL_ID, getSchool, resolveSchoolId } from '../schools/registry';
import { completeSchoolPeriods } from '../schools/periods';
export function timingVersion(periods: SchedulePeriod[]) {
  return crypto.createHash('sha256').update(JSON.stringify([SCHEDULE_ID, SCHOOL_TIMEZONE, periods.map(p => [p.id, p.start, p.end])])).digest('hex').slice(0, 24);
}
async function heldTiming(db: Prisma.TransactionClient, periods: SchedulePeriod[]) {
  const id = timingVersion(periods);
  const row = await db.liveActivityScheduleVersion.upsert({ where: { id },
    create: { id, scheduleId: SCHEDULE_ID, timezone: SCHOOL_TIMEZONE, periods: JSON.stringify(periods) }, update: {} });
  return { ...row, periods };
}
/** The default school's bells. Its activities, channels and plans follow this one table. */
export async function currentTiming(db: Prisma.TransactionClient = prisma) {
  return heldTiming(db, normalizeSchedulePeriods(await getSchedulePeriods(db)));
}
/** Whether a user's activities follow their own school's table rather than the default school's. */
export const hasOwnBells = (schoolId: string | null | undefined) => resolveSchoolId(schoolId) !== DEFAULT_SCHOOL_ID;
/**
 * Another school's bells: the table its admin saved over the school's built-in one, as the timetable
 * itself is drawn. Periods are numbered from 1 without gaps, since a class names its periods by number.
 */
export async function schoolPeriods(schoolId: string, db: Prisma.TransactionClient = prisma) {
  const table = completeSchoolPeriods(await getSchedulePeriods(db, schoolId), getSchool(schoolId).defaultPeriods);
  if (!table.length || table.some((period, index) => period.id !== index + 1)) throw new Error('学校作息未配置');
  return normalizeSchedulePeriods(table);
}
/**
 * The table an app says its timetable uses, as `0820-0900_0910-0950…`, period 1 first. A campus can
 * ring differently from the school's built-in table (教务 gives each student theirs), and only the
 * app holds that one. Anything malformed is no table at all.
 */
export function declaredPeriods(raw: unknown): SchedulePeriod[] | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{4}(?:_\d{4}-\d{4}){0,19}$/.test(raw)) return null;
  const clock = (value: string) => `${value.slice(0, 2)}:${value.slice(2)}`;
  try {
    return normalizeSchedulePeriods(raw.split('_').map((pair, index) => (
      { id: index + 1, name: `第${index + 1}节`, start: clock(pair.slice(0, 4)), end: clock(pair.slice(5)) })));
  } catch { return null; }
}
// Every table held costs two channels a period in each environment and a day of events. The built-in
// tables are few; this bounds what declared ones can add.
const OWN_TIMING_LIMIT = 48;
/** A table already held stays; a new one is taken only while there is room. */
export async function admitsTiming(id: string, db: Prisma.TransactionClient = prisma) {
  const row = await db.liveActivityScheduleVersion.findUnique({ where: { id }, select: { broadcastUntil: true } });
  if (row && row.broadcastUntil.getTime() >= Date.now()) return true;
  return await db.liveActivityScheduleVersion.count({ where: { broadcastUntil: { gte: new Date() } } }) < OWN_TIMING_LIMIT;
}
/**
 * The timing a user's activities follow. The default school keeps its one table. Any other school
 * gets its own: the table the app declares when there is room for it, else the school's.
 */
export async function timingFor(schoolId: string | null | undefined, declared: SchedulePeriod[] | null = null, db: Prisma.TransactionClient = prisma) {
  if (!hasOwnBells(schoolId)) return currentTiming(db);
  if (declared && await admitsTiming(timingVersion(declared), db)) return heldTiming(db, declared);
  return heldTiming(db, await schoolPeriods(resolveSchoolId(schoolId), db));
}
/** A timing by its version, whether or not it is still held. */
export async function timingByVersion(id: unknown, db: Prisma.TransactionClient = prisma) {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) return null;
  const row = await db.liveActivityScheduleVersion.findUnique({ where: { id } });
  return row ? { ...row, periods: JSON.parse(row.periods) as SchedulePeriod[] } : null;
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
