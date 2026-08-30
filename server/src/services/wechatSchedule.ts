import { prisma } from "../prisma";
import { getCalendar, getSchedule } from "./jwxtTransport";
import {
  buildScheduleWidgetPayload,
  inferScheduleWidgetSemester,
  resolveScheduleWidgetCalendar,
} from "./scheduleWidget";

export async function loadWechatTodaySchedule(userId: number, bindingToken?: string | null) {
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
      const payload = buildScheduleWidgetPayload(
        parsed,
        resolveScheduleWidgetCalendar(calendar, parsed, now),
        "",
        now,
      );
      return { payload, cached: false };
    } catch (error) {
      const cached = parseCurrentScheduleCache(widget?.cachedPayload);
      if (cached) return { payload: cached, cached: true };
      throw error;
    }
  }
  const cached = parseCurrentScheduleCache(widget?.cachedPayload);
  if (cached) return { payload: cached, cached: true };
  throw new Error("尚未同步可用的教务课表，请先在微信内登录教务并打开一次课表");
}

export function renderWechatTodayScheduleMarkdown(payload: any, options?: { cached?: boolean }) {
  const today = (payload?.weekDays || []).find((item: any) => item?.isToday)
    || payload?.today
    || (payload?.days || []).find((item: any) => item?.isToday);
  const courses = Array.isArray(today?.courses) ? today.courses : [];
  const date = String(today?.date || chinaYmd()).trim();
  const week = Number(payload?.currentWeek || payload?.week || 0);
  const lines = [
    "今日课表",
    `${date}${week > 0 ? ` · 第 ${week} 周` : ""}`,
    "",
  ];
  if (!courses.length) {
    lines.push(payload?.teachingWeekActive === false ? "当前不在教学周，今天没有待上的课程。" : "今天没有待上的课程。");
  } else {
    for (const course of courses.slice(0, 10)) {
      const time = [course.startTime, course.endTime].filter(Boolean).join("-") || `第 ${course.startSlot || "?"}-${course.endSlot || "?"} 节`;
      lines.push(`· ${time}  ${String(course.name || "未命名课程").trim()}`);
      const detail = [course.location ? `地点：${course.location}` : "", course.teacher ? `教师：${course.teacher}` : ""].filter(Boolean).join("  ");
      if (detail) lines.push(`  ${detail}`);
    }
  }
  if (options?.cached) lines.push("", "教务暂时不可用，以上来自最近一次成功同步的今日缓存。");
  return lines.join("\n");
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

function chinaYmd(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
