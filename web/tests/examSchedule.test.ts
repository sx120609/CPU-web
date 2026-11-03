import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExamIcs,
  examCountdownLabel,
  examIcsFileName,
  examUrgency,
  parseExamTime,
  planExams,
} from "../src/components/jwxt/examSchedule";

test("exam times in the formats the school uses are read into a date and clock range", () => {
  assert.deepEqual(parseExamTime("2026-06-20 09:00-11:00"), { date: "2026-06-20", start: "09:00", end: "11:00" });
  assert.deepEqual(parseExamTime("2026/6/2 9:00~11:30"), { date: "2026-06-02", start: "09:00", end: "11:30" });
  assert.deepEqual(parseExamTime("2026年06月20日 14:00:00--16:00:00"), { date: "2026-06-20", start: "14:00", end: "16:00" });
  assert.deepEqual(parseExamTime("2026-06-20 (星期六) 09:00"), { date: "2026-06-20", start: "09:00", end: null });
  assert.deepEqual(parseExamTime("2026-06-20"), { date: "2026-06-20", start: null, end: null });
  // An end before the start is dropped rather than trusted.
  assert.deepEqual(parseExamTime("2026-06-20 11:00-09:00"), { date: "2026-06-20", start: "11:00", end: null });
  assert.equal(parseExamTime("2026-02-30 09:00-11:00"), null);
  assert.equal(parseExamTime("待定"), null);
  assert.equal(parseExamTime(undefined), null);
});

test("urgency counts calendar days and ends a same-day exam at its finishing time", () => {
  const now = new Date(2026, 5, 20, 10, 0);
  assert.equal(examUrgency(parseExamTime("2026-06-20 09:00-11:00"), now), "today");
  assert.equal(examUrgency(parseExamTime("2026-06-20 08:00-09:30"), now), "ended");
  assert.equal(examUrgency(parseExamTime("2026-06-20"), now), "today");
  assert.equal(examUrgency(parseExamTime("2026-06-21 08:00-09:30"), now), "urgent");
  assert.equal(examUrgency(parseExamTime("2026-06-23 08:00"), now), "urgent");
  assert.equal(examUrgency(parseExamTime("2026-06-24 08:00"), now), "soon");
  assert.equal(examUrgency(parseExamTime("2026-06-27 08:00"), now), "soon");
  assert.equal(examUrgency(parseExamTime("2026-06-28 08:00"), now), "later");
  assert.equal(examUrgency(parseExamTime("2026-06-19 23:00"), now), "ended");
  assert.equal(examUrgency(null, now), "unknown");
});

test("plans put upcoming exams first, then undated ones, then the most recently finished", () => {
  const now = new Date(2026, 5, 20, 10, 0);
  const plans = planExams([
    { courseName: "早考完", examTime: "2026-06-01 09:00-11:00" },
    { courseName: "远", examTime: "2026-07-01 09:00-11:00" },
    { courseName: "待定", examTime: "" },
    { courseName: "近", examTime: "2026-06-21 14:00-16:00" },
    { courseName: "刚考完", examTime: "2026-06-18 09:00-11:00" },
    { courseName: "近但早", examTime: "2026-06-21 08:00-10:00" },
  ], now);
  assert.deepEqual(plans.map((plan) => plan.exam.courseName), ["近但早", "近", "远", "待定", "刚考完", "早考完"]);
  assert.deepEqual(plans.map(examCountdownLabel), ["明天", "明天", "11 天后", "时间待定", "已结束", "已结束"]);
  assert.equal(plans[0].daysLeft, 1);
});

test("the calendar file has one event per dated exam with two reminders", () => {
  const { content, count } = buildExamIcs([
    { courseName: "药理学, 上", courseCode: "YL101", examTime: "2026-06-20 09:00-11:00", location: "A101", seat: "15", examType: "期末" },
    { courseName: "只有日期", examTime: "2026-06-22" },
    { courseName: "只有开始", examTime: "2026-06-23 14:00" },
    { courseName: "待定", examTime: "待定" },
  ], new Date(Date.UTC(2026, 5, 1, 2, 3, 4)));
  const lines = content.split("\r\n");
  assert.equal(count, 3);
  assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 3);
  assert.ok(lines.includes("DTSTART;TZID=Asia/Shanghai:20260620T090000"));
  assert.ok(lines.includes("DTEND;TZID=Asia/Shanghai:20260620T110000"));
  assert.ok(lines.includes("SUMMARY:考试：药理学\\, 上"));
  assert.ok(lines.includes("LOCATION:A101"));
  assert.ok(lines.includes("DESCRIPTION:座位号 15 · 期末"));
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20260622"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20260623"));
  // Only a start time: two hours are assumed.
  assert.ok(lines.includes("DTEND;TZID=Asia/Shanghai:20260623T160000"));
  assert.equal(lines.filter((line) => line === "BEGIN:VALARM").length, 5);
  assert.ok(lines.includes("DTSTAMP:20260601T020304Z"));
  assert.ok(lines.filter((line) => line.startsWith("UID:")).every((line) => /^[\x20-\x7e]+$/u.test(line)));
  assert.equal(examIcsFileName([{ courseName: "药理/学" }]), "药大拾间-考试-药理学.ics");
  assert.equal(examIcsFileName([{ courseName: "a" }, { courseName: "b" }]), "药大拾间-考试安排.ics");
});
