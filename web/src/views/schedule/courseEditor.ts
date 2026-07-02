import {
  courseEditKey,
  createCustomCourseId,
  customCourseWeeksLabel,
  customCourseWeeksText,
  noteFromCourse,
  type CustomScheduleItem,
  type ScheduleEditState,
} from "@/utils/scheduleEdits";
import { normalizedCourseWeekList } from "@/utils/scheduleWeeks";
import { MAX_SMALL_SLOT, clampSlot } from "@/views/schedule/slots";
import type { ScheduleCourse, ScheduleResult, WeekCourseBlock } from "@/views/schedule/types";

export type CourseEditAction = "" | "save" | "delete" | "restore" | "restoreHidden";

export type CustomCourseForm = {
  name: string;
  day: number;
  startSlot: number;
  endSlot: number;
  weekMode: "current" | "all" | "custom";
  weekList: number[];
  weekText: string;
  location: string;
  teacher: string;
  note: string;
};

export type CourseFamilyKeyResolver = (day: number, bigSlot: number, course: ScheduleCourse) => string;
export type CourseFamilySourceKeysResolver = (day: number, bigSlot: number, course: ScheduleCourse) => Set<string>;

export function createCustomCourseForm(defaultDay: number): CustomCourseForm {
  return {
    name: "",
    day: defaultDay,
    startSlot: 1,
    endSlot: 2,
    weekMode: "current",
    weekList: [],
    weekText: "",
    location: "",
    teacher: "",
    note: "",
  };
}

export function fillFormForNewCourse(
  form: CustomCourseForm,
  input: {
    day: number;
    slot: number;
    targetWeek: string | number;
    activeWeekNumber: number;
    currentWeek: string | number;
  },
) {
  const startSlot = clampSlot(input.slot);
  form.name = "";
  form.day = input.day;
  form.startSlot = startSlot;
  form.endSlot = Math.min(MAX_SMALL_SLOT, startSlot + 1);
  form.weekMode = "current";
  form.weekList = [Number(input.targetWeek || input.activeWeekNumber || input.currentWeek || 1)].filter(Boolean);
  form.weekText = customCourseWeeksText(form.weekList);
  form.location = "";
  form.teacher = "";
  form.note = "";
}

export function fillFormForExistingCourse(
  form: CustomCourseForm,
  block: WeekCourseBlock,
  input: {
    editingWeekValue: string | number;
    activeWeekNumber: number;
    currentWeek: string | number;
    weekNumberOptions: number[];
  },
) {
  form.name = block.course.name;
  form.day = block.day;
  form.startSlot = block.startSlot;
  form.endSlot = block.endSlot;
  form.location = block.course.location || "";
  form.teacher = block.course.teacher || "";
  form.note = noteFromCourse(block.course);
  setFormWeeksFromCourse(form, block.course, input);
}

export function customCourseWeekList(
  form: CustomCourseForm,
  input: {
    editingWeekValue: string | number;
    activeWeekNumber: number;
    currentWeek: string | number;
    weekNumberOptions: number[];
  },
) {
  if (form.weekMode === "all") return input.weekNumberOptions;
  if (form.weekMode === "custom") {
    return [...new Set(form.weekList.map(Number).filter(Boolean))].sort((a, b) => a - b);
  }
  return [Number(input.editingWeekValue || input.activeWeekNumber || input.currentWeek) || 1];
}

export function toggleCustomCourseWeek(form: CustomCourseForm, weekNo: number) {
  const set = new Set(form.weekList);
  if (set.has(weekNo)) set.delete(weekNo);
  else set.add(weekNo);
  form.weekList = [...set].sort((a, b) => a - b);
  form.weekText = customCourseWeeksText(form.weekList);
}

export function buildCustomCourseItem(
  form: CustomCourseForm,
  input: {
    weekList: number[];
    existing?: CustomScheduleItem | null;
    editingCourseKey?: string;
  },
) {
  const name = form.name.trim();
  const startSlot = clampSlot(form.startSlot);
  const endSlot = Math.max(startSlot, clampSlot(form.endSlot));
  const item: CustomScheduleItem = {
    id: input.existing?.id || createCustomCourseId(),
    sourceKey: input.existing?.sourceKey || input.editingCourseKey || undefined,
    day: form.day,
    bigSlot: Math.ceil(startSlot / 2),
    course: {
      name,
      teacher: form.teacher.trim() || undefined,
      location: form.location.trim() || undefined,
      weeks: customCourseWeeksLabel(input.weekList),
      weekList: input.weekList,
      startSlot,
      endSlot,
      slotNote: form.note.trim() || `第 ${startSlot}-${endSlot} 节`,
    },
  };
  return { item, startSlot, endSlot };
}

export function saveCustomCourseEdit(
  edits: ScheduleEditState,
  item: CustomScheduleItem,
  input: {
    editingBlock: WeekCourseBlock | null;
    editingCourseKey: string;
    courseFamilyKey: CourseFamilyKeyResolver;
    courseFamilySourceKeys: CourseFamilySourceKeysResolver;
  },
): ScheduleEditState {
  const editingBlock = input.editingBlock;
  const editingFamilyKey = editingBlock ? input.courseFamilyKey(editingBlock.day, editingBlock.bigSlot, editingBlock.course) : "";
  const hiddenSourceKeys = new Set<string>();
  if (editingBlock && !editingBlock.course.customId) {
    for (const key of input.courseFamilySourceKeys(editingBlock.day, editingBlock.bigSlot, editingBlock.course)) {
      hiddenSourceKeys.add(key);
    }
    if (item.sourceKey) hiddenSourceKeys.add(item.sourceKey);
    if (input.editingCourseKey) hiddenSourceKeys.add(input.editingCourseKey);
  }
  const custom = edits.custom.filter((entry) => {
    if (entry.id === item.id) return false;
    if (Boolean(item.sourceKey) && entry.sourceKey === item.sourceKey) return false;
    if (editingFamilyKey && input.courseFamilyKey(entry.day, entry.bigSlot, entry.course) === editingFamilyKey) return false;
    return true;
  });
  const hidden = [...new Set([...edits.hidden, ...hiddenSourceKeys])];
  return { hidden, custom: [...custom, item] };
}

export function deleteCourseEdit(
  edits: ScheduleEditState,
  block: WeekCourseBlock,
  input: {
    editingCourseKey: string;
    courseFamilyKey: CourseFamilyKeyResolver;
    courseFamilySourceKeys: CourseFamilySourceKeysResolver;
  },
): ScheduleEditState {
  const targetFamilyKey = input.courseFamilyKey(block.day, block.bigSlot, block.course);
  const hiddenKeysToRemove = input.courseFamilySourceKeys(block.day, block.bigSlot, block.course);
  hiddenKeysToRemove.add(input.editingCourseKey || courseEditKey(block.day, block.bigSlot, block.course));
  if (block.course.customId) {
    return {
      ...edits,
      custom: edits.custom.filter((item) => input.courseFamilyKey(item.day, item.bigSlot, item.course) !== targetFamilyKey),
    };
  }
  return {
    hidden: [...new Set([...edits.hidden, ...hiddenKeysToRemove])],
    custom: edits.custom.filter((item) => input.courseFamilyKey(item.day, item.bigSlot, item.course) !== targetFamilyKey),
  };
}

export function restoreOriginalCourseEdit(
  edits: ScheduleEditState,
  block: WeekCourseBlock,
  input: {
    sourceKey: string;
    customId?: string;
    courseFamilyKey: CourseFamilyKeyResolver;
    courseFamilySourceKeys: CourseFamilySourceKeysResolver;
  },
): ScheduleEditState {
  const keysToRestore = input.courseFamilySourceKeys(block.day, block.bigSlot, block.course);
  keysToRestore.add(input.sourceKey);
  const familyKey = input.courseFamilyKey(block.day, block.bigSlot, block.course);
  return {
    hidden: edits.hidden.filter((key) => !keysToRestore.has(key)),
    custom: edits.custom.filter((item) => (
      item.id !== input.customId &&
      item.sourceKey !== input.sourceKey &&
      (!familyKey || input.courseFamilyKey(item.day, item.bigSlot, item.course) !== familyKey)
    )),
  };
}

export function restoreHiddenCourseEdit(
  edits: ScheduleEditState,
  input: {
    key: string;
    sources: ScheduleResult[];
    courseFamilyKey: CourseFamilyKeyResolver;
  },
): ScheduleEditState {
  const keysToRestore = new Set<string>();
  for (const source of input.sources) {
    for (const cell of source.cells ?? []) {
      for (const course of cell.courses ?? []) {
        const sourceKey = courseEditKey(cell.day, cell.bigSlot, course);
        if (sourceKey === input.key || input.courseFamilyKey(cell.day, cell.bigSlot, course) === input.key) {
          keysToRestore.add(sourceKey);
        }
      }
    }
  }
  keysToRestore.add(input.key);
  return {
    ...edits,
    hidden: edits.hidden.filter((item) => !keysToRestore.has(item)),
  };
}

function setFormWeeksFromCourse(
  form: CustomCourseForm,
  course: ScheduleCourse,
  input: {
    editingWeekValue: string | number;
    activeWeekNumber: number;
    currentWeek: string | number;
    weekNumberOptions: number[];
  },
) {
  const list = normalizedCourseWeekList(course);
  const all = input.weekNumberOptions;
  const current = Number(input.editingWeekValue || input.activeWeekNumber || input.currentWeek || 1);
  if (!list.length || (all.length > 0 && list.length === all.length && all.every((w) => list.includes(w)))) {
    form.weekMode = "all";
    form.weekList = [...all];
    form.weekText = customCourseWeeksText(form.weekList);
    return;
  }
  if (list.length === 1 && list[0] === current) {
    form.weekMode = "current";
    form.weekList = list;
    form.weekText = customCourseWeeksText(list);
    return;
  }
  form.weekMode = "custom";
  form.weekList = list;
  form.weekText = customCourseWeeksText(list);
}
