import assert from "node:assert/strict";
import test from "node:test";
import {
  applyScheduleEditsToCells,
  courseEditKey,
  keepScheduleCourseAsCustom,
  normalizeScheduleEditsState,
  scheduleCourseEditLabel,
  type CustomScheduleItem,
  type ScheduleEditState,
} from "../src/utils/scheduleEdits";
import {
  buildCustomCourseItem,
  createCustomCourseForm,
  restoreOriginalCourseEdit,
  saveCustomCourseEdit,
} from "../src/views/schedule/courseEditor";
import { createScheduleViewModelHelpers } from "../src/views/schedule/viewModels";
import type { ScheduleResult, WeekCourseBlock } from "../src/views/schedule/types";

function fixture() {
  const course = {
    name: "化学III：有机化学实验（A）",
    weeks: "第 1-16 周", weekList: Array.from({ length: 16 }, (_, i) => i + 1),
    startSlot: 5, endSlot: 8, location: "实验楼", teacher: "教师",
  };
  const source: ScheduleResult = {
    currentSemester: "2026-2027-1", currentWeek: "1", weeks: [], semesters: [],
    cells: [{ day: 4, bigSlot: 3, courses: [course] }],
  };
  const sourceKey = courseEditKey(4, 3, course);
  const item: CustomScheduleItem = {
    id: "edited-course", sourceKey, day: 4, bigSlot: 3,
    course: { ...course, location: "用户编辑的地点" },
  };
  const edits: ScheduleEditState = { hidden: [sourceKey], custom: [item] };
  const helpers = createScheduleViewModelHelpers({
    parsed: () => source, calendar: () => null, weeks: () => [],
    scheduleEdits: () => edits, activeDay: () => 4, currentWeekValue: () => "1",
    scheduleForWeek: () => source, allKnownScheduleSources: () => [source],
  });
  const resolvers = {
    courseFamilyKey: helpers.courseFamilyKey,
    courseFamilySourceKeys: helpers.courseFamilySourceKeys,
  };
  return { course, source, sourceKey, item, edits, helpers, resolvers };
}

test("a hidden official source is still found and its edit remains effective", () => {
  const { source, edits } = fixture();
  const merged = applyScheduleEditsToCells(source.cells, edits);
  assert.equal(merged[0].courses.length, 1);
  assert.equal(merged[0].courses[0].location, "用户编辑的地点");
  assert.equal(merged[0].courses[0].orphaned, false);
  assert.equal(scheduleCourseEditLabel(merged[0].courses[0]), "已编辑");
});

test("issue 9: refreshing a deleted official course retains the edit with an orphan warning", () => {
  const { source, edits } = fixture();
  const before = structuredClone(edits);
  applyScheduleEditsToCells(source.cells, edits);
  for (let refresh = 0; refresh < 2; refresh++) {
    const merged = applyScheduleEditsToCells([], edits);
    assert.equal(merged[0].courses[0].orphaned, true);
    assert.equal(scheduleCourseEditLabel(merged[0].courses[0]), "待核对");
    assert.equal(merged[0].courses[0].name, before.custom[0].course.name);
  }
  assert.deepEqual(edits, before);
});

test("a changed source key is flagged without hiding the latest official course", () => {
  const { source, edits } = fixture();
  source.cells[0].courses[0].teacher = "新教师";
  const courses = applyScheduleEditsToCells(source.cells, edits)[0].courses;
  assert.equal(courses.length, 2);
  assert.equal(courses[0].teacher, "新教师");
  assert.equal(scheduleCourseEditLabel(courses[0]), "");
  assert.equal(courses[1].orphaned, true);
});

test("equivalent week labels and full-width punctuation do not trigger a review or duplicate the source", () => {
  const { source, edits } = fixture();
  source.cells[0].courses[0].name = "化学III: 有机化学实验(A)";
  source.cells[0].courses[0].weeks = "1～16周";
  const before = structuredClone(edits);
  const courses = applyScheduleEditsToCells(source.cells, edits)[0].courses;
  assert.equal(courses.length, 1);
  assert.equal(courses[0].orphaned, false);
  assert.equal(courses[0].location, "用户编辑的地点");
  assert.deepEqual(edits, before);
});

test("the same official course split across adjacent cells still matches its saved merged source", () => {
  const { source, course, edits } = fixture();
  source.cells = [
    { day: 4, bigSlot: 3, courses: [{ ...course, startSlot: 5, endSlot: 6 }] },
    { day: 4, bigSlot: 4, courses: [{ ...course, startSlot: 7, endSlot: 8 }] },
  ];
  const merged = applyScheduleEditsToCells(source.cells, edits);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].courses.length, 1);
  assert.equal(merged[0].courses[0].orphaned, false);
});

test("a partially removed time range still needs review and is not silently rebound", () => {
  const { source, edits } = fixture();
  source.cells[0].courses[0].endSlot = 6;
  const courses = applyScheduleEditsToCells(source.cells, edits)[0].courses;
  assert.equal(courses.length, 2);
  assert.equal(courses[1].orphaned, true);
});

test("a same-name course on another day or with different teacher, location or weeks is not an equivalent source", () => {
  for (const change of [
    (source: ScheduleResult) => { source.cells[0].day = 5; },
    (source: ScheduleResult) => { source.cells[0].courses[0].teacher = "其他教师"; },
    (source: ScheduleResult) => { source.cells[0].courses[0].location = "另一教室"; },
    (source: ScheduleResult) => { source.cells[0].courses[0].weeks = "2-16周(双)"; },
  ]) {
    const { source, edits } = fixture();
    change(source);
    const courses = applyScheduleEditsToCells(source.cells, edits).flatMap((cell) => cell.courses);
    assert.equal(courses.filter((course) => !course.customId).length, 1);
    assert.equal(courses.find((course) => course.customId)?.orphaned, true);
  }
});

test("a missing slot range is equivalent to the original table position", () => {
  const { source, edits, item } = fixture();
  source.cells[0].courses[0].endSlot = 6;
  const originalKey = courseEditKey(4, 3, source.cells[0].courses[0]);
  item.sourceKey = originalKey;
  edits.hidden = [originalKey];
  source.cells[0].courses[0].startSlot = undefined as any;
  source.cells[0].courses[0].endSlot = undefined as any;
  const courses = applyScheduleEditsToCells(source.cells, edits)[0].courses;
  assert.equal(courses.length, 1);
  assert.equal(courses[0].orphaned, false);
});

test("restoring a format-equivalent source shows the current official data after refresh", () => {
  const { source, edits, item, sourceKey, helpers, resolvers } = fixture();
  source.cells[0].courses[0].weeks = "1-16周";
  const block = helpers.weekCourseBlocksFor(1)[0];
  assert.equal(block.course.orphaned, false);
  const restored = restoreOriginalCourseEdit(edits, block, { ...resolvers, sourceKey, customId: item.id });
  const courses = applyScheduleEditsToCells(source.cells, restored)[0].courses;
  assert.equal(courses.length, 1);
  assert.equal(courses[0].customId, undefined);
  assert.equal(courses[0].weeks, "1-16周");
});

test("an unavailable schedule does not claim that an official course was removed", () => {
  const { edits } = fixture();
  const course = applyScheduleEditsToCells(null, edits)[0].courses[0];
  assert.equal(course.orphaned, undefined);
  assert.equal(scheduleCourseEditLabel(course), "已编辑");
});

test("source validation happens before week filtering and supports moved edits", () => {
  const { item, helpers } = fixture();
  item.course.weekList = [17];
  item.course.weeks = "第 17 周";
  item.day = 1;
  item.bigSlot = 1;
  const cells = helpers.cellsForWeek(17);
  assert.equal(cells[0].day, 1);
  assert.equal(cells[0].courses[0].orphaned, false);
});

test("a source reappearing on refresh clears the derived warning", () => {
  const { source, edits } = fixture();
  assert.equal(applyScheduleEditsToCells([], edits)[0].courses[0].orphaned, true);
  assert.equal(applyScheduleEditsToCells(source.cells, edits)[0].courses[0].orphaned, false);
});

test("keeping an orphan as custom preserves content and unrelated edits across persistence", () => {
  const { edits, item, sourceKey } = fixture();
  edits.hidden.push("another-source");
  const other = { ...structuredClone(item), id: "other", sourceKey: "another-source" };
  edits.custom.push(other);
  const before = structuredClone(edits);
  const kept = normalizeScheduleEditsState(JSON.parse(JSON.stringify(keepScheduleCourseAsCustom(edits, item.id))));
  assert.equal(kept.custom.length, 2);
  assert.equal(kept.custom[0].sourceKey, undefined);
  assert.equal(kept.custom[0].course.name, item.course.name);
  assert.deepEqual(kept.custom[0].course.weekList, item.course.weekList);
  assert.equal(kept.custom[1].sourceKey, other.sourceKey);
  assert.deepEqual(kept.hidden, ["another-source"]);
  assert.equal(edits.hidden[0], sourceKey);
  assert.deepEqual(edits, before);
  assert.equal(scheduleCourseEditLabel(applyScheduleEditsToCells([], kept)[0].courses[0]), "自定义");
});

test("saving an independent or retained custom course never invents an official source", () => {
  const { item, edits } = fixture();
  const kept = keepScheduleCourseAsCustom(edits, item.id).custom[0];
  const form = createCustomCourseForm(4);
  form.name = item.course.name;
  const rebuilt = buildCustomCourseItem(form, {
    weekList: [1], existing: kept, editingCourseKey: `custom:${item.id}`,
  });
  assert.equal(rebuilt.item.sourceKey, undefined);
  assert.equal(buildCustomCourseItem(form, {
    weekList: [1], editingCourseKey: "custom:old-course",
  }).item.sourceKey, undefined);
});

test("legacy self-references are normalized as custom courses, not orphaned official edits", () => {
  const { edits, item } = fixture();
  item.sourceKey = `custom:${item.id}`;
  assert.equal(normalizeScheduleEditsState(edits).custom[0].sourceKey, undefined);
  const course = applyScheduleEditsToCells([], edits)[0].courses[0];
  assert.equal(course.orphaned, undefined);
  assert.equal(scheduleCourseEditLabel(course), "自定义");
});

test("restoring an orphan removes its edit and does not resurrect a deleted official course", () => {
  const { source, edits, item, sourceKey, helpers, resolvers } = fixture();
  source.cells = [];
  const block = helpers.weekCourseBlocksFor(1)[0];
  const restored = restoreOriginalCourseEdit(edits, block, { ...resolvers, sourceKey, customId: item.id });
  assert.deepEqual(restored, { hidden: [], custom: [] });
  assert.deepEqual(applyScheduleEditsToCells(source.cells, restored), []);
});

test("restoring a valid source reveals the current official course and preserves other edits", () => {
  const { source, edits, item, sourceKey, helpers, resolvers } = fixture();
  const block = helpers.weekCourseBlocksFor(1)[0];
  const other: CustomScheduleItem = {
    id: "independent", day: 1, bigSlot: 1, course: { name: "自习", weeks: "全部周", weekList: [] },
  };
  edits.custom.push(other);
  const restored = restoreOriginalCourseEdit(edits, block, { ...resolvers, sourceKey, customId: item.id });
  assert.deepEqual(restored.custom, [other]);
  assert.equal(applyScheduleEditsToCells(source.cells, restored)[0].courses[0].location, "实验楼");
});

test("saving an official edit still hides its source", () => {
  const { course, source, item, sourceKey, resolvers } = fixture();
  const block: WeekCourseBlock = { day: 4, bigSlot: 3, startSlot: 5, endSlot: 8, index: 0, course };
  const edits = saveCustomCourseEdit({ hidden: [], custom: [] }, item, {
    ...resolvers, editingBlock: block, editingCourseKey: sourceKey,
  });
  const courses = applyScheduleEditsToCells(source.cells, edits)[0].courses;
  assert.equal(courses.length, 1);
  assert.equal(courses[0].customId, item.id);
  assert.equal(courses[0].orphaned, false);
});

test("day and week blocks retain orphan status and never merge an edit into an official course", () => {
  const { source, item, helpers, edits } = fixture();
  item.course.location = source.cells[0].courses[0].location;
  edits.hidden = [];
  const blocks = helpers.weekCourseBlocksFor(1);
  assert.equal(blocks.length, 2);
  assert.equal(blocks.filter((block) => block.course.customId).length, 1);
  source.cells = [];
  assert.equal(helpers.weekCourseBlocksFor(1)[0].course.orphaned, true);
  assert.equal(helpers.dayCourseBlocksFor(1, 4)[0].course.orphaned, true);
});
