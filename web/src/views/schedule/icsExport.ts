// 把一周的课导出成 `.ics` 日历文件。用的是课表已经按日期解析好的课程，
// 所以放假那天什么都不导出，补班那天导出它实际上的课（iOS 见 ScheduleICSExport.swift）。
import { classroomOnly, clockMinutes, type SlotClock } from "./nowIndicator";
import type { WeekCourseBlock } from "./types";

export interface IcsDay {
  /** "yyyy-MM-dd"。 */
  date: string;
  blocks: WeekCourseBlock[];
}

const TIME_ZONE = "Asia/Shanghai";

function trimmed(value: string | undefined | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function ownClock(value: string | undefined) {
  const text = trimmed(value);
  return text && clockMinutes(text) !== null ? text : null;
}

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function localStamp(date: string, time: string) {
  const day = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const minutes = clockMinutes(time);
  if (!day || minutes === null) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return { text: `${day[1]}${day[2]}${day[3]}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`, minutes };
}

function utcStamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
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

export function buildWeekIcs(input: { week: number; days: IcsDay[]; clocks: SlotClock[]; stamp?: Date }) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CPUTime//Schedule//CN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  ];
  const stamp = utcStamp(input.stamp ?? new Date());
  for (const day of input.days) {
    for (const block of day.blocks) {
      const course = block.course;
      // 自定义课程带了自己的上下课时间时，以它为准。
      const startText = ownClock(course.customStartTime) ?? input.clocks.find((slot) => slot.no === block.startSlot)?.start;
      const endText = ownClock(course.customEndTime) ?? input.clocks.find((slot) => slot.no === block.endSlot)?.end;
      if (!startText || !endText) continue;
      const start = localStamp(day.date, startText);
      const end = localStamp(day.date, endText);
      if (!start || !end || end.minutes <= start.minutes) continue;
      const identity = course.customId ?? course.nativeId ?? course.sourceKey ?? course.name;
      const uid = asciiIdentity(`${input.week}-${day.date}-${block.startSlot}-${block.endSlot}-${identity}`);
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${escapeText(uid)}@cputime.cn`);
      lines.push(`DTSTAMP:${stamp}Z`);
      lines.push(`DTSTART;TZID=${TIME_ZONE}:${start.text}`);
      lines.push(`DTEND;TZID=${TIME_ZONE}:${end.text}`);
      lines.push(`SUMMARY:${escapeText(trimmed(course.name) ?? "课程")}`);
      const location = classroomOnly(trimmed(course.location) ?? "");
      if (location) lines.push(`LOCATION:${escapeText(location)}`);
      const details = [trimmed(course.teacher), trimmed(course.slotNote)].filter(Boolean).join(" · ");
      if (details) lines.push(`DESCRIPTION:${escapeText(details)}`);
      lines.push("END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function weekIcsFileName(week: number) {
  return `药大拾间-第${week}周课表.ics`;
}

/** 交给浏览器保存；支持分享文件的手机浏览器先走系统分享面板，好直接加进日历。 */
export async function saveWeekIcs(content: string, fileName: string) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  try {
    const file = new File([blob], fileName, { type: "text/calendar" });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })
      && window.matchMedia?.("(pointer: coarse)").matches) {
      await nav.share({ files: [file], title: fileName });
      return "shared" as const;
    }
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return "cancelled" as const;
    /* 分享不了就退回下载 */
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded" as const;
}
