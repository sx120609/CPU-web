// 「课表怎么用」: the guide shown once per device, and again from 更多 › 使用指引. Plain values, so the
// rules can be checked without a device.

/** Goes up when the guide says something new; a device that saw an older one is shown it again. */
export const SCHEDULE_GUIDE_VERSION: number = 1;

/**
 * Whether the guide opens by itself: once, on the user's own timetable with its courses on screen and
 * nothing else open. `seen` is the stored version, -1 while it has not been read (and in the
 * acceptance harness, where the guide never opens by itself).
 */
export function scheduleGuideDue(seen: number, hasData: boolean, readOnly: boolean, allowed: boolean,
  sheetOpen: boolean): boolean {
  return seen >= 0 && seen < SCHEDULE_GUIDE_VERSION && hasData && !readOnly && allowed && !sheetOpen;
}

/** The rows, in order. 和 TA 一起看 only for somebody bound to a partner or with a timetable laid over. */
export function scheduleGuideItems(together: boolean): string[] {
  return together ? ['tap', 'style', 'together', 'more'] : ['tap', 'style', 'more'];
}

/** 课表风格's button: `offer` 换回经典 on 简约, `done` once it was pressed, none on any other style. */
export function scheduleGuideStyleAction(style: string, restored: boolean): string {
  return restored ? 'done' : style === 'minimal' ? 'offer' : '';
}

/** 和 TA 一起看's button: `offer` 改回合并 while the week is 并排, `done` once it is 合并. */
export function scheduleGuideLayoutAction(layout: string): string {
  return layout === 'merged' ? 'done' : 'offer';
}
