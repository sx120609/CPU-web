import type { PlacedCourseBlock } from "./displayPriority";

/**
 * 自己的课表里同一时段排了两门课。多半是教务数据有误（停开的课没撤、调课后旧的一条还在），
 * 所以第一次看到时提醒一下：先去教务系统核对，确有问题再在这里编辑或删除。
 */
export interface OverlapNotice {
  /** 1 是周一，7 是周日。 */
  day: number;
  startSlot: number;
  endSlot: number;
  /** 撞在一起的课程名，按开始节次排，不重复。 */
  names: string[];
}

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const STORAGE_KEY = "cpu-schedule-overlap-notice-v1";
const MAX_REMEMBERED = 40;

/**
 * 这一周里第一处并排显示的课（已经设了优先显示、一门盖住另一门的不算，那是用户处理过的）。
 * 没有就返回 null。
 */
export function findOverlapNotice(pieces: PlacedCourseBlock[]): OverlapNotice | null {
  const side = pieces
    .filter((piece) => piece.lanes > 1)
    .sort((a, b) => a.block.day - b.block.day || a.startSlot - b.startSlot || a.lane - b.lane);
  const first = side[0];
  if (!first) return null;
  // 同一天、和第一门直接或间接连在一起的那一簇。
  const cluster = [first];
  let end = first.endSlot;
  for (const piece of side.slice(1)) {
    if (piece.block.day !== first.block.day || piece.startSlot > end) continue;
    cluster.push(piece);
    end = Math.max(end, piece.endSlot);
  }
  const names = [...new Set(cluster.map((piece) => piece.block.course.name))];
  if (names.length < 2) return null;
  return { day: first.block.day, startSlot: first.startSlot, endSlot: end, names };
}

/** 同一处重叠只提醒一次：学期、星期和课程名相同就算同一处。 */
export function overlapNoticeKey(semester: string, notice: OverlapNotice) {
  return `${semester}|${notice.day}|${[...notice.names].sort().join("/")}`;
}

export function overlapNoticeText(notice: OverlapNotice) {
  const slots = notice.startSlot === notice.endSlot ? `第 ${notice.startSlot} 节` : `第 ${notice.startSlot}–${notice.endSlot} 节`;
  const names = notice.names.slice(0, 3).map((name) => `「${name}」`).join("、") + (notice.names.length > 3 ? " 等" : "");
  return `${WEEKDAYS[notice.day - 1] ?? ""}${slots}同时排了 ${names}。这通常是教务系统的数据有误，建议先到教务系统核对原始课表；`
    + "确认哪一门不该在这里以后，点这门课就可以编辑或删除。";
}

export function overlapNoticeSeen(key: string) {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as string[]).includes(key);
  } catch {
    return false;
  }
}

export function rememberOverlapNotice(key: string) {
  try {
    const seen = (JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as string[]).filter((item) => item !== key);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen, key].slice(-MAX_REMEMBERED)));
  } catch {
    /* 存不下来就每次都提醒，不影响课表 */
  }
}
