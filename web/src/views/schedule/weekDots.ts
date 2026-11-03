// 周次选择里的点阵：每周画一张 7 列（周一到周日）× 6 行（每两节一行）的小图，有课的位置点亮，
// 一眼看出哪几周课多、哪几周已经结课。不碰课表数据，只读已经按周解析好的课程块。
import type { WeekCourseBlock } from "./types";

export const WEEK_DOT_DAYS = 7;
/** 1-2、3-4、5-6、7-8、9-10、11-12 节各一行。 */
export const WEEK_DOT_ROWS = 6;

/** `rows[行][列]`，列 0 是周一。 */
export type WeekDotMatrix = boolean[][];

export function emptyWeekDots(): WeekDotMatrix {
  return Array.from({ length: WEEK_DOT_ROWS }, () => Array<boolean>(WEEK_DOT_DAYS).fill(false));
}

export function weekDotMatrix(blocks: readonly Pick<WeekCourseBlock, "day" | "startSlot" | "endSlot">[]): WeekDotMatrix {
  const rows = emptyWeekDots();
  for (const block of blocks) {
    const column = block.day - 1;
    if (column < 0 || column >= WEEK_DOT_DAYS) continue;
    const start = Math.max(1, Math.min(block.startSlot, block.endSlot));
    const end = Math.max(block.startSlot, block.endSlot);
    for (let slot = start; slot <= end; slot += 1) {
      const row = Math.floor((slot - 1) / 2);
      if (row >= WEEK_DOT_ROWS) break;
      rows[row][column] = true;
    }
  }
  return rows;
}

export function weekDotCount(matrix: WeekDotMatrix) {
  return matrix.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
}
