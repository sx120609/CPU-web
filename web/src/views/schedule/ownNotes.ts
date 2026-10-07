// 自己添加或修改的课程可以写备注。把连续节次合并成一块时，课程块上的备注会被换成
// 节次范围（「06-07节」），用户写的话就看不到了，编辑后再保存还会被这段文字盖掉。
// 这里按课程的编辑条目把备注放回去，给速览、编辑器和导出用。
//
// 单独放在这个文件里：viewModels.ts 会被打进安卓和鸿蒙的随包课表桥，不在那里改。
import { noteFromCourse, type ScheduleEditState } from "@/utils/scheduleEdits";
import type { WeekCourseBlock } from "./types";

export function withOwnCourseNotes<T extends WeekCourseBlock>(blocks: T[], edits: Pick<ScheduleEditState, "custom">): T[] {
  if (!edits.custom.length) return blocks;
  const notes = new Map<string, string>();
  for (const item of edits.custom) {
    // 只是重复节次的备注（「第 1-2 节」）不算用户写的话。
    const note = noteFromCourse(item.course);
    if (note) notes.set(item.id, note);
  }
  if (!notes.size) return blocks;
  return blocks.map((block) => {
    const note = block.course.customId ? notes.get(block.course.customId) : undefined;
    return note && block.course.slotNote !== note ? { ...block, course: { ...block.course, slotNote: note } } : block;
  });
}
