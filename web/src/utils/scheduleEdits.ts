export * from "../../../server/src/shared/scheduleEdits";
import { emptyScheduleEdits, type ScheduleEditState, type CustomScheduleItem } from "../../../server/src/shared/scheduleEdits";

const EDIT_KEY_PREFIX = "cpu-schedule-edits-v1";

export function scheduleEditKey(semester?: string | null) {
  return `${EDIT_KEY_PREFIX}:${semester || "current"}`;
}

export function readScheduleEdits(semester?: string | null): ScheduleEditState {
  try {
    const raw = localStorage.getItem(scheduleEditKey(semester));
    if (!raw) return emptyScheduleEdits();
    const parsed = JSON.parse(raw);
    return {
      hidden: Array.isArray(parsed?.hidden) ? parsed.hidden.filter((v: unknown) => typeof v === "string") : [],
      custom: Array.isArray(parsed?.custom) ? parsed.custom.filter(isCustomScheduleItem) : [],
    };
  } catch {
    return emptyScheduleEdits();
  }
}

export function writeScheduleEdits(semester: string | undefined | null, state: ScheduleEditState) {
  try {
    localStorage.setItem(scheduleEditKey(semester), JSON.stringify({
      hidden: Array.from(new Set(state.hidden)),
      custom: state.custom,
    }));
  } catch {
    /* ignore */
  }
}

function isCustomScheduleItem(value: unknown): value is CustomScheduleItem {
  const item = value as CustomScheduleItem;
  return Boolean(
    item &&
    typeof item.id === "string" &&
    (item.sourceKey === undefined || typeof item.sourceKey === "string") &&
    Number.isFinite(item.day) &&
    Number.isFinite(item.bigSlot) &&
    item.course &&
    typeof item.course.name === "string" &&
    Array.isArray(item.course.weekList)
  );
}
