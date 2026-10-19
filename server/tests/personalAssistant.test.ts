import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalSystemPrompt, isDataRequestOnly, personalContextSchema, sanitizeClientActions } from "../src/services/personalAssistant";

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
  assert.deepEqual(context.allow, { academic: false, campus: false });
  assert.deepEqual(context.campus, { announcements: [], hot: [] });
  assert.equal(context.app.appearance, "system");
  assert.deepEqual(context.toolResults, []);
  assert.throws(() => personalContextSchema.parse({ ...context, now: "2026-10-19 06:44" }));
  assert.throws(() => personalContextSchema.parse({ ...context, courses: [{ date: "2026-10-19", start: "8:00", end: "09:40", name: "x" }] }));
  assert.throws(() => personalContextSchema.parse({ ...context, agenda: [{ id: "bad id", kind: "todo", title: "x" }] }));
  assert.throws(() => personalContextSchema.parse({ ...context, toolResults: [{ source: "transcript", data: "{}" }] }));
  assert.throws(() => personalContextSchema.parse({ ...context, extra: true }));
});

test("client actions keep well-formed proposals about the user's own items only", () => {
  const actions = sanitizeClientActions([
    { type: "agenda.create", item: { title: "组会", date: "2026-10-23", start: "14:00", end: "15:30", location: "药学楼", remind: 15 } },
    { type: "agenda.create", item: { title: "还没定日期", start: "09:00" } },
    { type: "agenda.create", item: { kind: "event", title: "结束早于开始", date: "2026-10-24", start: "15:00", end: "14:00" } },
    { type: "agenda.complete", id: "abc123def456" },
    { type: "agenda.delete", id: "zzzzzzzzzzzz" },
    { type: "course.remind", minutes: 7 },
    { type: "theme.accent", value: "red" },
    { type: "shell.exec", command: "rm" },
    "not an object",
    { type: "tabs.set", tabs: ["dashboard", "schedule", "dashboard"], launch: "schedule" },
  ], context);
  assert.deepEqual(actions.map((action) => action.type), ["agenda.create", "agenda.create", "agenda.create", "agenda.complete", "tabs.set"]);
  const undated = actions[1];
  assert.equal(undated.type === "agenda.create" ? `${undated.item.kind}|${undated.item.start}` : "?", "event|", "no day means no time");
  const late = actions[2];
  assert.equal(late.type === "agenda.create" ? late.item.end : "?", "", "an end before the start is dropped");
  const tabs = actions[4];
  assert.deepEqual(tabs.type === "tabs.set" ? tabs.tabs : [], ["dashboard", "schedule"]);
  assert.deepEqual(sanitizeClientActions("nope", context), []);
});

test("the app controls are checked field by field", () => {
  const actions = sanitizeClientActions([
    { type: "layout.preset", id: "assistant" },
    { type: "setting.set", key: "pureBlack", value: true },
    { type: "setting.set", key: "rootAccess", value: true },
    { type: "text.size", scale: 2 },
    { type: "today.add", section: "countdown", title: "期末" },
    { type: "today.add", section: "countdown", title: "期末", date: "2027-01-10" },
    { type: "schedule.style", style: "paper" },
    { type: "web.open", path: "//evil.example" },
    { type: "web.open", path: "/search?q=二手自行车" },
    { type: "tabs.set", tabs: ["dashboard"] },
  ], context);
  assert.deepEqual(actions.map((action) => action.type), ["layout.preset", "setting.set", "today.add", "schedule.style", "web.open"]);
});

test("a data request needs permission, asks for new data and comes alone", () => {
  const request = [{ type: "theme.mode", value: "dark" }, { type: "data.request", source: "exams" }];
  assert.deepEqual(sanitizeClientActions(request, context).map((action) => action.type), ["theme.mode"]);
  const allowed = personalContextSchema.parse({ ...context, allow: { academic: true } });
  assert.deepEqual(sanitizeClientActions(request, allowed), [{ type: "data.request", source: "exams", semester: "" }]);
  const fetched = personalContextSchema.parse({ ...context, allow: { academic: true }, toolResults: [{ source: "exams", data: "[]" }] });
  assert.deepEqual(sanitizeClientActions(request, fetched).map((action) => action.type), ["theme.mode"]);
  assert.deepEqual(sanitizeClientActions([{ type: "data.request", source: "grades", semester: "2025" }], allowed), []);
});

test("only a short reply that just asks for data goes uncharged", () => {
  const fetch = { answer: "我去查一下", actions: [], suggestions: [], fallback: false, clientActions: [{ type: "data.request" as const, source: "exams" as const, semester: "" }] };
  assert.equal(isDataRequestOnly(fetch), true);
  assert.equal(isDataRequestOnly({ ...fetch, answer: "很长的回答".repeat(20) }), false);
  assert.equal(isDataRequestOnly({ ...fetch, clientActions: [] }), false);
  assert.equal(isDataRequestOnly({ ...fetch, fallback: true }), false);
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
  assert.ok(prompt.includes("data.request"));
  assert.ok(prompt.includes("kind 一律写 event"));
});
