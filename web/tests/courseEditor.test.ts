import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomCourseItem,
  createCustomCourseForm,
  customCourseWeekList,
  fillFormForExistingCourse,
  isOriginalCourseEditUnchanged,
} from "../src/views/schedule/courseEditor";
import type { WeekCourseBlock } from "../src/views/schedule/types";

const allWeeks = Array.from({ length: 24 }, (_, index) => index + 1);
const oddWeeks = allWeeks.filter((week) => week % 2 === 1);
const context = {
  editingWeekValue: 1,
  activeWeekNumber: 1,
  currentWeek: 1,
  weekNumberOptions: allWeeks,
};

function originalBlock(): WeekCourseBlock {
  return {
    day: 5,
    bigSlot: 1,
    startSlot: 1,
    endSlot: 2,
    index: 0,
    course: {
      name: "马克思主义基本原理",
      teacher: "张云婷",
      location: "B301",
      weeks: "1-23周(单)",
      weekList: oddWeeks,
      startSlot: 1,
      endSlot: 2,
      slotNote: "01-02节",
    },
  };
}

function editItem(block = originalBlock()) {
  const form = createCustomCourseForm(block.day);
  fillFormForExistingCourse(form, block, context);
  const weekList = customCourseWeekList(form, context);
  return {
    form,
    item: buildCustomCourseItem(form, {
      weekList,
      editingCourseKey: "source-course-key",
    }).item,
  };
}

test("treats saving an unchanged original odd-week course as a no-op", () => {
  const block = originalBlock();
  const { item } = editItem(block);
  assert.equal(isOriginalCourseEditUnchanged(block, item, allWeeks), true);
});

test("detects changes to every editable course field", () => {
  const cases = [
    (item: ReturnType<typeof editItem>["item"]) => { item.course.name = "大学英语"; },
    (item: ReturnType<typeof editItem>["item"]) => { item.course.teacher = "其他教师"; },
    (item: ReturnType<typeof editItem>["item"]) => { item.course.location = "B203"; },
    (item: ReturnType<typeof editItem>["item"]) => { item.course.slotNote = "临时调课"; },
    (item: ReturnType<typeof editItem>["item"]) => { item.day = 4; },
    (item: ReturnType<typeof editItem>["item"]) => { item.bigSlot = 2; item.course.startSlot = 3; item.course.endSlot = 4; },
    (item: ReturnType<typeof editItem>["item"]) => {
      item.course.weekList = allWeeks.filter((week) => week % 2 === 0);
      item.course.weeks = "第 2、4、6、8、10、12、14、16、18、20、22、24 周";
    },
  ];

  for (const mutate of cases) {
    const block = originalBlock();
    const { item } = editItem(block);
    mutate(item);
    assert.equal(isOriginalCourseEditUnchanged(block, item, allWeeks), false);
  }
});

test("treats an unchanged all-week course as a no-op", () => {
  const block = originalBlock();
  block.course.weeks = "全部周";
  block.course.weekList = [];
  const { item } = editItem(block);
  assert.equal(isOriginalCourseEditUnchanged(block, item, allWeeks), true);
});

test("does not reclassify an existing custom course as an unchanged original", () => {
  const block = originalBlock();
  block.course.customId = "custom-existing";
  block.course.sourceKey = "source-course-key";
  const { item } = editItem(block);
  assert.equal(isOriginalCourseEditUnchanged(block, item, allWeeks), false);
});
