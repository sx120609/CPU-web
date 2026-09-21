// Separate channels prevent the morning end from ending afternoon activities.
export const LIVE_ACTIVITY_WINDOWS = [
  { id: "morning", startHour: 0, endHour: 12 },
  { id: "afternoon", startHour: 12, endHour: 18 },
  { id: "evening", startHour: 18, endHour: 24 },
] as const;
