// 课表样式：和课程配色、深浅色无关，切换它不会动课程数据、所选周次或编辑权限。
// 六种样式与 iOS 一致（ios_next/CpuTime/CpuTime/ScheduleStyle.swift、ScheduleStyleTheme.swift）：
// 「经典」是一直以来的样子，仍是默认值；其余五种来自 NapTable。
import {
  getColorGlassCourseTone,
  getScheduleThemePalette,
  normalizeScheduleTheme,
  type CourseTone,
} from "@/components/jwxt/scheduleTheme";

export type ScheduleStyleKey = "classic" | "minimal" | "grid" | "table" | "paper" | "board";

export const DEFAULT_SCHEDULE_STYLE: ScheduleStyleKey = "classic";
export const SCHEDULE_STYLE_STORAGE_KEY = "cpu-schedule-visual-style-v1";

export interface ScheduleStyleLayout {
  grid: "rows" | "cells" | "table" | "sessions";
  course: "card" | "stripe" | "ink" | "departure";
  cornerRadius: number;
  borderWidth: number;
  centered: boolean;
  font: "standard" | "rounded" | "serif" | "monospaced";
}

export interface ScheduleStyleOption {
  key: ScheduleStyleKey;
  title: string;
  subtitle: string;
}

export const scheduleStyleOptions: ScheduleStyleOption[] = [
  { key: "classic", title: "经典", subtitle: "玻璃格子与彩色卡片，沿用原来的样子" },
  { key: "minimal", title: "简约", subtitle: "淡彩卡片，轻松查课" },
  { key: "grid", title: "格子", subtitle: "独立方格，空闲一目了然" },
  { key: "table", title: "表格", subtitle: "整齐行列，集中呈现课程" },
  { key: "paper", title: "素笺", subtitle: "纸墨色调，安静阅读" },
  { key: "board", title: "站牌", subtitle: "时间优先，关注下一节" },
];

const LAYOUTS: Record<ScheduleStyleKey, ScheduleStyleLayout> = {
  classic: { grid: "cells", course: "card", cornerRadius: 9, borderWidth: 1.5, centered: true, font: "standard" },
  minimal: { grid: "rows", course: "card", cornerRadius: 9, borderWidth: 0, centered: false, font: "rounded" },
  grid: { grid: "cells", course: "card", cornerRadius: 8, borderWidth: 1.5, centered: true, font: "rounded" },
  table: { grid: "table", course: "stripe", cornerRadius: 0, borderWidth: 0, centered: false, font: "standard" },
  paper: { grid: "rows", course: "ink", cornerRadius: 2, borderWidth: 0, centered: false, font: "serif" },
  board: { grid: "sessions", course: "departure", cornerRadius: 2, borderWidth: 0, centered: false, font: "monospaced" },
};

const FONT_STACKS: Record<ScheduleStyleLayout["font"], string> = {
  standard: "inherit",
  rounded: 'ui-rounded, "SF Pro Rounded", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", system-ui, sans-serif',
  serif: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "STSong", "SimSun", ui-serif, serif',
  monospaced: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace',
};

/** 没有保存过或值不认识时回到「经典」，所以升级后在用户自己选之前什么都不变。 */
export function normalizeScheduleStyle(value: unknown): ScheduleStyleKey {
  return typeof value === "string" && value in LAYOUTS ? (value as ScheduleStyleKey) : DEFAULT_SCHEDULE_STYLE;
}

export function scheduleStyleLayout(style: ScheduleStyleKey): ScheduleStyleLayout {
  return LAYOUTS[style];
}

export function readStoredScheduleStyle(): ScheduleStyleKey {
  try {
    return normalizeScheduleStyle(localStorage.getItem(SCHEDULE_STYLE_STORAGE_KEY));
  } catch {
    return DEFAULT_SCHEDULE_STYLE;
  }
}

export function writeStoredScheduleStyle(style: ScheduleStyleKey) {
  try {
    localStorage.setItem(SCHEDULE_STYLE_STORAGE_KEY, style);
  } catch {
    /* 存不下只影响下次打开 */
  }
}

// MARK: 颜色

export interface RGB {
  red: number;
  green: number;
  blue: number;
}

const WHITE: RGB = { red: 1, green: 1, blue: 1 };
/** `Color.cpuBrand`：逐课配色（彩色）没有自己的主题色时用它。 */
const APP_BRAND = 0x0f8f7f;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function rgbFromHex(hex: number): RGB {
  return { red: ((hex >> 16) & 255) / 255, green: ((hex >> 8) & 255) / 255, blue: (hex & 255) / 255 };
}

function rgbFromCss(hex: string): RGB {
  return rgbFromHex(Number.parseInt(hex.replace("#", ""), 16));
}

export function rgbToCss(color: RGB, alpha = 1) {
  const channel = (value: number) => Math.round(clamp01(value) * 255);
  const body = `${channel(color.red)}, ${channel(color.green)}, ${channel(color.blue)}`;
  return alpha >= 1 ? `rgb(${body})` : `rgba(${body}, ${alpha})`;
}

function overlaid(base: RGB, top: RGB, amount: number): RGB {
  return {
    red: base.red + (top.red - base.red) * amount,
    green: base.green + (top.green - base.green) * amount,
    blue: base.blue + (top.blue - base.blue) * amount,
  };
}

function linear(value: number) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encoded(value: number) {
  const clamped = clamp01(value);
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

/** WCAG 相对亮度。 */
export function luminance(color: RGB) {
  return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue);
}

export function contrastRatio(first: RGB, second: RGB) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const MINIMUM_CONTRAST = 4.5;

// OKLCH（Björn Ottosson 的 OKLab 极坐标形式）。只动明度，色相和彩度保持主题色自己的。
function toOklch(color: RGB) {
  const red = linear(color.red);
  const green = linear(color.green);
  const blue = linear(color.blue);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return {
    lightness: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    chroma: Math.sqrt(a * a + b * b),
    hue: Math.atan2(b, a),
  };
}

function linearFromOklab(lightness: number, a: number, b: number): [number, number, number] {
  const cube = (value: number) => value * value * value;
  const l = cube(lightness + 0.3963377774 * a + 0.2158037573 * b);
  const m = cube(lightness - 0.1055613458 * a - 0.0638541728 * b);
  const s = cube(lightness - 0.0894841775 * a - 1.2914855480 * b);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function inGamut(channels: [number, number, number]) {
  return channels.every((value) => value >= -1e-7 && value <= 1 + 1e-7);
}

/** 同色相同彩度换一个明度；出了 sRGB 就把彩度收回到边界，结果取整到 8 位。 */
function oklchToRgb(color: ReturnType<typeof toOklch>, lightness: number): RGB {
  const a = color.chroma * Math.cos(color.hue);
  const b = color.chroma * Math.sin(color.hue);
  let channels = linearFromOklab(lightness, a, b);
  if (!inGamut(channels)) {
    let inside = 0;
    let outside = 1;
    for (let step = 0; step < 32; step += 1) {
      const middle = (inside + outside) / 2;
      if (inGamut(linearFromOklab(lightness, a * middle, b * middle))) inside = middle;
      else outside = middle;
    }
    channels = linearFromOklab(lightness, a * inside, b * inside);
  }
  const byte = (value: number) => Math.round(encoded(value) * 255) / 255;
  return { red: byte(channels[0]), green: byte(channels[1]), blue: byte(channels[2]) };
}

/** 朝 `lighten` 的方向对分明度，取离主题色最近、又能通过 `passes` 的那个值。 */
function adjusted(base: RGB, lighten: boolean, passes: (color: RGB) => boolean): RGB {
  if (passes(base)) return base;
  const color = toOklch(base);
  let good = lighten ? 1 : 0;
  let bad = color.lightness;
  for (let step = 0; step < 32; step += 1) {
    const middle = (good + bad) / 2;
    if (passes(oklchToRgb(color, middle))) good = middle;
    else bad = middle;
  }
  return oklchToRgb(color, good);
}

/** 课表底色渐变的端点，和 Schedule.vue 的页面背景一致。 */
function canvases(dark: boolean): RGB[] {
  return dark
    ? [rgbFromHex(0x15181c), rgbFromHex(0x0e1012)]
    : [rgbFromHex(0xedf4ff), rgbFromHex(0xf8fafc), WHITE];
}

export const scheduleSurface = {
  /** 没有背景图时的周面板：白色按这个不透明度盖在页面上。 */
  panelWhiteOpacity: (dark: boolean) => (dark ? 0.09 : 0.96),
  /** 今天整列的底色强度。 */
  todayStrength: (dark: boolean) => (dark ? 0.15 : 0.08),
};

function textSurfaces(brand: RGB, dark: boolean): RGB[] {
  return canvases(dark).flatMap((canvas) => {
    const panel = overlaid(canvas, WHITE, scheduleSurface.panelWhiteOpacity(dark));
    return [canvas, panel, overlaid(panel, brand, scheduleSurface.todayStrength(dark))];
  });
}

export interface ScheduleThemeTier {
  /** 文字、图标、细线和「现在」的线：在页面、周面板和今天那一列上都至少 4.5:1。 */
  text: RGB;
  /** 实心底色，上面放白字至少 4.5:1。 */
  fill: RGB;
  base: RGB;
}

const tierCache = new Map<string, ScheduleThemeTier>();

export function scheduleThemeTier(brand: RGB, dark: boolean): ScheduleThemeTier {
  const key = `${rgbToCss(brand)}|${dark ? 1 : 0}`;
  const cached = tierCache.get(key);
  if (cached) return cached;
  const surfaces = textSurfaces(brand, dark).map(luminance);
  const text = adjusted(brand, dark, (candidate) => {
    const value = luminance(candidate);
    return surfaces.every((surface) => (Math.max(value, surface) + 0.05) / (Math.min(value, surface) + 0.05) >= MINIMUM_CONTRAST);
  });
  const fill = adjusted(brand, false, (candidate) => contrastRatio(candidate, WHITE) >= MINIMUM_CONTRAST);
  const tier = { text, fill, base: brand };
  if (tierCache.size >= 32) tierCache.clear();
  tierCache.set(key, tier);
  return tier;
}

/** 单色配色的主题色是它的强调色；逐课配色（彩色）用站点品牌色。 */
export function scheduleStyleBrand(palette: string): RGB {
  const key = normalizeScheduleTheme(palette);
  return key === "color-glass" ? rgbFromHex(APP_BRAND) : rgbFromCss(getScheduleThemePalette(key).courseBorder);
}

/** 和 getColorGlassCourseTone 同一个哈希：UTF-16 码元、31 进位、无符号 32 位回绕。 */
export function scheduleCourseHash(name: string) {
  const seed = name.trim().replace(/\s+/g, " ");
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function hueSaturation(color: RGB): [number, number] {
  const max = Math.max(color.red, color.green, color.blue);
  const min = Math.min(color.red, color.green, color.blue);
  const delta = max - min;
  if (delta <= 0) return [0, 0];
  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === color.red) hue = ((color.green - color.blue) / delta) % 6;
  else if (max === color.green) hue = (color.blue - color.red) / delta + 2;
  else hue = (color.red - color.green) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return [hue, Math.min(100, saturation * 100)];
}

export interface ScheduleStyleCourseColor {
  hue: number;
  saturation: number;
  backgroundLightness: number;
}

/**
 * 一门课在新样式里的颜色。色相来自和经典样式、安卓、iOS 相同的课程名哈希，
 * 所以同一门课在各端是同一个色系；单色配色下所有课都用那个配色的色相。
 */
export function scheduleStyleCourseColor(name: string, palette: string): ScheduleStyleCourseColor {
  const key = normalizeScheduleTheme(palette);
  if (key !== "color-glass") {
    const [hue, saturation] = hueSaturation(scheduleStyleBrand(key));
    // 石墨保持灰色；只压住过艳的强调色。
    return { hue, saturation: Math.min(76, saturation), backgroundLightness: 91 };
  }
  const hash = scheduleCourseHash(name);
  return {
    hue: hash % 360,
    saturation: 58 + ((hash >>> 8) % 18),
    backgroundLightness: 89 + ((hash >>> 16) % 5),
  };
}

function hsl(hue: number, saturation: number, lightness: number, alpha = 1) {
  const h = Math.round(hue * 100) / 100;
  const s = Math.round(saturation * 100) / 100;
  return alpha >= 1 ? `hsl(${h}, ${s}%, ${lightness}%)` : `hsla(${h}, ${s}%, ${lightness}%, ${alpha})`;
}

export interface ScheduleStyleCourseTone {
  /** 文字、色条和圆点。 */
  accent: string;
  /** 反色块（站牌里正在上的那节）上用的另一套明暗下的强调色。 */
  accentInverse: string;
  /** 课程底色：浅色是不透明的淡彩，深色是盖在深色页面上的半透明课程色。 */
  fill: string;
  border: string;
}

export function scheduleStyleCourseTone(
  name: string,
  palette: string,
  dark: boolean,
  hasBackground = false,
): ScheduleStyleCourseTone {
  const color = scheduleStyleCourseColor(name, palette);
  const accent = (isDark: boolean) => (isDark
    ? hsl(color.hue, Math.min(82, color.saturation + 8), 80)
    : hsl(color.hue, Math.min(76, color.saturation + 4), 24));
  const fillSaturation = Math.min(45, color.saturation);
  return {
    accent: accent(dark),
    accentInverse: accent(!dark),
    fill: dark
      ? hsl(color.hue, fillSaturation, 50, 0.22)
      : hsl(color.hue, fillSaturation, Math.max(93, color.backgroundLightness), hasBackground ? 0.92 : 1),
    border: hsl(color.hue, Math.min(50, color.saturation), dark ? 70 : 55, dark ? 0.34 : 0.22),
  };
}

function styleHex(style: ScheduleStyleKey, dark: boolean, paper: [number, number], board: [number, number]) {
  if (style === "paper") return rgbFromHex(dark ? paper[1] : paper[0]);
  if (style === "board") return rgbFromHex(dark ? board[1] : board[0]);
  return null;
}

/** 素笺和站牌自带页面色；其余样式沿用课表页的背景和上面的背景图。 */
export function scheduleStyleCanvas(style: ScheduleStyleKey, dark: boolean) {
  return styleHex(style, dark, [0xf1ece2, 0x201e1b], [0xf4f5f4, 0x171a1c]);
}

export function scheduleStyleInk(style: ScheduleStyleKey, dark: boolean) {
  return styleHex(style, dark, [0x2a251f, 0xede6d8], [0x171a1c, 0xffe4a3]);
}

export function scheduleStyleAccent(style: ScheduleStyleKey, dark: boolean) {
  return styleHex(style, dark, [0xa63f29, 0xf39b85], [0x242c32, 0xffd477]);
}

export interface ScheduleStyleVarsInput {
  style: ScheduleStyleKey;
  palette: string;
  dark: boolean;
  hasBackground?: boolean;
  /** 背景图显现的程度，0…1；图越明显，周面板的遮罩越厚。 */
  backgroundVisibility?: number;
}

/** 新样式用到的全部 CSS 变量。经典样式不读它们。 */
export function scheduleStyleCssVars(input: ScheduleStyleVarsInput): Record<string, string> {
  const { style, dark } = input;
  const hasBackground = Boolean(input.hasBackground);
  const layout = LAYOUTS[style];
  const brand = scheduleStyleBrand(input.palette);
  const tier = scheduleThemeTier(brand, dark);
  const canvas = hasBackground ? null : scheduleStyleCanvas(style, dark);
  const ink = scheduleStyleInk(style, dark);
  const accent = scheduleStyleAccent(style, dark);
  const veil = 0.14 + 0.32 * clamp01(input.backgroundVisibility ?? 0);
  const panel = hasBackground
    ? (dark ? `rgba(0, 0, 0, ${veil})` : `rgba(255, 255, 255, ${veil})`)
    : `rgba(255, 255, 255, ${scheduleSurface.panelWhiteOpacity(dark)})`;
  const cell = hasBackground
    ? (dark ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.55)")
    : (dark ? "rgba(255, 255, 255, 0.05)" : "#ffffff");
  const themeRgb = `${Math.round(brand.red * 255)}, ${Math.round(brand.green * 255)}, ${Math.round(brand.blue * 255)}`;
  const inkCss = ink ? rgbToCss(ink) : (dark ? "#eceef1" : "#172033");
  const inkRgb = ink
    ? `${Math.round(ink.red * 255)}, ${Math.round(ink.green * 255)}, ${Math.round(ink.blue * 255)}`
    : (dark ? "236, 238, 241" : "23, 32, 51");
  return {
    "--ss-font": FONT_STACKS[layout.font],
    "--ss-radius": `${layout.cornerRadius}px`,
    "--ss-course-border-width": `${layout.borderWidth}px`,
    "--ss-column-gap": style === "minimal" || style === "grid" ? "4px" : "0px",
    "--ss-ink": inkCss,
    "--ss-ink-rgb": inkRgb,
    "--ss-meta": dark ? "#98989d" : "#6e6e73",
    "--ss-secondary": dark ? "rgba(235, 235, 245, 0.6)" : "rgba(60, 60, 67, 0.6)",
    "--ss-theme-text": rgbToCss(tier.text),
    "--ss-theme-fill": rgbToCss(tier.fill),
    "--ss-theme-on-fill": "#ffffff",
    "--ss-theme-rgb": themeRgb,
    "--ss-today-strength": String(scheduleSurface.todayStrength(dark)),
    "--ss-accent": accent ? rgbToCss(accent) : rgbToCss(tier.text),
    "--ss-canvas": canvas ? rgbToCss(canvas) : "transparent",
    "--ss-inverse-ink": rgbToCss(scheduleStyleCanvas(style, dark) ?? WHITE),
    "--ss-panel": canvas ? rgbToCss(canvas) : panel,
    "--ss-cell": cell,
    "--ss-card": hasBackground
      ? (dark ? "rgba(30, 32, 36, 0.72)" : "rgba(255, 255, 255, 0.78)")
      : (dark ? "rgba(255, 255, 255, 0.07)" : "#ffffff"),
    "--ss-cell-border": dark ? "rgba(255, 255, 255, 0.12)" : "rgba(36, 46, 71, 0.14)",
  };
}

/** 周视图里只有简约和格子在日期列之间留缝；带线的样式要让列贴在一起，线才连得上。 */
export function scheduleStyleFramesPanel(style: ScheduleStyleKey) {
  return style !== "table" && style !== "board";
}

/** 经典样式的课程配色：逐课配色按课程名取色，单色配色用主题自己的三种颜色。 */
export function classicCourseTone(name: string, palette: string, dark: boolean): CourseTone {
  const key = normalizeScheduleTheme(palette);
  if (key === "color-glass") return getColorGlassCourseTone(name, dark);
  if (dark) {
    return {
      bg: "var(--schedule-course-bg)",
      border: "var(--schedule-course-border)",
      text: "var(--schedule-course-text)",
    };
  }
  const theme = getScheduleThemePalette(key);
  return { bg: theme.courseBg, border: theme.courseBorder, text: theme.courseText };
}
