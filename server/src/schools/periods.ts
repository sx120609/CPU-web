import type { SchoolPeriod } from "./registry";

export type CalendarPeriod = { id: number; name: string; start: string; end: string };

const MAX_PERIODS = 20;
const TIME = /^\d{1,2}:\d{2}$/;

/**
 * 一所学校完整的作息表：学校档案里的默认作息（schools/<id> 的 defaultPeriods）打底，
 * 教务给的节次时间盖上去；教务从第 1 节起连续给到默认作息之后的节次，接在后面。
 * 教务只给了一部分（药大有的学期只给前十一节）时，缺的节次用本校默认补，不会混进别的学校的时间。
 * 课表、小组件、原生壳都按这一份画节次。
 */
export function completeSchoolPeriods(
  supplied: ReadonlyArray<Partial<CalendarPeriod>> | null | undefined,
  defaults: ReadonlyArray<SchoolPeriod>,
): CalendarPeriod[] {
  const byId = new Map<number, CalendarPeriod>();
  for (const item of supplied ?? []) {
    const id = Number(item?.id);
    const start = String(item?.start || "");
    const end = String(item?.end || "");
    if (Number.isInteger(id) && id >= 1 && id <= MAX_PERIODS && TIME.test(start) && TIME.test(end)) {
      byId.set(id, { id, name: String(item?.name || `第${id}节`), start, end });
    }
  }
  const base: CalendarPeriod[] = defaults
    .filter((item) => item.no >= 1 && item.no <= MAX_PERIODS)
    .map((item) => byId.get(item.no) ?? { id: item.no, name: item.name, start: item.start, end: item.end });
  if (base.some((item, index) => item.id !== index + 1)) return base;
  for (let id = base.length + 1; byId.has(id); id += 1) base.push(byId.get(id)!);
  return base;
}
