import crypto from 'node:crypto';
import { prisma } from '../prisma';
import { getSchedulePeriods, normalizeSchedulePeriods, type SchedulePeriod } from './scheduleTermConfig';
import { SCHEDULE_ID, SCHOOL_TIMEZONE } from './liveActivityTimeline';
export function timingVersion(periods: SchedulePeriod[]) {
  return crypto.createHash('sha256').update(JSON.stringify([SCHEDULE_ID, SCHOOL_TIMEZONE, periods.map(p => [p.id, p.start, p.end])])).digest('hex').slice(0, 24);
}
export async function currentTiming() {
  const periods = normalizeSchedulePeriods(await getSchedulePeriods());
  const id = timingVersion(periods);
  const row = await prisma.liveActivityScheduleVersion.upsert({ where: { id },
    create: { id, scheduleId: SCHEDULE_ID, timezone: SCHOOL_TIMEZONE, periods: JSON.stringify(periods) }, update: {} });
  return { ...row, periods };
}
export async function retainTiming(id: string, until: Date) {
  await prisma.liveActivityScheduleVersion.updateMany({ where: { id, broadcastUntil: { lt: until } }, data: { broadcastUntil: until } });
}
export const endChannelKey = (environment: string, version: string, period: number) => `${environment}:${SCHEDULE_ID}:${version}:end-period-${period}`;
