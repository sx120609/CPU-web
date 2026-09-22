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
