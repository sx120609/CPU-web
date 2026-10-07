import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ScheduleShare, ScheduleShareMeta } from "../src/api/scheduleShares";
import {
  SharedScheduleReadError,
  adoptSharedLibraryAccount,
  buildSharePublishBody,
  emptySharedLibrary,
  markSharedScheduleRevoked,
  normalizeShareCode,
  parseSharedLibrary,
  readSharedSchedule,
  refreshSharedLibrary,
  removeSharedSchedule,
  renameSharedSchedule,
  saveSharedSchedule,
  shareInvitationText,
  shareOwnerName,
  shareUpdatedText,
  sharedScheduleName,
  sharedScheduleWeek,
} from "../src/views/schedule/sharedSchedules";
import type { CalendarResult, ScheduleResult } from "../src/views/schedule/types";

// The body the iOS app publishes; the server hands `schedule` and `calendar` back as they are.
const body = JSON.parse(readFileSync(new URL("../../ios_next/tests/fixtures/schedule-share-body.json", import.meta.url), "utf8")) as {
  ownerName: string;
  semester: string;
  schedule: ScheduleResult;
  calendar: CalendarResult;
};

function share(overrides: Partial<ScheduleShare> = {}): ScheduleShare {
  return {
    code: "ABCD2345",
    owner: body.ownerName,
    semester: body.semester,
    courseCount: 1,
    createdAt: "2026-10-01T02:00:00.000Z",
    updatedAt: "2026-10-07T02:00:00.000Z",
    schedule: body.schedule,
    calendar: body.calendar,
    ...overrides,
  };
}

function notFound() {
  return Object.assign(new Error("not found"), { response: { status: 404 } });
}

test("a share code is read out of whatever was typed or pasted", () => {
  assert.equal(normalizeShareCode(" abcd-2345 "), "ABCD2345");
  assert.equal(normalizeShareCode("ab cd 23 45"), "ABCD2345");
  assert.equal(normalizeShareCode("https://cputime.cn/schedule/share/abcd2345?from=qq#top"), "ABCD2345");
  assert.equal(normalizeShareCode("我的课表分享码：ABCD2345"), null);
  assert.equal(normalizeShareCode("ABCD234"), null);
  // 0, 1, I and O never appear in a code.
  assert.equal(normalizeShareCode("ABCD0345"), null);
});

test("a timetable shared from iOS is read, clamped and laid out by its own calendar", () => {
  const saved = readSharedSchedule(share(), 1000);
  assert.equal(saved.meta.code, "ABCD2345");
  assert.equal(saved.schedule.scope, "semester");
  assert.deepEqual(saved.schedule.cells.map((cell) => [cell.day, cell.bigSlot, cell.courses[0].name]), [[1, 1, "药理学"]]);
  assert.equal(saved.calendar.weeks[0].days.length, 7);
  assert.deepEqual(saved.calendar.adjustments?.map((item) => item.kind), ["off"]);
  assert.equal(saved.fetchedAt, 1000);
  assert.equal(shareOwnerName(saved.meta), "阿青");
  assert.equal(sharedScheduleName(saved), "阿青");
  assert.equal(sharedScheduleName({ ...saved, remark: " 室友 " }), "室友");
  assert.equal(shareOwnerName({ owner: "同学" }), null);
});

test("rows a grid cannot index are dropped instead of drawn somewhere they cannot be", () => {
  const schedule: ScheduleResult = {
    semesters: [{ value: "x", label: "x", current: true }],
    weeks: [],
    currentSemester: "x",
    currentWeek: "1",
    cells: [
      { day: 9, bigSlot: 1, courses: [{ name: "不存在的星期", weeks: "", weekList: [] }] },
      { day: 2, bigSlot: 1, courses: [
        { name: "  ", weeks: "", weekList: [] },
        { name: "药理学", weeks: "", weekList: [3, 3, 99, 1], startSlot: 40, endSlot: 2, sourceKey: "jwxt|secret", customId: "custom-1" },
      ] },
    ],
  };
  const saved = readSharedSchedule(share({ schedule }));
  assert.equal(saved.schedule.cells.length, 1);
  const course = saved.schedule.cells[0].courses[0];
  assert.deepEqual([course.startSlot, course.endSlot, course.weekList], [20, 20, [1, 3]]);
  // Edit identities belong to the publisher's account and stay behind.
  assert.equal(course.sourceKey, undefined);
  assert.equal(course.customId, undefined);
  assert.equal(saved.schedule.semesters.length, 0);

  assert.throws(() => readSharedSchedule(share({ schedule: { ...schedule, cells: [] } })), (error: unknown) => (
    error instanceof SharedScheduleReadError && error.kind === "empty"
  ));
  assert.throws(() => readSharedSchedule(share({ calendar: { ...body.calendar, weeks: [] } })), (error: unknown) => (
    error instanceof SharedScheduleReadError && error.kind === "noCalendar"
  ));
});

test("the week shown is worked out from today, not from the week the publisher shared in", () => {
  const calendar = readSharedSchedule(share()).calendar;
  assert.equal(sharedScheduleWeek(calendar, "2026-09-09"), 1);
  assert.equal(sharedScheduleWeek(calendar, "2026-08-01"), calendar.weeks[0].week);
  assert.equal(sharedScheduleWeek(calendar, "2027-01-01"), calendar.weeks.at(-1)?.week);
});

test("the library keeps one copy per code, the reader's remark and the account it belongs to", () => {
  const first = readSharedSchedule(share());
  let library = adoptSharedLibraryAccount(emptySharedLibrary(), "42");
  library = saveSharedSchedule(library, first, " 室友小王 ");
  library = saveSharedSchedule(library, readSharedSchedule(share({ updatedAt: "2026-10-08T00:00:00.000Z" })), "室友");
  assert.equal(library.schedules.length, 1);
  assert.equal(library.schedules[0].remark, "室友");
  library = renameSharedSchedule(library, "ABCD2345", " 小王 ");
  assert.equal(sharedScheduleName(library.schedules[0]), "小王");
  library = markSharedScheduleRevoked(library, "ABCD2345");
  assert.equal(library.schedules[0].revoked, true);

  // It survives a round trip through storage; junk does not break it.
  assert.deepEqual(parseSharedLibrary(JSON.stringify(library)), library);
  assert.deepEqual(parseSharedLibrary("{not json"), emptySharedLibrary());
  assert.deepEqual(parseSharedLibrary(JSON.stringify({ account: "1", schedules: [{ meta: {} }] })), { account: "1", schedules: [] });

  // The same account, or nobody signed in, changes nothing; another account starts over.
  assert.equal(adoptSharedLibraryAccount(library, "42"), library);
  assert.equal(adoptSharedLibraryAccount(library, ""), library);
  assert.deepEqual(adoptSharedLibraryAccount(library, "43"), { account: "43", schedules: [] });
  assert.equal(removeSharedSchedule(library, "ABCD2345").schedules.length, 0);
});

test("refreshing downloads a changed share, keeps the remark and marks a revoked one", async () => {
  let library = saveSharedSchedule(emptySharedLibrary(), readSharedSchedule(share(), 1), "室友");
  const meta = (updatedAt: string): ScheduleShareMeta => ({
    code: "ABCD2345", owner: "阿青", semester: body.semester, courseCount: 1, createdAt: "", updatedAt,
  });

  // Unchanged: nothing is downloaded.
  let downloads = 0;
  const same = await refreshSharedLibrary(library, {
    meta: async () => meta("2026-10-07T02:00:00.000Z"),
    get: async () => { downloads += 1; return share(); },
  });
  assert.equal(same, library);
  assert.equal(downloads, 0);

  // Changed: downloaded again under the same remark.
  library = await refreshSharedLibrary(library, {
    meta: async () => meta("2026-10-09T00:00:00.000Z"),
    get: async () => share({ updatedAt: "2026-10-09T00:00:00.000Z" }),
  }, () => 2);
  assert.deepEqual([library.schedules[0].meta.updatedAt, library.schedules[0].remark, library.schedules[0].fetchedAt], ["2026-10-09T00:00:00.000Z", "室友", 2]);

  // A server that predates the summary route answers 404 for every code: the share itself decides.
  const olderServer = await refreshSharedLibrary(library, {
    meta: async () => { throw notFound(); },
    get: async () => share({ updatedAt: "2026-10-10T00:00:00.000Z" }),
  });
  assert.equal(olderServer.schedules[0].revoked, false);
  assert.equal(olderServer.schedules[0].meta.updatedAt, "2026-10-10T00:00:00.000Z");

  // Offline: the saved copy stays as it is.
  const offline = await refreshSharedLibrary(library, {
    meta: async () => { throw new Error("Network Error"); },
    get: async () => { throw new Error("Network Error"); },
  });
  assert.equal(offline, library);

  // Gone on both routes: withdrawn. The copy is kept and not asked about again.
  const revoked = await refreshSharedLibrary(library, {
    meta: async () => { throw notFound(); },
    get: async () => { throw notFound(); },
  });
  assert.equal(revoked.schedules[0].revoked, true);
  let asked = 0;
  await refreshSharedLibrary(revoked, {
    meta: async () => { asked += 1; return meta(""); },
    get: async () => share(),
  });
  assert.equal(asked, 0);
});

test("publishing sends only what a reader needs to draw the timetable", () => {
  const schedule: ScheduleResult = {
    scope: "semester",
    semesters: [{ value: "2025-2026-2", label: "上学期", current: false }, { value: "2026-2027-1", label: "本学期", current: true }],
    weeks: [],
    currentSemester: "2026-2027-1",
    currentWeek: "5",
    cells: [
      { day: 1, bigSlot: 1, courses: [
        { name: "药理学", weeks: "1-16周", weekList: [1, 2], teacher: "王老师", sourceKey: "jwxt|x", customId: "custom-1", custom: true, nativeId: "n1" },
        { name: " ", weeks: "", weekList: [] },
      ] },
      { day: 2, bigSlot: 1, courses: [] },
    ],
  };
  const published = buildSharePublishBody({ semester: "2026-2027-1", schedule, calendar: body.calendar, ownerName: " 阿青 " });
  assert.equal(published.ownerName, "阿青");
  assert.deepEqual(published.schedule.semesters, []);
  assert.deepEqual(published.schedule.cells, [
    { day: 1, bigSlot: 1, courses: [{ name: "药理学", weeks: "1-16周", weekList: [1, 2], teacher: "王老师" }] },
  ]);
  assert.equal(published.schedule.currentWeek, String(body.calendar.weeks[0].week));
  assert.equal("ownerName" in buildSharePublishBody({ semester: "x", schedule, calendar: body.calendar }), false);
  // What goes out reads back as the same timetable.
  const saved = readSharedSchedule(share({ schedule: published.schedule, calendar: published.calendar }));
  assert.deepEqual(saved.schedule.cells, published.schedule.cells);
});

test("the text sent to a friend carries the code and the browser link", () => {
  assert.equal(
    shareInvitationText("ABCD2345", "https://cputime.cn/"),
    "我的课表分享码：ABCD2345\n在药大拾间「课表 → 更多 → 共享课表」里输入就能看，也可以直接打开：https://cputime.cn/schedule/share/ABCD2345",
  );
  assert.equal(shareUpdatedText("2026-10-07T17:00:00.000Z"), "更新于 10月8日");
  assert.equal(shareUpdatedText("not a date"), null);
});
