import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

process.env.REDIS_ENABLED = "false";
process.env.DATABASE_URL = "";

test("existing widget URLs keep their response contract and never receive uncovered cached dates", async () => {
  const { jwxtRouter } = await import("../src/routes/jwxt");
  const { scheduleData } = await import("../src/services/scheduleData");
  const { prisma } = await import("../src/prisma");
  const { SCHEDULE_WIDGET_PAYLOAD_VERSION } = await import("../src/services/scheduleWidget");
  const { Errors } = await import("../src/utils/response");
  const originalRead = scheduleData.readSchedule;
  const originalFind = prisma.scheduleWidgetToken.findUnique;
  const originalUpdate = prisma.scheduleWidgetToken.updateMany;
  const originalEdits = prisma.userScheduleEdit.findUnique;
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const addDays = (offset: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
  const semester = "2026-2027-1";
  const weeks = [1, 2, 3].map((week) => {
    const days = Array.from({ length: 7 }, (_, index) => addDays(1 - dayOfWeek + (week - 1) * 7 + index));
    return { week, days, monday: days[0], sunday: days[6] };
  });
  const row = { id: 1, userId: 1, jwxtToken: "existing-school-session", cachedPayload: null as string | null, cachedAt: null, revokedAt: null as Date | null };
  let upstreamFails = false;
  let writesAllowed = true;
  (prisma.scheduleWidgetToken.findUnique as any) = async () => row;
  (prisma.scheduleWidgetToken.updateMany as any) = async ({ data }: any) => {
    if (!writesAllowed) return { count: 0 };
    if (data.cachedPayload) row.cachedPayload = data.cachedPayload;
    return { count: 1 };
  };
  (prisma.userScheduleEdit.findUnique as any) = async () => null;
  scheduleData.readSchedule = async (_token, query = {}) => {
    if (upstreamFails) throw Errors.badGateway("教务暂时不可用");
    return {
      parsed: {
        title: "课表", source: "modern", pageRecognized: true, semesters: [], weeks: [],
        currentSemester: semester, currentWeek: query.week || "1",
        cells: [{ day: (dayOfWeek % 7) + 1, bigSlot: 1, courses: [{ name: "明日课程", weeks: "1-20周", weekList: [], startSlot: 1, endSlot: 2 }] }],
      },
      calendar: { source: "modern", semesters: [], currentSemester: semester, currentWeek: 1, today, weeks, semesterStart: weeks[0].monday, semesterEnd: weeks[2].sunday },
      syncedAt: now.toISOString(), calendarSyncedAt: now.toISOString(), stale: false,
    };
  };
  const app = express();
  app.use("/api/jwxt", jwxtRouter);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ code: error.code || 5000, data: null, message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/jwxt/schedule-widget?token=existing-widget-token`;
  try {
    const response = await fetch(url);
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.code, 0);
    assert.equal(body.data.strictDate, true);
    assert.equal(body.data.days.find((day: any) => day.date === addDays(1))?.courses[0]?.name, "明日课程");
    const goodCache = row.cachedPayload;
    upstreamFails = true;
    const cached = await fetch(url).then((result) => result.json()) as any;
    assert.equal(cached.code, 0);
    assert.equal(cached.data.stale, true);
    assert.equal(row.cachedPayload, goodCache);

    row.cachedPayload = JSON.stringify({
      payloadVersion: SCHEDULE_WIDGET_PAYLOAD_VERSION, strictDate: true, cacheVersion: 0,
      days: [{ date: addDays(-1), courses: [] }], weekDays: [],
    });
    const missing = await fetch(url);
    const failure = await missing.json() as any;
    assert.equal(missing.status, 502);
    assert.notEqual(failure.code, 0);
    assert.equal(failure.data, null);

    upstreamFails = false;
    row.revokedAt = now;
    assert.equal((await fetch(url)).status, 401);
    row.revokedAt = null;
    writesAllowed = false;
    assert.equal((await fetch(url)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    scheduleData.readSchedule = originalRead;
    prisma.scheduleWidgetToken.findUnique = originalFind;
    prisma.scheduleWidgetToken.updateMany = originalUpdate;
    prisma.userScheduleEdit.findUnique = originalEdits;
  }
});
