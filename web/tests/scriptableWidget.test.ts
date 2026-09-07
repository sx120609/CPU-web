import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildScriptableWidgetScript } from "../src/views/schedule/scriptableWidget";
import { buildScheduleWidgetPayload, scheduleWidgetFallbackPayload } from "../../server/src/services/scheduleWidget";

type Course = {
  name: string;
  location?: string;
  teacher?: string;
  startTime: string;
  endTime: string;
  startSlot?: number;
  endSlot?: number;
};

type WidgetResult = TextContainer;

class TextContainer {
  texts: string[];
  sizes: Array<{ width: number; height: number }>;

  constructor(texts: string[] = [], sizes: Array<{ width: number; height: number }> = []) {
    this.texts = texts;
    this.sizes = sizes;
  }

  set size(value: { width: number; height: number }) {
    this.sizes.push({ width: value.width, height: value.height });
  }

  addText(value: string) {
    this.texts.push(String(value));
    return {};
  }

  addSpacer() {}
  setPadding() {}
  layoutHorizontally() {}
  layoutVertically() {}
  topAlignContent() {}
  centerAlignContent() {}

  addStack() {
    return new TextContainer(this.texts, this.sizes);
  }

  async presentSmall() {}
  async presentMedium() {}
  async presentLarge() {}
}

async function runWidget(input: {
  payload: Record<string, unknown>;
  fixedNow: string;
  family: "small" | "medium" | "large";
  parameter?: string;
  response?: Record<string, unknown>;
}) {
  const fixedNow = new Date(input.fixedNow).getTime();
  let rendered: WidgetResult | undefined;

  class FixedDate extends Date {
    constructor(value?: string | number) {
      super(value === undefined ? fixedNow : value);
    }

    static now() {
      return fixedNow;
    }

    // Match the simulated device's Asia/Shanghai DateFormatter on UTC CI runners.
    getHours() {
      return new Date(this.getTime() + 8 * 60 * 60 * 1000).getUTCHours();
    }

    getMinutes() {
      return this.getUTCMinutes();
    }

    getDay() {
      return new Date(this.getTime() + 8 * 60 * 60 * 1000).getUTCDay();
    }
  }

  class ListWidget extends TextContainer {}

  class Request {
    timeoutInterval = 0;
    constructor(_endpoint: string) {}
    async loadJSON() {
      return input.response ?? { code: 0, data: input.payload };
    }
  }

  class DateFormatter {
    locale = "";
    dateFormat = "";
    string(date: Date) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    }
  }

  class Size {
    constructor(public width: number, public height: number) {}
  }

  const source = buildScriptableWidgetScript("https://example.test/widget");
  await vm.runInNewContext(`(async () => { ${source} })()`, {
    Date: FixedDate,
    DateFormatter,
    Request,
    ListWidget,
    Size,
    Color: class Color {
      constructor(_value: string) {}
      static dynamic(light: unknown) { return light; }
    },
    Font: {
      boldSystemFont: () => ({}),
      mediumSystemFont: () => ({}),
      semiboldSystemFont: () => ({}),
      systemFont: () => ({}),
    },
    config: { widgetFamily: input.family, runsInWidget: true },
    args: { widgetParameter: input.parameter || "" },
    Script: {
      setWidget(widget: WidgetResult) { rendered = widget; },
      complete() {},
    },
  });

  assert.ok(rendered);
  return rendered;
}

function course(name: string, startTime: string, endTime: string, startSlot?: number, endSlot?: number): Course {
  return { name, location: "B201", teacher: "老师", startTime, endTime, startSlot, endSlot };
}

test("the existing copied script renders Monday from the shared server payload without changes", async () => {
  const fixedNow = "2026-09-06T04:00:00Z";
  const semester = "2026-2027-1";
  const calendar = { currentSemester: semester, weeks: [
    { week: 1, days: ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"] },
    { week: 2, days: ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"] },
  ] };
  const nextWeek = { currentSemester: semester, cells: [{ day: 1, bigSlot: 1, courses: [{
    name: "共享接口的周一课程", weeks: "2周", startSlot: 1, endSlot: 2,
  }] }] };
  const payload = buildScheduleWidgetPayload({ currentSemester: semester, cells: [] }, calendar, "", new Date(fixedNow), { 2: nextWeek });
  const rendered = await runWidget({ payload, fixedNow, family: "large", parameter: "twoday" });
  assert.ok(rendered.texts.includes("共享接口的周一课程"));
  assert.ok(rendered.texts.includes("9.7"));
});

test("the existing copied script reports an API failure instead of claiming no classes", async () => {
  const rendered = await runWidget({
    payload: {}, fixedNow: "2026-09-06T04:00:00Z", family: "large", parameter: "twoday",
    response: { code: 5002, data: null, message: "暂时无法获取课表" },
  });
  assert.ok(rendered.texts.includes("课表读取失败"));
  assert.ok(!rendered.texts.includes("没有课程"));
});

test("Scriptable widget keeps tomorrow's date monotonic at a Sunday boundary", async () => {
  const days = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][index],
    date: `2026-08-${String(24 + index).padStart(2, "0")}`,
    courses: [],
  }));
  const payload = { week: 1, strictDate: true, today: days[6], days };
  const rendered = await runWidget({
    payload,
    fixedNow: "2026-08-30T14:39:00.000Z",
    family: "medium",
    parameter: "split",
  });

  assert.ok(rendered.texts.includes("8.31"));
  assert.ok(rendered.texts.includes("周一"));
  assert.ok(!rendered.texts.includes("8.24"));
});

test("Scriptable upcoming style removes courses that have already ended", async () => {
  const today = {
    day: 1,
    label: "周一",
    date: "2026-08-31",
    courses: [
      course("已结束课程", "08:00", "08:50"),
      course("正在上课", "08:55", "09:40"),
      course("下一节课", "09:55", "10:40"),
    ],
  };
  const rendered = await runWidget({
    payload: { week: 1, strictDate: true, today, days: [today] },
    fixedNow: "2026-08-31T01:00:00.000Z",
    family: "small",
    parameter: "临近课程",
  });

  assert.ok(!rendered.texts.includes("已结束课程"));
  assert.ok(rendered.texts.includes("正在上课"));
  assert.ok(rendered.texts.includes("下一节课"));
});

test("Scriptable parameter exposes today and two-day variants", async () => {
  const today = {
    day: 1,
    label: "周一",
    date: "2026-08-31",
    isToday: true,
    courses: [
      course("高等数学", "08:00", "08:50", 1, 2),
      course("数据库原理", "09:00", "09:50", 3, 4),
      course("工程伦理", "09:55", "11:35", 5, 6),
    ],
  };
  const weekDays = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][index],
    date: index === 0 ? "2026-08-31" : `2026-09-0${index}`,
    isToday: index === 0,
    courses: index === 0
      ? today.courses
      : index === 1
        ? [course("药剂学", "13:30", "15:10", 5, 6)]
        : [],
  }));
  const payload = { week: 1, displayWeek: 1, strictDate: true, today, days: [today], weekDays };

  const medium = await runWidget({ payload, fixedNow: "2026-08-31T00:00:00.000Z", family: "medium", parameter: "今日课程" });
  assert.ok(medium.texts.includes("高等数学 · B201"));
  assert.ok(medium.texts.includes("数据库原理 · B201"));
  assert.ok(medium.texts.includes("工程伦理 · B201"));

  const large = await runWidget({ payload, fixedNow: "2026-08-31T00:00:00.000Z", family: "large", parameter: "今日课程" });
  assert.ok(large.texts.includes("工程伦理"));

  const twoDay = await runWidget({ payload, fixedNow: "2026-08-31T00:00:00.000Z", family: "large" });
  assert.ok(twoDay.texts.includes("药大拾间·课表"));
  assert.ok(twoDay.texts.includes("高等数学"));
  assert.ok(twoDay.texts.includes("药剂学"));
  assert.ok(twoDay.texts.includes("8.31"));
  assert.ok(twoDay.texts.includes("9.1"));
  assert.equal(twoDay.sizes.filter(({ width }) => width === 145).length, 6);

  const removedWeekParameter = await runWidget({ payload, fixedNow: "2026-08-31T00:00:00.000Z", family: "large", parameter: "整周课表" });
  assert.ok(removedWeekParameter.texts.includes("药大拾间·课表"));
  assert.ok(!removedWeekParameter.texts.includes("整周课表"));
});

test("Scriptable medium defaults to the compact full-day timeline", async () => {
  const today = {
    day: 1,
    label: "周一",
    date: "2026-08-31",
    isToday: true,
    courses: [
      course("药物设计学", "08:00", "09:40", 1, 2),
      course("药剂学", "09:55", "11:35", 3, 4),
      course("药物化学", "13:30", "15:10", 5, 6),
      course("医学免疫学", "18:30", "20:10", 9, 10),
    ],
  };
  const rendered = await runWidget({
    payload: { week: 1, strictDate: true, today, days: [today] },
    fixedNow: "2026-08-31T00:00:00.000Z",
    family: "medium",
  });

  assert.ok(rendered.texts.includes("药物设计学 · B201"));
  assert.ok(rendered.texts.includes("医学免疫学 · B201"));
  assert.ok(!rendered.texts.includes("当前"));
  assert.ok(!rendered.texts.includes("接下来"));
});

test("already imported Scriptable variants render Monday's cached courses after an overnight login expiry", async () => {
  const calendar = { currentSemester: "2026-2027-1", currentWeek: 1, weeks: [
    { week: 1, days: ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"] },
    { week: 2, days: ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"] },
  ] };
  const nextWeek = { currentSemester: "2026-2027-1", cells: [
    { day: 1, bigSlot: 1, courses: [{ ...course("药物设计学", "08:00", "09:40", 1, 2), weeks: "2周", weekList: [2] }] },
    { day: 2, bigSlot: 1, courses: [{ ...course("周二课程", "08:00", "09:40", 1, 2), weeks: "2周", weekList: [2] }] },
  ] };
  const original = buildScheduleWidgetPayload({ currentSemester: "2026-2027-1", cells: [] }, calendar, "", new Date("2026-09-06T15:30:00Z"), { 2: nextWeek });
  const fixedNow = "2026-09-06T23:33:00Z";
  const payload = scheduleWidgetFallbackPayload(JSON.stringify(original), "", new Date(fixedNow));
  assert.ok(payload);
  for (const [family, parameter] of [["small", "upcoming"], ["medium", "today"], ["medium", "split"], ["large", "twoday"]] as const) {
    const rendered = await runWidget({ payload, fixedNow, family, parameter });
    assert.ok(rendered.texts.some(text => text.includes("药物设计学")));
    assert.ok(rendered.texts.some(text => text.includes("缓存")));
    assert.ok(!rendered.texts.includes("课表读取失败"));
    assert.ok(!rendered.texts.includes("近期没有课程"));
    if (family === "large") assert.ok(rendered.texts.includes("周二课程"));
  }
});
