import assert from "node:assert/strict";
import test from "node:test";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)); },
  removeItem: (key: string) => { store.delete(key); },
};

const colors = await import("../src/views/schedule/courseColors");
const style = await import("../src/views/schedule/scheduleStyle");

test("a chosen hue overrides the course colour in every style and is saved on the device", () => {
  const before = style.scheduleStyleCourseColor("药理学", "green");
  colors.setCourseHue(" 药理学 ", 210);
  assert.equal(colors.courseHueOverride("药理学"), 210);
  assert.equal(style.scheduleStyleCourseColor("药理学", "green").hue, 210);
  assert.notEqual(before.hue, 210);
  assert.equal(style.classicCourseTone("药理学", "green", false).text, style.hueCourseTone(210, false).text);
  assert.deepEqual(JSON.parse(store.get(colors.COURSE_COLOR_STORAGE_KEY) ?? "{}"), { "药理学": 210 });
  colors.setCourseHue("药理学", null);
  assert.equal(colors.courseHueOverride("药理学"), null);
  assert.equal(store.has(colors.COURSE_COLOR_STORAGE_KEY), false);
});

test("one-tap assignment spreads distinct hues and is stable for the same courses", () => {
  const names = ["药理学", "有机化学", "高等数学", "大学英语", "体育", "药理学"];
  const first = colors.spreadCourseHues(names);
  assert.equal(Object.keys(first).length, 5);
  assert.equal(new Set(Object.values(first)).size, 5);
  assert.deepEqual(colors.spreadCourseHues([...names].reverse()), first);
  assert.equal(colors.assignCourseHues(names), 5);
  assert.ok(colors.hasCourseColorOverrides());
  colors.clearCourseHues();
  assert.equal(colors.hasCourseColorOverrides(), false);
});
