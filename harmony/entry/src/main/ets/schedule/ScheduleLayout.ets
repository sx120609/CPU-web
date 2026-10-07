import { mixScheduleColor, schedulePalette } from './ScheduleVisuals';

// Sizes follow the iOS and Android native timetables (see android ScheduleScreen.kt): a 36 vp date
// row, small grid gaps and 9–10 vp course names. Colours still come from the web palettes.
// The dark values are the neutral greys of the site's dark theme, as on iOS 4.14; course
// colours are unchanged. Dimensions are vp.
export interface ScheduleGridMetrics {
  inset: number;
  axis: number;
  gap: number;
  dayAxis: number;
  dayGap: number;
  header: number;
  weekRow: number;
  dayRow: number;
  courseRadius: number;
  nameSize: number;
  locationSize: number;
}

export function scheduleGridMetrics(width: number, height: number, slotCount: number = 12): ScheduleGridMetrics {
  const narrow = width <= 390;
  const mobile = width <= 760;
  const gap = narrow ? 2 : mobile ? 4 : 5;
  const inset = narrow ? 7 : mobile ? 10 : 12;
  const axis = narrow ? 36 : mobile ? 38 : 44;
  const header = 36;
  const count = Math.max(1, slotCount);
  // Four Chinese characters should fit on one line of a week-view card, so a 360 vp phone
  // gets 9 vp names instead of wrapping every course name after two or three characters.
  const column = (Math.min(width, 720) - 2 * inset - axis - 7 * gap) / 7;
  const nameSize = Math.max(9, Math.min(mobile ? 10 : 11, Math.floor((column - 6) / 4 * 2) / 2));
  return {
    inset,
    axis,
    gap,
    dayAxis: narrow ? 38 : mobile ? 42 : 50,
    dayGap: mobile ? 4 : 5,
    header,
    weekRow: Math.max(narrow ? 38 : mobile ? 42 : 48, (height - header - 16 - (count - 1) * gap) / count),
    dayRow: Math.max(narrow ? 48 : mobile ? 52 : 58, (height - 12 - (count - 1) * (mobile ? 4 : 5)) / count),
    courseRadius: 9,
    nameSize,
    locationSize: nameSize - 1
  };
}

/** `#RRGGBB` with the given opacity, as the `#AARRGGBB` string ArkUI expects. */
export function scheduleTint(color: string, alpha: number): string {
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return '#' + value + color.substring(color.length - 6);
}

/** Track behind the day/week switch and other recessed controls. */
export function scheduleSoftSurface(dark: boolean): string { return dark ? '#B80E1012' : '#E8EDF3'; }

export function scheduleAccent(key: string, dark: boolean): string {
  const palette = schedulePalette(key);
  return dark ? mixScheduleColor(palette.accent, '#FFFFFF', 0.58) : palette.accentStrong;
}

export function scheduleAccentFill(key: string, dark: boolean): string {
  const palette = schedulePalette(key);
  return dark ? '#2E' + palette.accent.substring(1) : palette.accentPale;
}

export function scheduleSurface(dark: boolean, background: boolean = false): string {
  return dark ? (background ? '#9E23272C' : '#F023272C') : (background ? '#99FFFFFF' : '#FFFFFF');
}

export function scheduleCell(dark: boolean, strong: boolean = false): string {
  return dark ? (strong ? '#AD2A2F35' : '#851E2226') : (strong ? '#8FFFFFFF' : '#5CFFFFFF');
}

export function scheduleCellBorder(dark: boolean): string {
  return dark ? '#33B0B7C1' : '#D1DAE3EF';
}

export function scheduleText(dark: boolean): string { return dark ? '#ECEEF1' : '#172033'; }
export function scheduleSecondaryText(dark: boolean): string { return dark ? '#B0B7C1' : '#667085'; }

export function scheduleControlText(key: string, dark: boolean): string {
  return key === 'color-glass' ? (dark ? scheduleText(true) : '#334155') : '#FFFFFF';
}

export function scheduleControlBorder(key: string, dark: boolean): string {
  return key === 'color-glass' ? (dark ? '#6BC4B5FD' : '#387669FF') : scheduleAccent(key, dark);
}

export function scheduleControlGradient(key: string, dark: boolean): Array<[string, number]> {
  if (key !== 'color-glass') {
    const fill = scheduleAccentFill(key, dark);
    return [[fill, 0], [fill, 1]];
  }
  return dark
    ? [['#3DFB7185', 0], ['#33FB923C', 0.24], ['#2E4ADE80', 0.48], ['#3D60A5FA', 0.74], ['#38C4B5FD', 1]]
    : [['#17F43F5E', 0], ['#12F97316', 0.24], ['#1222C55E', 0.48], ['#1A3B82F6', 0.74], ['#178B5CF6', 1]];
}

export function scheduleControlRing(dark: boolean): Array<[string, number]> {
  return dark
    ? [['#EBFB7185', 0], ['#DBFB923C', 0.22], ['#C74ADE80', 0.48], ['#E060A5FA', 0.74], ['#DBC4B5FD', 1]]
    : [['#94F43F5E', 0], ['#80F97316', 0.22], ['#7322C55E', 0.48], ['#8A3B82F6', 0.74], ['#858B5CF6', 1]];
}
