import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildScriptableWidgetScript } from "../src/views/schedule/scriptableWidget";

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

  constructor(texts: string[] = []) {
    this.texts = texts;
  }

  addText(value: string) {
    this.texts.push(String(value));
    return {};
  }

  addSpacer() {}
  setPadding() {}
  layoutHorizontally() {}
  layoutVertically() {}
  centerAlignContent() {}

  addStack() {
    return new TextContainer(this.texts);
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
  }

  class ListWidget extends TextContainer {}

  class Request {
    timeoutInterval = 0;
    constructor(_endpoint: string) {}
    async loadJSON() {
      return { code: 0, data: input.payload };
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
  assert.ok(twoDay.texts.includes("两日课表"));
  assert.ok(twoDay.texts.includes("高等数学"));
  assert.ok(twoDay.texts.includes("药剂学"));
  assert.ok(twoDay.texts.includes("8.31"));
  assert.ok(twoDay.texts.includes("9.1"));

  const removedWeekParameter = await runWidget({ payload, fixedNow: "2026-08-31T00:00:00.000Z", family: "large", parameter: "整周课表" });
  assert.ok(removedWeekParameter.texts.includes("两日课表"));
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
