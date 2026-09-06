import * as cheerio from "cheerio";
import { parseCalendar, parseSchedule, type CalendarResult } from "./jwxtParser";
import { Errors } from "../utils/response";

type ReadHtml = (path: string) => Promise<string>;

function addDays(date: string, count: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function isAuthorizationError(error: unknown) {
  const value = error as { status?: number; code?: number } | undefined;
  return value?.status === 401 || value?.code === 4001;
}

export function parseScheduleDateHeaders(html: string, semester: string) {
  const term = semester.match(/^(\d{4})-(\d{4})-([12])$/);
  if (!term) throw Errors.badGateway("课表日期缺少明确的学期年份");
  const $ = cheerio.load(html);
  const days = Array.from({ length: 7 }, () => "");
  $("table.qz-weeklyTable th").each((_, element) => {
    const text = $(element).text().replace(/\s+/g, " ").trim();
    const label = text.match(/(?:星期|周)([一二三四五六日天])/);
    const date = text.match(/(?:^|\s)(?:(\d{4})-)?(\d{2})-(\d{2})(?:\s|$)/);
    if (!label || !date) return;
    const index = label[1] === "天" ? 6 : "一二三四五六日".indexOf(label[1]);
    const month = Number(date[2]);
    const year = Number(date[1] || (term[3] === "1" && month >= 7 ? term[1] : term[2]));
    const ymd = `${year}-${date[2]}-${date[3]}`;
    const value = new Date(`${ymd}T00:00:00Z`);
    if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== ymd
      || (value.getUTCDay() || 7) !== index + 1 || (days[index] && days[index] !== ymd)) {
      throw Errors.badGateway("学校课表的日期表头不一致");
    }
    days[index] = ymd;
  });
  if (days.some((date, index) => !date || date !== addDays(days[0], index))) {
    throw Errors.badGateway("学校课表未返回完整的每周日期");
  }
  return days;
}

export async function loadModernScheduleCalendar(semester: string, readHtml: ReadHtml, now = new Date()): Promise<CalendarResult> {
  let targetSemester = semester.trim();
  let scheduleSemesters: CalendarResult["semesters"] = [];
  if (!targetSemester) {
    const schedule = parseSchedule(await readHtml("/jsxsd/xskb/xskb_list.do?viweType=0"));
    if (!schedule.pageRecognized || !schedule.currentSemester) {
      throw Errors.badGateway("学校课表未返回当前学期");
    }
    targetSemester = schedule.currentSemester;
    scheduleSemesters = schedule.semesters;
  }
  const query = new URLSearchParams({ xnxq01id: targetSemester }).toString();
  let published: CalendarResult | null = null;
  try {
    published = parseCalendar(await readHtml(`/jsxsd/jxzl/jxzl_query?${query}`));
    if (published.currentSemester === targetSemester && published.weeks.length) {
      return { ...published, calendarSource: "teaching-calendar" as const };
    }
  } catch (error) {
    if (isAuthorizationError(error)) throw error;
  }

  // The school can publish timetable dates before adding the term to its teaching-calendar page.
  const ranges = JSON.parse(await readHtml(`/jsxsd/xskb/jxzlzc_xnxq_ajax?${query}`));
  const first = Number(ranges?.[0]?.qszc);
  const last = Number(ranges?.[0]?.jszc);
  if (!Array.isArray(ranges) || ranges.length !== 1 || !Number.isInteger(first) || !Number.isInteger(last)
    || first < 1 || last < first || last > 64) {
    throw Errors.badGateway("学校课表未返回明确的教学周范围");
  }
  const readDays = async (week: number) => {
    const params = new URLSearchParams({ zc: String(week), kbjcmsid: "", xnxq01id: targetSemester, xswk: "false" });
    return parseScheduleDateHeaders(await readHtml(`/jsxsd/framework/mainV_index_loadkb.htmlx?${params}`), targetSemester);
  };
  const [firstDays, lastDays] = await Promise.all([readDays(first), readDays(last)]);
  if (lastDays[0] !== addDays(firstDays[0], (last - first) * 7)) {
    throw Errors.badGateway("学校课表首末周日期与教学周范围不一致");
  }
  const weeks = Array.from({ length: last - first + 1 }, (_, index) => {
    const days = firstDays.map((date) => addDays(date, index * 7));
    return { week: first + index, days, monday: days[0], sunday: days[6] };
  });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const semesters = (scheduleSemesters.length ? scheduleSemesters : published?.semesters || [])
    .map((item) => ({ ...item, current: item.value === targetSemester }));
  if (!semesters.some((item) => item.value === targetSemester)) {
    semesters.unshift({ value: targetSemester, label: targetSemester, current: true });
  }
  return {
    semesters,
    currentSemester: targetSemester,
    semesterStart: firstDays[0],
    semesterEnd: lastDays[6],
    weeks,
    currentWeek: weeks.find((item) => item.days.includes(today))?.week || 0,
    today,
    calendarSource: "schedule-dates" as const,
  };
}
