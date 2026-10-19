import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalSystemPrompt, personalContextSchema, sanitizeClientActions } from "../src/services/personalAssistant";

const context = personalContextSchema.parse({
  now: "2026-10-19T06:44",
  week: 4,
  courses: [{ date: "2026-10-19", start: "08:00", end: "09:40", name: "药理学", location: "药学楼 302" }],
  agenda: [{ id: "abc123def456", kind: "todo", title: "交实验报告", date: "2026-10-23", start: "18:00" }],
  unread: 2,
});

test("the personal context fills defaults and refuses malformed dates and times", () => {
  assert.equal(context.agenda[0].repeat, "none");
  assert.equal(context.agenda[0].remind, -1);
  assert.equal(context.courses[0].location, "药学楼 302");
  assert.throws(() => personalContextSchema.parse({ ...context, now: "2026-10-19 06:44" }));
  assert.throws(() => personalContextSchema.parse({ ...context, courses: [{ date: "2026-10-19", start: "8:00", end: "09:40", name: "x" }] }));
  assert.throws(() => personalContextSchema.parse({ ...context, agenda: [{ id: "bad id", kind: "todo", title: "x" }] }));
  assert.throws(() => personalContextSchema.parse({ ...context, extra: true }));
});

test("client actions keep well-formed proposals about the user's own items only", () => {
  const actions = sanitizeClientActions([
    { type: "agenda.create", item: { kind: "event", title: "组会", date: "2026-10-23", start: "14:00", end: "15:30", location: "药学楼", remind: 15 } },
    { type: "agenda.create", item: { kind: "event", title: "没有日期的日程" } },
    { type: "agenda.create", item: { kind: "event", title: "结束早于开始", date: "2026-10-24", start: "15:00", end: "14:00" } },
    { type: "agenda.complete", id: "abc123def456" },
    { type: "agenda.delete", id: "zzzzzzzzzzzz" },
    { type: "agenda.update", id: "abc123def456", changes: { start: "17:00" } },
    { type: "course.remind", minutes: 10 },
    { type: "course.remind", minutes: 7 },
    { type: "theme.accent", value: "#1E6FD9" },
    { type: "theme.accent", value: "red" },
    { type: "open", target: "agenda", date: "2026-10-23" },
    { type: "shell.exec", command: "rm" },
    "not an object",
  ], context);
  assert.deepEqual(actions.map((action) => action.type), [
    "agenda.create", "agenda.create", "agenda.complete", "agenda.update", "course.remind", "theme.accent",
  ]);
  const second = actions[1];
  assert.equal(second.type === "agenda.create" ? second.item.end : "?", "", "an end before the start is dropped");
  assert.deepEqual(sanitizeClientActions("nope", context), []);
});

test("the prompt keeps its rules first and the changing personal data last", () => {
  const prompt = buildPersonalSystemPrompt(context, [{ id: "jwxt", label: "教务", description: "成绩与考试" }]);
  const lines = prompt.split("\n");
  assert.ok(lines[0].includes("个人模式"));
  assert.ok(lines.at(-3)?.startsWith("现在是 2026-10-19 06:44（周一"), lines.at(-3));
  assert.ok(lines.at(-3)?.includes("第 4 周"));
  assert.ok(lines.at(-2)?.startsWith("personal={"));
  assert.ok(lines.at(-1)?.startsWith("catalog=["));
  assert.ok(prompt.includes("绝不能说“已经添加"));
});
