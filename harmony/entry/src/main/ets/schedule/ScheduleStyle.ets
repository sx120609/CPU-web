import { schedulePalette } from './ScheduleVisuals';

// The timetable's visual style, as on iOS (ScheduleStyle.swift). It is independent of the course
// palette and of light/dark: switching it never touches course data, the selected week or editing.
// `classic` is the look this client shipped with and stays the default and the fallback.
export const SCHEDULE_STYLES: string[] = ['classic', 'minimal', 'grid', 'table', 'paper', 'board'];

export interface ScheduleStyleLayout {
  // rows | cells | table | sessions
  grid: string;
  // card | stripe | ink | departure
  course: string;
  cornerRadius: number;
  borderWidth: number;
  centered: boolean;
}

export function normalizeScheduleStyle(value: string): string {
  return SCHEDULE_STYLES.includes(value) ? value : 'classic';
}

export function scheduleStyleTitle(style: string): string {
  const titles: string[] = ['经典', '简约', '格子', '表格', '素笺', '站牌'];
  return titles[Math.max(0, SCHEDULE_STYLES.indexOf(style))];
}

export function scheduleStyleSubtitle(style: string): string {
  const subtitles: string[] = ['玻璃格子与彩色卡片，沿用原来的样子', '淡彩卡片，轻松查课', '独立方格，空闲一目了然',
    '整齐行列，集中呈现课程', '纸墨色调，安静阅读', '时间优先，关注下一节'];
  return subtitles[Math.max(0, SCHEDULE_STYLES.indexOf(style))];
}

export function scheduleStyleLayout(style: string): ScheduleStyleLayout {
  if (style === 'minimal') return { grid: 'rows', course: 'card', cornerRadius: 9, borderWidth: 0, centered: false };
  if (style === 'grid') return { grid: 'cells', course: 'card', cornerRadius: 8, borderWidth: 1.5, centered: true };
  if (style === 'table') return { grid: 'table', course: 'stripe', cornerRadius: 0, borderWidth: 0, centered: false };
  if (style === 'paper') return { grid: 'rows', course: 'ink', cornerRadius: 2, borderWidth: 0, centered: false };
  if (style === 'board') return { grid: 'sessions', course: 'departure', cornerRadius: 2, borderWidth: 0, centered: false };
  return { grid: 'cells', course: 'card', cornerRadius: 9, borderWidth: 1.5, centered: true };
}

/** Only minimal and grid keep a gap between day columns; the ruled styles need their columns to touch. */
export function scheduleStyleColumnGap(style: string): number {
  return style === 'minimal' || style === 'grid' ? 4 : 0;
}

/** The table draws its own frame with its rules, and the board is divided by rules alone. */
export function scheduleStyleFramesPanel(style: string): boolean {
  return style !== 'table' && style !== 'board';
}

/** Paper reads in a serif face and the board in a monospaced one; the rest keep the system face. */
export function scheduleStyleFont(style: string): string {
  if (style === 'paper') return 'serif';
  if (style === 'board') return 'monospace';
  return 'HarmonyOS Sans';
}

/**
 * The typeface of running text: course names, rooms, 「第 3–4 节」. The board keeps its monospaced face
 * for times and dates only; set in it, the space between a character and a digit is a full digit wide
 * and the line falls apart.
 */
export function scheduleStyleTextFont(style: string): string {
  return style === 'board' ? 'HarmonyOS Sans' : scheduleStyleFont(style);
}

/** Digits of one width for counts and countdowns in the system face, so a ticking number does not shift the line. */
export const SCHEDULE_TABULAR_DIGITS: string = '"tnum" on';

/** The date in a styled date header. The day strip is a control, so its dates are set a size up from the week header's. */
export function scheduleStyleDateSize(style: string, strip: boolean): number {
  return style === 'paper' || (strip && style !== 'grid') ? 15 : 11;
}

/** 「05」 on the board, like the dates of its month view. */
export function scheduleStyleDateText(style: string, date: string): string {
  return style === 'board' && /^\d+$/.test(date) ? date.padStart(2, '0') : date;
}

function byte(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
}

/** `#RRGGBB` (or `#AARRGGBB`, whose alpha is replaced) at the given opacity. */
export function scheduleAlpha(color: string, alpha: number): string {
  return '#' + byte(Math.max(0, Math.min(1, alpha)) * 255) + color.substring(color.length - 6);
}

function hsl(hue: number, saturation: number, lightness: number, alpha: number = 1): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (offset: number): number => {
    const k = (offset + hue / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return '#' + (alpha >= 1 ? '' : byte(alpha * 255)) + byte(channel(0)) + byte(channel(8)) + byte(channel(4));
}

// ---- Style colours ----

/** Paper and board bring their own page colour; the others keep the page background. Empty when none. */
export function scheduleStyleCanvas(style: string, dark: boolean): string {
  if (style === 'paper') return dark ? '#201E1B' : '#F1ECE2';
  if (style === 'board') return dark ? '#171A1C' : '#F4F5F4';
  return '';
}

export function scheduleStyleInk(style: string, dark: boolean): string {
  if (style === 'paper') return dark ? '#EDE6D8' : '#2A251F';
  if (style === 'board') return dark ? '#FFE4A3' : '#171A1C';
  return dark ? '#ECEEF1' : '#172033';
}

export function scheduleStyleAccent(style: string, dark: boolean, fallback: string): string {
  if (style === 'paper') return dark ? '#F39B85' : '#A63F29';
  if (style === 'board') return dark ? '#FFD477' : '#242C32';
  return fallback;
}

/** Secondary metadata grey: at least 4.5:1 on the canvas and the panel in both appearances. */
export function scheduleMetaText(dark: boolean): string { return dark ? '#98989D' : '#6E6E73'; }

export function scheduleStyleCellSurface(hasBackground: boolean, dark: boolean): string {
  if (hasBackground) return dark ? '#14FFFFFF' : '#8CFFFFFF';
  return dark ? '#0DFFFFFF' : '#FFFFFF';
}

/** The whole week panel. Over a photo it is a thin flat veil; a stronger photo gets more veil. */
export function scheduleStylePanelSurface(hasBackground: boolean, dark: boolean, imageVisibility: number): string {
  if (!hasBackground) return dark ? '#17FFFFFF' : '#F5FFFFFF';
  const veil = 0.14 + 0.32 * Math.min(1, Math.max(0, imageVisibility));
  return scheduleAlpha(dark ? '#000000' : '#FFFFFF', veil);
}

export function scheduleStyleCellBorder(dark: boolean): string { return dark ? '#1FFFFFFF' : '#24242E47'; }

// ---- Theme colour tiers (ThemePalette on iOS) ----
// One brand colour is resolved once per appearance into `text` (text, hairlines and the "now"
// line; at least 4.5:1 on the canvas, the panel and the tinted today column) and `fill` (a solid
// fill that carries white at 4.5:1). Only OKLCH lightness moves, so hue and chroma stay the brand's.

interface Rgb { red: number; green: number; blue: number; }
interface Oklch { lightness: number; chroma: number; hue: number; }
interface ThemeTiers { textLight: string; textDark: string; fill: string; }

function rgbOf(hex: string): Rgb {
  const value = hex.substring(hex.length - 6);
  return { red: parseInt(value.substring(0, 2), 16) / 255, green: parseInt(value.substring(2, 4), 16) / 255,
    blue: parseInt(value.substring(4, 6), 16) / 255 };
}

function hexOf(rgb: Rgb): string {
  return '#' + byte(rgb.red * 255) + byte(rgb.green * 255) + byte(rgb.blue * 255);
}

function linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function encoded(input: number): number {
  const value = Math.min(Math.max(input, 0), 1);
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function luminance(rgb: Rgb): number {
  return 0.2126 * linear(rgb.red) + 0.7152 * linear(rgb.green) + 0.0722 * linear(rgb.blue);
}

function contrastOf(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** WCAG contrast ratio of two `#RRGGBB` colours. */
export function scheduleContrast(first: string, second: string): number {
  return contrastOf(luminance(rgbOf(first)), luminance(rgbOf(second)));
}

function overlaid(base: Rgb, top: Rgb, amount: number): Rgb {
  return { red: base.red + (top.red - base.red) * amount, green: base.green + (top.green - base.green) * amount,
    blue: base.blue + (top.blue - base.blue) * amount };
}

function oklchOf(rgb: Rgb): Oklch {
  const red = linear(rgb.red);
  const green = linear(rgb.green);
  const blue = linear(rgb.blue);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { lightness: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, chroma: Math.sqrt(a * a + b * b),
    hue: Math.atan2(b, a) };
}

function linearRgb(lightness: number, a: number, b: number): Rgb {
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.2914855480 * b, 3);
  return { red: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    green: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    blue: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s };
}

function inGamut(rgb: Rgb): boolean {
  const tolerance = 1e-7;
  return [rgb.red, rgb.green, rgb.blue].every((value: number) => value >= -tolerance && value <= 1 + tolerance);
}

/** Same hue and chroma at `lightness`, with chroma scaled back to the sRGB boundary when needed. */
function rgbAt(color: Oklch, lightness: number): Rgb {
  const a = color.chroma * Math.cos(color.hue);
  const b = color.chroma * Math.sin(color.hue);
  let channels = linearRgb(lightness, a, b);
  if (!inGamut(channels)) {
    let inside = 0;
    let outside = 1;
    for (let step = 0; step < 32; step += 1) {
      const middle = (inside + outside) / 2;
      if (inGamut(linearRgb(lightness, a * middle, b * middle))) inside = middle; else outside = middle;
    }
    channels = linearRgb(lightness, a * inside, b * inside);
  }
  const round = (value: number): number => Math.round(encoded(value) * 255) / 255;
  return { red: round(channels.red), green: round(channels.green), blue: round(channels.blue) };
}

/** Bisects OKLCH lightness towards `lighten` for the value nearest the brand that satisfies `passes`. */
function adjusted(base: Rgb, lighten: boolean, passes: (candidate: Rgb) => boolean): Rgb {
  if (passes(base)) return base;
  const color = oklchOf(base);
  let good = lighten ? 1 : 0;
  let bad = color.lightness;
  for (let step = 0; step < 32; step += 1) {
    const middle = (good + bad) / 2;
    if (passes(rgbAt(color, middle))) good = middle; else bad = middle;
  }
  return rgbAt(color, good);
}

/** The surfaces the text tier has to clear: page gradient stops, the panel, and the today wash. */
function textSurfaces(brand: Rgb, dark: boolean): number[] {
  const canvases: string[] = dark ? ['#15181C', '#0E1012'] : ['#EDF4FF', '#F8FAFC', '#FFFFFF'];
  const white: Rgb = { red: 1, green: 1, blue: 1 };
  const surfaces: number[] = [];
  canvases.forEach((hex: string) => {
    const canvas = rgbOf(hex);
    const panel = overlaid(canvas, white, dark ? 0.09 : 0.96);
    surfaces.push(luminance(canvas), luminance(panel), luminance(overlaid(panel, brand, dark ? 0.15 : 0.08)));
  });
  return surfaces;
}

const themeCache: Map<string, ThemeTiers> = new Map<string, ThemeTiers>();

function themeTiers(brand: string): ThemeTiers {
  const cached = themeCache.get(brand);
  if (cached) return cached;
  const base = rgbOf(brand);
  const text = (dark: boolean): string => {
    const surfaces = textSurfaces(base, dark);
    return hexOf(adjusted(base, dark, (candidate: Rgb) => {
      const value = luminance(candidate);
      return surfaces.every((surface: number) => contrastOf(value, surface) >= 4.5);
    }));
  };
  const tiers: ThemeTiers = { textLight: text(false), textDark: text(true),
    fill: hexOf(adjusted(base, false, (candidate: Rgb) => contrastOf(luminance(candidate), 1) >= 4.5)) };
  if (themeCache.size >= 16) themeCache.clear();
  themeCache.set(brand, tiers);
  return tiers;
}

/** The theme colour of the styled timetable: a single-colour palette's accent, otherwise the app brand. */
export function scheduleThemeBrand(palette: string): string {
  return palette === 'color-glass' ? '#0F8F7F' : schedulePalette(palette).accent.toUpperCase();
}

export function scheduleThemeText(palette: string, dark: boolean): string {
  const tiers = themeTiers(scheduleThemeBrand(palette));
  return dark ? tiers.textDark : tiers.textLight;
}

/** A solid fill that carries white text. */
export function scheduleThemeFill(palette: string): string { return themeTiers(scheduleThemeBrand(palette)).fill; }

/** The brand colour at a given strength, for washes. */
export function scheduleThemeTint(palette: string, strength: number): string {
  return scheduleAlpha(scheduleThemeBrand(palette), strength);
}

// ---- Course colours ----

export interface ScheduleStyleCourseColor {
  // Degrees, 0..<360.
  hue: number;
  // Percent.
  saturation: number;
  backgroundLightness: number;
}

function hueSaturation(rgb: Rgb): number[] {
  const maxValue = Math.max(rgb.red, rgb.green, rgb.blue);
  const minValue = Math.min(rgb.red, rgb.green, rgb.blue);
  const delta = maxValue - minValue;
  if (delta <= 0) return [0, 0];
  const lightness = (maxValue + minValue) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = maxValue === rgb.red ? ((rgb.green - rgb.blue) / delta) % 6
    : maxValue === rgb.green ? (rgb.blue - rgb.red) / delta + 2 : (rgb.red - rgb.green) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return [hue, Math.min(100, saturation * 100)];
}

/**
 * A course's colours in the styled timetable. The hue comes from the same UTF-16 name hash as Web,
 * Android and iOS, so a course keeps its colour family on every client; a single-colour palette
 * gives every course that palette's hue.
 */
export function scheduleStyleCourseColor(name: string, palette: string): ScheduleStyleCourseColor {
  if (palette !== 'color-glass') {
    const values = hueSaturation(rgbOf(schedulePalette(palette).accent));
    // Slate stays grey; only an over-vivid accent is held back.
    return { hue: values[0], saturation: Math.min(76, values[1]), backgroundLightness: 91 };
  }
  let hash = 0;
  const seed = name.trim().replace(/\s+/g, ' ');
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return { hue: hash % 360, saturation: 58 + ((hash >>> 8) % 18), backgroundLightness: 89 + ((hash >>> 16) % 5) };
}

/** Text, stripes and dots. Light text sits at a fixed lightness so every hue clears 4.5:1 on its fill. */
export function scheduleCourseAccent(color: ScheduleStyleCourseColor, dark: boolean): string {
  return dark ? hsl(color.hue, Math.min(82, color.saturation + 8), 80)
    : hsl(color.hue, Math.min(76, color.saturation + 4), 24);
}

/** The flat fill behind a course: an opaque pale tint in light mode, a translucent one in dark mode. */
export function scheduleCourseFill(color: ScheduleStyleCourseColor, dark: boolean, hasBackground: boolean = false,
  strength: number = 1): string {
  const saturation = Math.min(45, color.saturation);
  if (dark) return hsl(color.hue, saturation, 50, 0.22 * strength);
  return hsl(color.hue, saturation, Math.max(93, color.backgroundLightness), (hasBackground ? 0.92 : 1) * strength);
}

export function scheduleCourseBorder(color: ScheduleStyleCourseColor, dark: boolean): string {
  return hsl(color.hue, Math.min(50, color.saturation), dark ? 70 : 55, dark ? 0.34 : 0.22);
}

// ---- Time ----

/** "08:00" → 480; -1 when it cannot be parsed. */
export function scheduleClockMinutes(value: string): number {
  const parts = (value ?? '').split(':');
  if (parts.length < 2) return -1;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  return Number.isInteger(hour) && Number.isInteger(minute) && parts[0].trim() !== '' && parts[1].trim() !== ''
    ? hour * 60 + minute : -1;
}

export function scheduleSession(start: string): string {
  const minutes = scheduleClockMinutes(start);
  if (minutes < 0) return '课程';
  if (minutes < 12 * 60) return '上午';
  return minutes < 18 * 60 ? '下午' : '晚上';
}

export function scheduleNumeral(value: number): string {
  const digits: string[] = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 0 || value >= 100) return String(value);
  if (value < 10) return digits[value];
  return (value < 20 ? '十' : digits[Math.floor(value / 10)] + '十') + (value % 10 === 0 ? '' : digits[value % 10]);
}

export function scheduleWeekday(day: number): string {
  const labels: string[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return day >= 1 && day <= 7 ? labels[day - 1] : `周${day}`;
}

/** The room without a leading "@": some rows carry one already and the tiles add their own. */
export function scheduleCleanLocation(raw?: string): string {
  return (raw ?? '').trim().replace(/^[@＠\s]+/, '').replace(/[@＠\s]+$/, '');
}

/** Minutes since midnight in the timetable's time zone (Asia/Shanghai). */
export function scheduleMinutesNow(timestamp: number): number {
  const shifted = new Date(timestamp + 8 * 3600000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Today as `yyyy-MM-dd` in the timetable's time zone. */
export function scheduleTodayDate(timestamp: number): string {
  return new Date(timestamp + 8 * 3600000).toISOString().substring(0, 10);
}

export function scheduleClockLabel(minutes: number, padHour: boolean = false): string {
  const hour = String(Math.floor(minutes / 60));
  return `${padHour ? hour.padStart(2, '0') : hour}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "第 5 节" / "第 5–6 节". */
export function scheduleSlotText(startSlot: number, endSlot: number): string {
  return `第 ${startSlot}${startSlot === endSlot ? '' : '–' + endSlot} 节`;
}

// ---- A course's place relative to "now" on the day being shown ----

export interface ScheduleDayStatus {
  // Minutes since midnight when the day shown is today and "now" is marked; -1 otherwise.
  now: number;
  // Courses ending by this minute are finished; also set for past days. -1 when unknown.
  completedBefore: number;
}

/** `current`, `upcoming` or `completed`, from a course's start and end clock times. */
export function scheduleCoursePhase(status: ScheduleDayStatus, start: string, end: string): string {
  const startMinutes = scheduleClockMinutes(start);
  const endMinutes = scheduleClockMinutes(end);
  if (startMinutes < 0 || endMinutes < 0) return 'upcoming';
  const limit = status.completedBefore >= 0 ? status.completedBefore : status.now;
  if (limit >= 0 && endMinutes <= limit) return 'completed';
  if (status.now >= 0 && startMinutes <= status.now && status.now < endMinutes) return 'current';
  return 'upcoming';
}

/** "已结束", "正在上 · 还剩 N 分", "N 分钟后" within the hour, or empty. */
export function scheduleCourseStatusLabel(status: ScheduleDayStatus, start: string, end: string): string {
  const phase = scheduleCoursePhase(status, start, end);
  if (phase === 'completed') return '已结束';
  if (phase === 'current') return `正在上 · 还剩 ${Math.max(1, scheduleClockMinutes(end) - status.now)} 分`;
  const startMinutes = scheduleClockMinutes(start);
  if (status.now < 0 || startMinutes <= status.now) return '';
  return startMinutes - status.now < 60 ? `${startMinutes - status.now} 分钟后` : '';
}

/**
 * Where "now" falls down a grid of equal rows, in the same unit as `rowHeight`. During a break it
 * rests in the gap between two periods; before the first period and after the last it is -1.
 */
export function scheduleNowOffset(current: number, starts: string[], ends: string[], rowHeight: number, gap: number): number {
  for (let index = 0; index < starts.length; index += 1) {
    const start = scheduleClockMinutes(starts[index]);
    const end = scheduleClockMinutes(ends[index]);
    if (start < 0 || end <= start) return -1;
    if (current < start) return index === 0 ? -1 : index * (rowHeight + gap) - gap / 2;
    if (current <= end) return index * (rowHeight + gap) + rowHeight * (current - start) / (end - start);
  }
  return -1;
}
