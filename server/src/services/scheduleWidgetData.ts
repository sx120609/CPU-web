import { scheduleData, scheduleDate, type ScheduleDataService } from "./scheduleData";
import { buildScheduleWidgetPayload, resolveScheduleWidgetPreviewWeeks } from "./scheduleWidget";
import { Errors } from "../utils/response";

export async function loadScheduleWidgetData(
  token: string,
  requestedWeek: string,
  prepareSchedule: (semester: string) => Promise<(schedule: any) => any>,
  options: { service?: ScheduleDataService; now?: Date } = {},
) {
  const service = options.service ?? scheduleData;
  const now = options.now ?? new Date();
  const current = await service.readSchedule(token, { week: requestedWeek });
  if (!current.calendar) {
    throw Errors.badGateway("学校暂未返回可用的课表日期，请稍后重试");
  }
  if (requestedWeek && !current.calendar.weeks.some((item) => Number(item.week) === Number(requestedWeek))) {
    throw Errors.badGateway("校历中缺少所选周次的日期");
  }
  if (!requestedWeek) {
    const today = scheduleDate(now);
    const dates = new Set(current.calendar.weeks.flatMap((item) => item.days));
    for (let offset = 0; offset <= 7; offset++) {
      const date = new Date(`${today}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      const target = date.toISOString().slice(0, 10);
      if (target >= current.calendar.semesterStart && target <= current.calendar.semesterEnd && !dates.has(target)) {
        throw Errors.badGateway("校历缺少近期日期，暂时无法确认课程安排");
      }
    }
  }
  const semester = current.parsed.currentSemester;
  const previewWeeks = resolveScheduleWidgetPreviewWeeks(current.calendar, requestedWeek, now);
  const [applyEdits, previews] = await Promise.all([
    prepareSchedule(semester),
    Promise.all(previewWeeks.map(async (week) => ({
      week,
      data: await service.readSchedule(token, { semester, week: String(week) }),
    }))),
  ]);
  const snapshots = [current, ...previews.map((item) => item.data)];
  const syncedAt = snapshots.map((item) => item.syncedAt).sort()[0];
  return {
    ...buildScheduleWidgetPayload(
      applyEdits(current.parsed), current.calendar, requestedWeek, now,
      Object.fromEntries(previews.map(({ week, data }) => [week, applyEdits(data.parsed)])),
    ),
    stale: snapshots.some((item) => item.stale),
    cachedAt: syncedAt,
    syncedAt,
    source: current.parsed.source,
    requestedWeek: String(requestedWeek || "").trim(),
  };
}
