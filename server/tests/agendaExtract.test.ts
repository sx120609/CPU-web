import assert from "node:assert/strict";
import test from "node:test";
import { buildAgendaExtractMessages, buildAgendaExtractPrompt, sanitizeAgendaExtract } from "../src/services/agendaExtract";

test("a screenshot goes to the model as a high-detail image next to any pasted text", () => {
  const nowMs = Date.UTC(2026, 10, 8, 8, 30);
  const [system, user] = buildAgendaExtractMessages({ text: "", image: "data:image/png;base64,AAAA", nowMs });
  assert.equal(system.role, "system");
  assert.deepEqual(user.content, [
    { type: "text", text: "请从这张截图里整理日程。" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA", detail: "high" } },
  ]);
  const [, textOnly] = buildAgendaExtractMessages({ text: "11月12日14:00 讲座", image: "", nowMs });
  assert.equal(textOnly.content, "通知文字：\n11月12日14:00 讲座");
});

test("the prompt carries today's date and weekday in Beijing time", () => {
  // 2026-11-08 08:30 UTC is 16:30 on a Sunday in Beijing.
  const prompt = buildAgendaExtractPrompt(Date.UTC(2026, 10, 8, 8, 30));
  assert.match(prompt, /现在是 2026-11-08 16:30（周日，北京时间）/u);
});

test("extracted items keep well-formed fields and fill reminders", () => {
  const result = sanitizeAgendaExtract({
    items: [
      { title: "  药学院 学术讲座 ", date: "2026-11-12", start: "14:00", end: "16:00", location: "药学楼 101", note: "· 带学生证\n· 提前 10 分钟签到", remind: 30 },
      { title: "志愿者报名截止", date: "2026-11-10", start: "18:00", end: "17:00", remind: 7 },
      { title: "交材料", date: "11月20日", start: "09:00", remind: 30 },
      { title: "", date: "2026-11-12" },
      { title: "每周例会", date: "2026-11-11", start: "19:00", repeat: "weekly", remind: 0 },
      { title: "全天活动", date: "2026-11-15", start: "9:00" },
    ],
  });
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.items[0], {
    title: "药学院 学术讲座", date: "2026-11-12", start: "14:00", end: "16:00", location: "药学楼 101",
    note: "· 带学生证\n· 提前 10 分钟签到", remind: 30, repeat: "none",
  });
  // An end before the start is dropped and an unknown reminder falls back to 30 minutes.
  assert.equal(result.items[1].end, "");
  assert.equal(result.items[1].remind, 30);
  // A date the model wrote in words is unknown: no date, no time, no reminder.
  assert.deepEqual([result.items[2].date, result.items[2].start, result.items[2].remind], ["", "", -1]);
  assert.equal(result.items[3].repeat, "weekly");
  assert.equal(result.items[3].remind, 0);
  // A malformed time leaves an all-day item reminded on the day.
  assert.deepEqual([result.items[4].start, result.items[4].remind], ["", 0]);
  assert.equal(result.message, "");
});

test("nothing found comes back with a reason, and at most six items are kept", () => {
  assert.deepEqual(sanitizeAgendaExtract({ items: [], message: "图片里是一张风景照" }), { items: [], message: "图片里是一张风景照", fallback: false });
  assert.equal(sanitizeAgendaExtract(null).message, "没有在里面找到时间和要做的事");
  const many = sanitizeAgendaExtract({ items: Array.from({ length: 9 }, (_, index) => ({ title: `第 ${index + 1} 场`, date: "2026-11-12" })) });
  assert.equal(many.items.length, 6);
});
