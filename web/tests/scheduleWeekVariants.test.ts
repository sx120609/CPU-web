// 教务会把同一门课在同几节里按周次拆成几行（比如 1-5 周和 7-16 周）。隐藏或编辑屏幕上的
// 这一块只能影响和它同周上课的那几行，其余周次的课必须留在课表里。
import assert from "node:assert/strict";
import test from "node:test";
import { courseEditKey, type CustomScheduleItem, type ScheduleEditState } from "../src/utils/scheduleEdits";
import { arrangementCustomItems } from "../src/views/schedule/arrangements";
import {
  createCustomCourseForm,
  customCourseWeekList,
  deleteCourseEdit,
  fillFormForExistingCourse,
  restoreHiddenCourseEdit,
  restoreOriginalCourseEdit,
  saveCustomCourseEdit,
} from "../src/views/schedule/courseEditor";
import { createScheduleViewModelHelpers } from "../src/views/schedule/viewModels";
import type { ScheduleCourse, ScheduleResult } from "../src/views/schedule/types";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const base = { name: "物理化学", teacher: "张三", location: "C201", startSlot: 3, endSlot: 4 };
const early: ScheduleCourse = { ...base, weeks: "1-5周", weekList: range(1, 5) };
const late: ScheduleCourse = { ...base, weeks: "7-16周", weekList: range(7, 16) };

function fixture(courses: ScheduleCourse[] = [early, late], initial: ScheduleEditState = { hidden: [], custom: [] }) {
  const source: ScheduleResult = {
    currentSemester: "2026-2027-1", currentWeek: "3", semesters: [],
    weeks: range(1, 16).map((value) => ({ value: String(value), label: `第${value}周`, current: value === 3 })),
    cells: [{ day: 2, bigSlot: 2, courses }],
  };
  let edits = initial;
  const helpers = createScheduleViewModelHelpers({
    parsed: () => source, calendar: () => null, weeks: () => source.weeks,
    scheduleEdits: () => edits, activeDay: () => 2, currentWeekValue: () => "3",
    scheduleForWeek: () => source, allKnownScheduleSources: () => [source],
  });
  const resolvers = { courseFamilyKey: helpers.courseFamilyKey, courseFamilySourceKeys: helpers.courseFamilySourceKeys };
  const blocks = (week: number) => helpers.weekCourseBlocksFor(week, source);
  const shown = (week: number) => blocks(week).map((block) => `${block.course.name}@${block.course.location ?? ""}`);
  return { source, resolvers, blocks, shown, set: (next: ScheduleEditState) => { edits = next; }, get: () => edits };
}

// 和 Schedule.vue 的 saveCourseEdit 走同一串函数：打开某一周的那一块，改地点后保存。
function editFirstBlock(context: ReturnType<typeof fixture>, week: number, location: string) {
  const block = context.blocks(week)[0];
  const form = createCustomCourseForm(2);
  const weekContext = { editingWeekValue: String(week), activeWeekNumber: week, currentWeek: "3", weekNumberOptions: range(1, 16) };
  fillFormForExistingCourse(form, block, weekContext);
  form.location = location;
  const editingCourseKey = courseEditKey(block.day, block.bigSlot, block.course);
  const [primary] = arrangementCustomItems({
    details: { name: form.name, teacher: form.teacher, location: form.location, note: form.note },
    arrangements: [{ day: form.day, slots: range(form.startSlot, form.endSlot), weekList: customCourseWeekList(form, weekContext) }],
    primaryId: block.course.customId ?? "edited",
    primarySourceKey: block.course.customId ? block.course.sourceKey : editingCourseKey,
  });
  context.set(saveCustomCourseEdit(context.get(), primary, { editingBlock: block, editingCourseKey, ...context.resolvers }));
}

test("editing one week range of a course keeps its other week range on the timetable", () => {
  const context = fixture();
  assert.deepEqual(context.shown(3), ["物理化学@C201"]);
  assert.deepEqual(context.shown(8), ["物理化学@C201"]);

  editFirstBlock(context, 3, "C305");

  assert.deepEqual(context.shown(3), ["物理化学@C305"]);
  assert.deepEqual(context.shown(8), ["物理化学@C201"], "the 7-16 week meetings were not edited and must stay");
  assert.deepEqual(context.get().hidden, [courseEditKey(2, 2, early)]);
});

test("hiding one week range of a course keeps its other week range on the timetable", () => {
  const context = fixture();
  const block = context.blocks(3)[0];
  context.set(deleteCourseEdit(context.get(), block, { editingCourseKey: courseEditKey(block.day, block.bigSlot, block.course), ...context.resolvers }));

  assert.deepEqual(context.shown(3), []);
  assert.deepEqual(context.shown(8), ["物理化学@C201"], "only the block that was on screen was hidden");
});

test("rows of one course that share a week are still hidden together", () => {
  // 教务重复给出的一行：周次是另一行的子集，画出来是叠在一起的同一门课。
  const repeated: ScheduleCourse = { ...base, weeks: "2、4周", weekList: [2, 4] };
  const context = fixture([early, repeated, late]);
  assert.equal(context.shown(2).length, 2);
  const block = context.blocks(2)[0];
  context.set(deleteCourseEdit(context.get(), block, { editingCourseKey: courseEditKey(block.day, block.bigSlot, block.course), ...context.resolvers }));

  assert.deepEqual(context.shown(2), []);
  assert.deepEqual(context.shown(8), ["物理化学@C201"]);
});

test("a course without a week list is hidden together with every week range", () => {
  const always: ScheduleCourse = { ...base, weeks: "", weekList: [] };
  const context = fixture([always, late]);
  const block = context.blocks(3)[0];
  context.set(deleteCourseEdit(context.get(), block, { editingCourseKey: courseEditKey(block.day, block.bigSlot, block.course), ...context.resolvers }));

  assert.deepEqual(context.shown(3), []);
  assert.deepEqual(context.shown(8), []);
});

test("week ranges an older version hid along with an edit come back with the official arrangement", () => {
  // 旧版本保存编辑时把两段周次都隐藏了，个人副本却只有 1-5 周。
  const copy: CustomScheduleItem = {
    id: "edited", sourceKey: courseEditKey(2, 2, early), day: 2, bigSlot: 2,
    course: { ...early, location: "C305" },
  };
  const context = fixture([early, late], { hidden: [courseEditKey(2, 2, early), courseEditKey(2, 2, late)], custom: [copy] });
  assert.deepEqual(context.shown(8), []);

  const block = context.blocks(3)[0];
  context.set(restoreOriginalCourseEdit(context.get(), block, { sourceKey: copy.sourceKey!, customId: copy.id, ...context.resolvers }));

  assert.deepEqual(context.get(), { hidden: [], custom: [] });
  assert.deepEqual(context.shown(3), ["物理化学@C201"]);
  assert.deepEqual(context.shown(8), ["物理化学@C201"]);
});

test("restoring a hidden course from the list brings back every week range of it", () => {
  const context = fixture([early, late], { hidden: [courseEditKey(2, 2, early), courseEditKey(2, 2, late)], custom: [] });
  context.set(restoreHiddenCourseEdit(context.get(), {
    key: context.resolvers.courseFamilyKey(2, 2, early),
    sources: [context.source],
    courseFamilyKey: context.resolvers.courseFamilyKey,
  }));

  assert.deepEqual(context.get().hidden, []);
  assert.deepEqual(context.shown(8), ["物理化学@C201"]);
});

test("a personal course with two week ranges in the same periods keeps the other range", () => {
  const personal = (id: string, course: ScheduleCourse): CustomScheduleItem => ({ id, day: 2, bigSlot: 2, course: { ...course, name: "习题课" } });
  const both = { hidden: [], custom: [personal("first", early), personal("second", late)] };

  const edited = fixture([], both);
  editFirstBlock(edited, 3, "C305");
  assert.deepEqual(edited.shown(3), ["习题课@C305"]);
  assert.deepEqual(edited.shown(8), ["习题课@C201"], "editing weeks 1-5 must not delete weeks 7-16");

  const deleted = fixture([], both);
  const block = deleted.blocks(3)[0];
  deleted.set(deleteCourseEdit(deleted.get(), block, { editingCourseKey: courseEditKey(block.day, block.bigSlot, block.course), ...deleted.resolvers }));
  assert.deepEqual(deleted.shown(3), []);
  assert.deepEqual(deleted.get().custom.map((item) => item.id), ["second"]);
});
