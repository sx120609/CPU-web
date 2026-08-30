import { prisma } from "../prisma";
import { getCalendar, getSchedule } from "./jwxtTransport";
import {
  buildScheduleWidgetPayload,
  inferScheduleWidgetSemester,
  resolveScheduleWidgetCalendar,
} from "./scheduleWidget";

export type WechatScheduleQuery = {
  scope: "day" | "week";
  label: string;
  dayOffset?: number;
  weekOffset?: number;
  weekNumber?: number;
  weekday?: number;
};

export type WechatScheduleResult = {
  payload: any;
  cached: boolean;
  query: WechatScheduleQuery;
  week: number;
  scopeDescription: string;
  day?: any;
  days?: any[];
};

export async function loadWechatSchedule(
  userId: number,
  query: WechatScheduleQuery,
  bindingToken?: string | null,
) {
  const widget = await prisma.scheduleWidgetToken.findFirst({
    where: {
      userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { updatedAt: "desc" },
    select: { jwxtToken: true, cachedPayload: true, cachedAt: true },
  });
  const jwxtToken = String(bindingToken || widget?.jwxtToken || "").trim();
  if (jwxtToken) {
    try {
      const now = new Date();
      const semester = inferScheduleWidgetSemester(now);
      const [calendar, parsed] = await Promise.all([
        getCalendar(jwxtToken).catch(() => null),
        getSchedule(jwxtToken, { semester }),
      ]);
      const resolvedCalendar = resolveScheduleWidgetCalendar(calendar, parsed, now);
      const currentPayload = buildScheduleWidgetPayload(parsed, resolvedCalendar, "", now);
      return selectWechatSchedule(currentPayload, query, {
        cached: false,
        buildWeek: (week) => buildScheduleWidgetPayload(parsed, resolvedCalendar, String(week), now),
        now,
      });
    } catch (error) {
      const cached = parseCurrentScheduleCache(widget?.cachedPayload);
      if (cached) return selectWechatSchedule(cached, query, { cached: true });
      throw error;
    }
  }
  const cached = parseCurrentScheduleCache(widget?.cachedPayload);
  if (cached) return selectWechatSchedule(cached, query, { cached: true });
  throw new Error("尚未同步可用的教务课表，请先在微信内登录教务并打开一次课表");
}

export function parseWechatScheduleRequest(value: string): WechatScheduleQuery | null {
  const text = String(value || "").trim().replace(/[？?！!。]/g, "").replace(/\s+/g, "");
  if (!text) return null;
  if (/^(?:课表|今日课表|今天课表|当天课表|今天有什么课|今日有什么课)$/u.test(text)) {
    return { scope: "day", label: "今日课表", dayOffset: 0 };
  }
  if (/^(?:明日课表|明天课表|明天有什么课|明日有什么课)$/u.test(text)) {
    return { scope: "day", label: "明日课表", dayOffset: 1 };
  }
  if (/^(?:后日课表|后天课表|后天有什么课)$/u.test(text)) {
    return { scope: "day", label: "后天课表", dayOffset: 2 };
  }
  if (/^(?:本周|这周|本星期|这星期)(?:的)?(?:课表|课程|有什么课)$/u.test(text)) {
    return { scope: "week", label: "本周课表", weekOffset: 0 };
  }
  if (/^(?:下周|下星期)(?:的)?(?:课表|课程|有什么课)$/u.test(text)) {
    return { scope: "week", label: "下周课表", weekOffset: 1 };
  }
  if (/^(?:下下周|下下星期)(?:的)?(?:课表|课程|有什么课)$/u.test(text)) {
    return { scope: "week", label: "下下周课表", weekOffset: 2 };
  }
  const numberedWeek = text.match(/^第?(\d{1,2})(?:教学)?周(?:的)?(?:课表|课程)$/u);
  if (numberedWeek) {
    const weekNumber = Number(numberedWeek[1]);
    if (weekNumber >= 1 && weekNumber <= 64) {
      return { scope: "week", label: `第 ${weekNumber} 周课表`, weekNumber };
    }
  }
  const weekdayMatch = text.match(/^(本周|这周|下周|下下周|本星期|这星期|下星期|下下星期|周|星期|礼拜)([一二三四五六日天])(?:的)?(?:课表|课程|有什么课)$/u);
  if (weekdayMatch) {
    const weekOffset = /下下/u.test(weekdayMatch[1]) ? 2 : /^下/u.test(weekdayMatch[1]) ? 1 : 0;
    const weekdayText = weekdayMatch[2] === "天" ? "日" : weekdayMatch[2];
    const weekday = "一二三四五六日".indexOf(weekdayText) + 1;
    const prefix = weekOffset === 2 ? "下下周" : weekOffset === 1 ? "下周" : "本周";
    return { scope: "day", label: `${prefix}${weekdayText}课表`, weekOffset, weekday };
  }
  return null;
}

export function renderWechatScheduleMarkdown(result: WechatScheduleResult) {
  const lines = [result.query.label, result.scopeDescription, ""];
  if (result.query.scope === "day") {
    appendDaySchedule(lines, result.day, result.payload?.teachingWeekActive);
  } else {
    const days = Array.isArray(result.days) ? result.days : [];
    const courseCount = days.reduce((total, day) => total + (Array.isArray(day?.courses) ? day.courses.length : 0), 0);
    if (!courseCount) {
      lines.push(result.payload?.teachingWeekActive === false ? "当前不在教学周，本周没有课程。" : "本周没有课程。");
    } else {
      for (const day of days) {
        const courses = Array.isArray(day?.courses) ? day.courses : [];
        if (!courses.length) continue;
        lines.push(`${String(day?.label || weekdayLabel(day?.day)).trim()} · ${String(day?.date || "").trim()}`);
        for (const course of courses) appendCourse(lines, course);
        lines.push("");
      }
      while (lines.at(-1) === "") lines.pop();
    }
  }
  if (result.cached) lines.push("", "教务暂时不可用，以上来自最近一次成功同步的课表缓存。");
  return lines.join("\n");
}

export function renderWechatTodayScheduleMarkdown(payload: any, options?: { cached?: boolean }) {
  const result = selectWechatSchedule(payload, { scope: "day", label: "今日课表", dayOffset: 0 }, {
    cached: Boolean(options?.cached),
  });
  return renderWechatScheduleMarkdown(result);
}

function selectWechatSchedule(
  payload: any,
  query: WechatScheduleQuery,
  options: { cached: boolean; buildWeek?: (week: number) => any; now?: Date },
): WechatScheduleResult {
  const currentWeek = Number(payload?.currentWeek || payload?.week || 0);
  if (query.scope === "week") {
    const targetWeek = Number(query.weekNumber || (currentWeek > 0 ? currentWeek + Number(query.weekOffset || 0) : 0));
    if (!targetWeek) throw new Error("当前不在可识别的教学周，暂时无法定位所选周次");
    const selectedPayload = targetWeek === Number(payload?.displayWeek || payload?.week || 0)
      ? payload
      : options.buildWeek?.(targetWeek);
    if (!selectedPayload) throw new Error("缓存中没有所选周次，请先打开课表同步最新教务数据");
    const days = Array.isArray(selectedPayload?.weekDays) ? selectedPayload.weekDays : selectedPayload?.days || [];
    return {
      payload: selectedPayload,
      cached: options.cached,
      query,
      week: targetWeek,
      days,
      scopeDescription: `第 ${targetWeek} 周${weekDateRange(days)}`,
    };
  }

  if (Number(query.weekday) > 0) {
    const targetWeek = Number(query.weekNumber || (currentWeek > 0 ? currentWeek + Number(query.weekOffset || 0) : 0));
    if (!targetWeek) throw new Error("当前不在可识别的教学周，暂时无法定位所选日期");
    const selectedPayload = targetWeek === Number(payload?.displayWeek || payload?.week || 0)
      ? payload
      : options.buildWeek?.(targetWeek);
    if (!selectedPayload) throw new Error("缓存中没有所选日期，请先打开课表同步最新教务数据");
    const days = Array.isArray(selectedPayload?.weekDays) ? selectedPayload.weekDays : selectedPayload?.days || [];
    const day = days.find((item: any) => Number(item?.day) === Number(query.weekday));
    if (!day) throw new Error("没有找到所选日期的课表数据");
    return {
      payload: selectedPayload,
      cached: options.cached,
      query,
      week: targetWeek,
      day,
      scopeDescription: `${String(day.date || "").trim()} · 第 ${targetWeek} 周`,
    };
  }

  const dayOffset = Number(query.dayOffset || 0);
  const targetDate = addDaysToYmd(chinaYmd(options.now), dayOffset);
  const candidates = [...(payload?.weekDays || []), ...(payload?.days || [])];
  const day = (dayOffset === 0 ? candidates.find((item: any) => item?.isToday) || payload?.today : null)
    || candidates.find((item: any) => String(item?.date || "") === targetDate);
  if (!day) throw new Error("当前课表数据中没有所选日期，请先打开课表同步最新教务数据");
  const week = Number(day?.week || currentWeek || 0);
  return {
    payload,
    cached: options.cached,
    query,
    week,
    day,
    scopeDescription: `${String(day?.date || targetDate).trim()}${week > 0 ? ` · 第 ${week} 周` : ""}`,
  };
}

function appendDaySchedule(lines: string[], day: any, teachingWeekActive: unknown) {
  const courses = Array.isArray(day?.courses) ? day.courses : [];
  if (!courses.length) {
    lines.push(teachingWeekActive === false ? "当前不在教学周，当天没有课程。" : "当天没有课程。");
    return;
  }
  for (const course of courses) appendCourse(lines, course);
}

function appendCourse(lines: string[], course: any) {
  const time = [course.startTime, course.endTime].filter(Boolean).join("-") || `第 ${course.startSlot || "?"}-${course.endSlot || "?"} 节`;
  lines.push(`· ${time}  ${String(course.name || "未命名课程").trim()}`);
  const detail = [course.location ? `地点：${course.location}` : "", course.teacher ? `教师：${course.teacher}` : ""].filter(Boolean).join("  ");
  if (detail) lines.push(`  ${detail}`);
}

function weekDateRange(days: any[]) {
  const dates = days.map((day) => String(day?.date || "").trim()).filter(Boolean);
  return dates.length ? ` · ${dates[0]} 至 ${dates.at(-1)}` : "";
}

function weekdayLabel(value: unknown) {
  return ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"][Number(value)] || "课程";
}

function parseCurrentScheduleCache(raw: string | null | undefined) {
  try {
    const payload = JSON.parse(raw || "null");
    if (!payload || typeof payload !== "object") return null;
    const today = payload.today || (payload.days || []).find((item: any) => item?.isToday);
    if (String(today?.date || "") !== chinaYmd()) return null;
    return payload;
  } catch {
    return null;
  }
}

function addDaysToYmd(ymd: string, days: number) {
  const match = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function chinaYmd(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
