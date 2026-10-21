import test from "node:test";
import assert from "node:assert/strict";
import {
  agendaEpoch,
  agendaGridOffset,
  agendaOccursOn,
  agendaOn,
  agendaOpen,
  agendaReminders,
  agendaWithDone,
  normalizeAgendaItem,
  parseAgendaText,
  type AgendaItem,
} from "../src/shared/agenda";

// 与 NEXT 的 AgendaTest.kt 同一组例子：2026-10-19（周一）06:44，上海时间。
const now = agendaEpoch("2026-10-19", 6 * 60 + 44);

function item(fields: Partial<AgendaItem>): AgendaItem {
  return normalizeAgendaItem({ id: "abcdef123456", kind: "event", title: "事", ...fields })!;
}

test("normalizing keeps items showable and drops the rest", () => {
  assert.equal(item({ title: "没有日期", start: "09:00" }).start, "");
  const todo = item({ title: "  买   牛奶 ", remind: 15, repeat: "daily" });
  assert.equal(todo.title, "买 牛奶");
  assert.equal(todo.remind, -1);
  assert.equal(todo.repeat, "none");
  const event = item({ date: "2026-10-19", start: "15:00", end: "14:00", until: "2026-10-01", repeat: "weekly" });
  assert.equal(event.end, "");
  assert.equal(event.until, "");
  assert.equal(normalizeAgendaItem({ id: "x", title: "短 id" }), null);
  assert.equal(normalizeAgendaItem({ id: "abcdef123456", title: "   " }), null);
  assert.equal(item({ date: "2026-02-30" }).date, "");
});

test("repeats follow their rule and end date", () => {
  const weekly = item({ title: "羽毛球", date: "2026-10-21", start: "19:00", repeat: "weekly", until: "2026-11-04" });
  assert.equal(agendaOccursOn(weekly, "2026-10-28"), true);
  assert.equal(agendaOccursOn(weekly, "2026-10-29"), false);
  assert.equal(agendaOccursOn(weekly, "2026-11-11"), false);
  assert.equal(agendaOccursOn(weekly, "2026-10-14"), false);
  const weekdays = { ...weekly, repeat: "weekdays" as const, until: "" };
  assert.equal(agendaOccursOn(weekdays, "2026-10-23"), true);
  assert.equal(agendaOccursOn(weekdays, "2026-10-24"), false);
  const monthly = { ...weekly, date: "2026-01-31", repeat: "monthly" as const, until: "" };
  assert.equal(agendaOccursOn(monthly, "2026-02-28"), false);
  assert.equal(agendaOccursOn(monthly, "2026-03-31"), true);
});

test("reminders fire before each open occurrence, with NEXT's keys", () => {
  const event = item({ title: "组会", date: "2026-10-19", start: "15:00", remind: 15 });
  const [first] = agendaReminders([event], now, now + 30 * 86_400_000);
  assert.equal(first.at, agendaEpoch("2026-10-19", 14 * 60 + 45));
  assert.equal(first.key, "agenda:abcdef123456:2026-10-19");
  assert.equal(first.title, "日程提醒 · 组会");
  assert.equal(first.text, "15:00");
  assert.deepEqual(agendaReminders([event], agendaEpoch("2026-10-19", 14 * 60 + 50), now + 86_400_000), []);
  const untimed = item({ kind: "todo", title: "交表", date: "2026-10-20", remind: 1440 });
  assert.equal(agendaReminders([untimed], now, now + 86_400_000)[0].at, agendaEpoch("2026-10-19", 8 * 60));
  const daily = item({ title: "背单词", date: "2026-10-01", start: "07:00", remind: 0, repeat: "daily", doneDates: ["2026-10-19"] });
  const dailyDays = agendaReminders([daily], now, now + 3 * 86_400_000).map((reminder) => reminder.date);
  // The window ends at 06:44 on the 22nd, before that day's 07:00.
  assert.deepEqual(dailyDays, ["2026-10-20", "2026-10-21"]);
  assert.deepEqual(agendaReminders([{ ...event, remind: -1 }], now, now + 86_400_000), []);
  assert.deepEqual(agendaReminders([{ ...event, done: true }], now, now + 86_400_000), []);
  const tomorrow = agendaReminders([item({ title: "体检", date: "2026-10-20", start: "09:00", end: "10:00", location: "校医院", remind: 60 })], now, now + 2 * 86_400_000);
  assert.equal(tomorrow[0].text, "明天 · 09:00–10:00 · 校医院");
});

test("a day lists all-day items first, ticks repeat by day and orders open to-dos", () => {
  const items = [
    item({ id: "evening00001", title: "晚课", date: "2026-10-19", start: "19:00", createdAt: 1 }),
    item({ id: "allday000001", title: "交表", date: "2026-10-19", createdAt: 2 }),
    item({ id: "undated00001", title: "买牛奶", createdAt: 3 }),
    item({ id: "overdue00001", title: "还书", date: "2026-10-17", createdAt: 4 }),
    item({ id: "repeat000001", title: "背单词", date: "2026-10-01", start: "07:00", repeat: "daily", createdAt: 5 }),
  ];
  assert.deepEqual(agendaOn(items, "2026-10-19").map((entry) => entry.item.id), ["allday000001", "repeat000001", "evening00001"]);
  assert.deepEqual(agendaOpen(items, "2026-10-19").map((entry) => entry.id), ["overdue00001", "undated00001"]);
  const ticked = agendaWithDone(items[4], "2026-10-19", true);
  assert.deepEqual(ticked.doneDates, ["2026-10-19"]);
  assert.equal(agendaOn([ticked], "2026-10-19")[0].done, true);
  assert.equal(agendaOn([ticked], "2026-10-20")[0].done, false);
  assert.equal(agendaWithDone(items[1], "2026-10-19", true).done, true);
});

test("timetable grids place items by their clock time", () => {
  // 上午两节中间有课间，然后午休，下午一节；每节 50 高，间隙 4。
  const periods = [{ start: "08:00", end: "08:45" }, { start: "08:55", end: "09:40" }, { start: "13:30", end: "14:15" }];
  const y = (time: string) => agendaGridOffset(Number(time.slice(0, 2)) * 60 + Number(time.slice(3)), periods, 50, 4);
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} ≠ ${expected}`);
  close(y("07:00"), 0);
  close(y("08:00"), 0);
  close(y("08:22"), 50 * 22 / 45);
  close(y("08:45"), 50);
  close(y("08:50"), 52);
  close(y("08:55"), 54);
  close(y("09:40"), 104);
  close(y("13:30"), 108);
  close(y("14:15"), 158);
  close(y("22:00"), 158);
});

test("quick notes become items", () => {
  const parse = (text: string) => parseAgendaText(text, now);
  let result = parse("明天下午3点 实验报告");
  assert.deepEqual([result.title, result.date, result.start, result.kind], ["实验报告", "2026-10-20", "15:00", "event"]);
  result = parse("周五 14:00-15:30 组会 @药学楼302");
  assert.deepEqual([result.title, result.date, result.start, result.end, result.location], ["组会", "2026-10-23", "14:00", "15:30", "药学楼302"]);
  result = parse("每周三晚上7点 羽毛球");
  assert.deepEqual([result.repeat, result.date, result.start, result.title], ["weekly", "2026-10-21", "19:00", "羽毛球"]);
  result = parse("提醒我明早八点半取快递");
  assert.deepEqual([result.title, result.date, result.start, result.remind, result.kind], ["取快递", "2026-10-20", "08:30", 0, "todo"]);
  result = parse("10月25日 交论文 提前1天提醒");
  assert.deepEqual([result.title, result.date, result.remind, result.kind], ["交论文", "2026-10-25", 1440, "todo"]);
  result = parse("下周一 体检");
  assert.deepEqual([result.date, result.start, result.kind], ["2026-10-26", "", "event"]);
  result = parse("买牛奶");
  assert.deepEqual([result.title, result.date, result.kind], ["买牛奶", "", "todo"]);
  // 今天已经过去的时刻算明天；只说 3 点是下午。
  assert.equal(parse("6点 跑步").start, "18:00");
  assert.equal(parse("6点 跑步").date, "2026-10-19");
  assert.equal(parse("早上6点 跑步").date, "2026-10-20");
  assert.equal(parse("3点 开会").date, "2026-10-19");
  assert.equal(parse("3点 开会").start, "15:00");
  assert.equal(parse("凌晨2点 看流星").date, "2026-10-20");
  assert.equal(parse("凌晨2点 看流星").start, "02:00");
  assert.ok(parse("").title);
  // 不用后行断言也要守住：时间里的 12:30 不是日期，「10月25号」的 25 号不算两次。
  assert.equal(parse("10/25 交作业").date, "2026-10-25");
  assert.equal(parse("12:30 午饭").date, "2026-10-19");
  assert.equal(parse("25号 交房租").date, "2026-10-25");
});
