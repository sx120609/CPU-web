export type ScheduleAdjustmentLike = {
  date: string;
  kind: "off" | "swap";
  source?: string;
};

export function adjustmentForDate(
  adjustments: readonly ScheduleAdjustmentLike[] | null | undefined,
  date: string,
) {
  return (adjustments ?? []).find((item) => item.date === date);
}

/** A swap moves the source day's timetable, so the source is not shown twice. */
export function isMovedSourceDate(
  adjustments: readonly ScheduleAdjustmentLike[] | null | undefined,
  date: string,
) {
  const direct = adjustmentForDate(adjustments, date);
  if (direct) return false;
  return (adjustments ?? []).some((item) => item.kind === "swap" && item.source === date);
}
