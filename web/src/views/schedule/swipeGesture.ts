export type SwipeIntent = "pending" | "horizontal" | "vertical";

const HORIZONTAL_INTENT_DISTANCE = 3;
const VERTICAL_INTENT_DISTANCE = 8;

export function resolveSwipeIntent(
  deltaX: number,
  deltaY: number,
  current: SwipeIntent = "pending",
): SwipeIntent {
  if (current !== "pending") return current;

  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  // Mobile swipes are rarely perfectly horizontal. Bias the initial lock toward
  // week switching so a small vertical wobble does not hand the gesture to the
  // scroll container before the carousel can react.
  if (absX >= HORIZONTAL_INTENT_DISTANCE && absX >= absY * 0.5) return "horizontal";
  if (absY >= VERTICAL_INTENT_DISTANCE && absY > absX * 1.8) return "vertical";
  return "pending";
}
