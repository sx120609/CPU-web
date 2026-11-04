import { currentBrandName } from "@/utils/documentTitle";
// 考试安排：把教务给的考试时间读成日期和起止时刻，算倒计时、分紧急程度，并导出成 `.ics` 日历文件。
// 教务的时间是一段文字，常见的是 "2026-06-20 09:00-11:00"，也见过斜杠、中文年月日、带秒和用 ~ 连接的写法。

export interface ExamTimeRange {
  /** "yyyy-MM-dd"。 */
  date: string;
  /** "HH:mm"，读不出来时为 null（只有日期）。 */
  start: string | null;
  end: string | null;
}

export interface ExamLike {
  courseName: string;
  courseCode?: string;
  examName?: string;
  examTime?: string;
  location?: string;
  seat?: string;
  examType?: string;
}

/** 紧急程度：今天、3 天内、7 天内、更远、已经考完、时间读不出来。 */
export type ExamUrgency = "today" | "urgent" | "soon" | "later" | "ended" | "unknown";

export interface ExamPlan<T extends ExamLike = ExamLike> {
  exam: T;
  time: ExamTimeRange | null;
  /** 距今天还有几天；今天是 0，已经过去的是负数。 */
  daysLeft: number | null;
  urgency: ExamUrgency;
}

const pad = (value: number) => String(value).padStart(2, "0");

function clockText(hour: string, minute: string) {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

export function parseExamTime(text: string | undefined | null): ExamTimeRange | null {
  const value = String(text ?? "").trim();
  if (!value) return null;
  const day = value.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/u);
  if (!day) return null;
  const year = Number(day[1]);
  const month = Number(day[2]);
  const date = Number(day[3]);
  const check = new Date(year, month - 1, date);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== date) return null;
  const rest = value.slice((day.index ?? 0) + day[0].length);
  const clocks = Array.from(rest.matchAll(/(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*\d{2})?/gu))
    .map((match) => clockText(match[1], match[2]))
    .filter((clock): clock is string => Boolean(clock));
  const start = clocks[0] ?? null;
  // 结束时间早于开始时间的不要，宁可只留开始时间。
  const end = clocks[1] && start && clocks[1] > start ? clocks[1] : null;
  return { date: `${year}-${pad(month)}-${pad(date)}`, start, end };
}

function localDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function ymd(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutesOf(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

export function examDaysLeft(time: ExamTimeRange, now = new Date()) {
  const today = localDay(ymd(now));
  return Math.round((localDay(time.date).getTime() - today.getTime()) / 86_400_000);
}

/** 考完了没有：当天的考试按结束时间（没有就按开始时间）算，只有日期的过了那天才算。 */
export function examHasEnded(time: ExamTimeRange, now = new Date()) {
  const days = examDaysLeft(time, now);
  if (days !== 0) return days < 0;
  const finish = time.end ?? time.start;
  if (!finish) return false;
  return now.getHours() * 60 + now.getMinutes() >= minutesOf(finish);
}

export function examUrgency(time: ExamTimeRange | null, now = new Date()): ExamUrgency {
  if (!time) return "unknown";
  if (examHasEnded(time, now)) return "ended";
  const days = examDaysLeft(time, now);
  if (days <= 0) return "today";
  if (days <= 3) return "urgent";
  if (days <= 7) return "soon";
  return "later";
}

/** 按时间排好：没考的从近到远，然后是时间读不出来的，最后是考完的（最近考完的在前）。 */
export function planExams<T extends ExamLike>(list: T[], now = new Date()): ExamPlan<T>[] {
  const plans = list.map((exam) => {
    const time = parseExamTime(exam.examTime);
    return { exam, time, daysLeft: time ? examDaysLeft(time, now) : null, urgency: examUrgency(time, now) };
  });
  const rank = (plan: ExamPlan<T>) => (plan.urgency === "ended" ? 2 : plan.urgency === "unknown" ? 1 : 0);
  const sortKey = (plan: ExamPlan<T>) => (plan.time ? `${plan.time.date} ${plan.time.start ?? "99:99"}` : "");
  return plans
    .map((plan, index) => ({ plan, index }))
    .sort((a, b) => {
      const byRank = rank(a.plan) - rank(b.plan);
      if (byRank) return byRank;
      const ka = sortKey(a.plan);
      const kb = sortKey(b.plan);
      if (ka !== kb) return rank(a.plan) === 2 ? (ka < kb ? 1 : -1) : (ka < kb ? -1 : 1);
      return a.index - b.index;
    })
    .map(({ plan }) => plan);
}

/** 列表右上角的小标签。 */
export function examCountdownLabel(plan: Pick<ExamPlan, "daysLeft" | "urgency">) {
  switch (plan.urgency) {
    case "ended": return "已结束";
    case "unknown": return "时间待定";
    case "today": return "今天";
    default: return plan.daysLeft === 1 ? "明天" : `${plan.daysLeft} 天后`;
  }
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function examWeekday(time: ExamTimeRange) {
  return WEEKDAYS[localDay(time.date).getDay()];
}

export function examClockText(time: ExamTimeRange) {
  if (!time.start) return "";
  return time.end ? `${time.start}-${time.end}` : time.start;
}

// MARK: 导出日历

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function utcStamp(date: Date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** UID 只留 ASCII：其余字符写成十六进制码位。 */
function asciiIdentity(value: string) {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 128 ? char : code.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function compactDate(date: string) {
  return date.replace(/-/g, "");
}

function compactClock(clock: string) {
  return `${clock.replace(":", "")}00`;
}

function nextDay(date: string) {
  const day = localDay(date);
  day.setDate(day.getDate() + 1);
  return ymd(day);
}

/** 只有开始时间的考试按两小时算。 */
const DEFAULT_EXAM_MINUTES = 120;

function addMinutes(clock: string, minutes: number) {
  const total = Math.min(23 * 60 + 59, minutesOf(clock) + minutes);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** 导出读得出日期的考试；每场都提醒两次：前一天和开考前一小时。 */
export function buildExamIcs(list: ExamLike[], stamp = new Date()) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CPUTime//Exams//CN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  ];
  let count = 0;
  for (const exam of list) {
    const time = parseExamTime(exam.examTime);
    if (!time) continue;
    count += 1;
    const identity = asciiIdentity(`${time.date}-${time.start ?? "day"}-${exam.courseCode || exam.courseName}`);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:exam-${escapeText(identity)}@cputime.cn`);
    lines.push(`DTSTAMP:${utcStamp(stamp)}`);
    if (time.start) {
      lines.push(`DTSTART;TZID=Asia/Shanghai:${compactDate(time.date)}T${compactClock(time.start)}`);
      lines.push(`DTEND;TZID=Asia/Shanghai:${compactDate(time.date)}T${compactClock(time.end ?? addMinutes(time.start, DEFAULT_EXAM_MINUTES))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(time.date)}`);
      lines.push(`DTEND;VALUE=DATE:${compactDate(nextDay(time.date))}`);
    }
    lines.push(`SUMMARY:${escapeText(`考试：${exam.courseName.trim() || "课程"}`)}`);
    const location = String(exam.location ?? "").trim();
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    const details = [
      exam.seat ? `座位号 ${String(exam.seat).trim()}` : "",
      String(exam.examType ?? "").trim(),
      String(exam.examName ?? "").trim(),
    ].filter(Boolean);
    const unique = details.filter((item, index) => details.indexOf(item) === index);
    if (unique.length) lines.push(`DESCRIPTION:${escapeText(unique.join(" · "))}`);
    for (const trigger of ["-P1D", "-PT1H"]) {
      // 只有日期的考试，开考前一小时没有意义。
      if (!time.start && trigger === "-PT1H") continue;
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(`考试：${exam.courseName.trim()}`)}`, `TRIGGER:${trigger}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return { content: `${lines.join("\r\n")}\r\n`, count };
}

export function examIcsFileName(list: ExamLike[]) {
  if (list.length === 1) return `${currentBrandName()}-考试-${list[0].courseName.trim().replace(/[\\/:*?"<>|]/g, "") || "课程"}.ics`;
  return `${currentBrandName()}-考试安排.ics`;
}
