import type { PlacedCourseBlock } from "./displayPriority";
import type { WeekCourseBlock } from "./types";

/** 新样式周网格里的一天。课程分道、校历解析和编辑都在外面做好，网格只画交给它的东西。 */
export interface StyledDay {
  /** 1 是周一，7 是周日。 */
  day: number;
  /** "10/07"。 */
  dateText: string;
  /** "yyyy-MM-dd"，没有校历时是空字符串。 */
  rawDate: string;
  isToday: boolean;
  /** 这一天被调休时是 "off"（放假）或 "swap"（补班）。 */
  adjustmentKind: "off" | "swap" | null;
  pieces: PlacedCourseBlock[];
  /** 情侣课表：TA 这一天的课，和我的课左右各占半格。 */
  partnerPieces?: PlacedCourseBlock[];
  /** 两人一起上的课（`pieces` 里的标识），占满整格。 */
  sharedIds?: Set<string>;
}

export interface TileTone {
  /** 文字、色条和圆点。 */
  accent: string;
  fill: string;
  border: string;
  /** 反色块上用的强调色。 */
  accentInverse?: string;
}

export type TileOwner = "me" | "ta";

/** 按人配色等场合用来覆盖课程颜色；返回 null 就用样式自己的配色。 */
export type TileToneResolver = (block: WeekCourseBlock, owner: TileOwner, shared: boolean) => TileTone | null;

/** 把排好的一段换成按这一段节次显示的课程块；`source` 仍是完整的原课程。 */
export interface DisplayBlock extends WeekCourseBlock {
  id: string;
  lane: number;
  lanes: number;
  source: WeekCourseBlock;
}

export function displayBlockOf(piece: PlacedCourseBlock): DisplayBlock {
  return {
    ...piece.block,
    startSlot: piece.startSlot,
    endSlot: piece.endSlot,
    id: piece.id,
    lane: piece.lane,
    lanes: piece.lanes,
    source: piece.block,
  };
}
