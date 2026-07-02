export type ScheduleThemeKey =
  | "green"
  | "blue"
  | "teal"
  | "indigo"
  | "violet"
  | "orange"
  | "rose"
  | "slate"
  | "color-glass";

export interface ScheduleThemePalette {
  key: ScheduleThemeKey;
  label: string;
  preview: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentSoftHover: string;
  accentPale: string;
  accentPaleHover: string;
  accentBorder: string;
  accentContrast: string;
  pageBg: string;
  courseBg: string;
  courseBorder: string;
  courseText: string;
}

export interface ScheduleThemeOption {
  key: ScheduleThemeKey;
  label: string;
  preview: string;
}

export interface CourseTone {
  bg: string;
  border: string;
  text: string;
}

const pageBg = "linear-gradient(180deg, #edf4ff 0%, #f7fbff 42%, #f8fafc 100%)";

function simpleTheme(
  key: Exclude<ScheduleThemeKey, "color-glass">,
  label: string,
  preview: string,
  accent: string,
  accentStrong: string,
  accentSoft: string,
  accentSoftHover: string,
  accentPale: string,
  accentPaleHover: string,
  accentBorder: string,
  courseBg: string,
  courseBorder: string,
  courseText: string,
): ScheduleThemePalette {
  return {
    key,
    label,
    preview,
    accent,
    accentStrong,
    accentSoft,
    accentSoftHover,
    accentPale,
    accentPaleHover,
    accentBorder,
    accentContrast: "#ffffff",
    pageBg,
    courseBg,
    courseBorder,
    courseText,
  };
}

export const scheduleThemePalettes: Record<ScheduleThemeKey, ScheduleThemePalette> = {
  green: simpleTheme(
    "green",
    "绿色",
    "linear-gradient(135deg, #168776 0%, #d9f5ee 100%)",
    "#168776",
    "#116b5f",
    "rgba(22, 135, 118, 0.12)",
    "rgba(22, 135, 118, 0.18)",
    "#e8f6f3",
    "#d3eee8",
    "#9fd9cf",
    "#f4fbf8",
    "#168776",
    "#0f5d52",
  ),
  blue: simpleTheme(
    "blue",
    "蓝色",
    "linear-gradient(135deg, #2563eb 0%, #dbeafe 100%)",
    "#2563eb",
    "#1e3a8a",
    "rgba(37, 99, 235, 0.12)",
    "rgba(37, 99, 235, 0.18)",
    "#eff6ff",
    "#dbeafe",
    "#93c5fd",
    "#f3f8ff",
    "#2563eb",
    "#1e3a8a",
  ),
  teal: simpleTheme(
    "teal",
    "湖蓝",
    "linear-gradient(135deg, #0891b2 0%, #cffafe 100%)",
    "#0891b2",
    "#155e75",
    "rgba(8, 145, 178, 0.12)",
    "rgba(8, 145, 178, 0.18)",
    "#ecfeff",
    "#cffafe",
    "#67e8f9",
    "#f0fbff",
    "#0891b2",
    "#164e63",
  ),
  indigo: simpleTheme(
    "indigo",
    "粉色",
    "linear-gradient(135deg, #db2777 0%, #fce7f3 100%)",
    "#db2777",
    "#9d174d",
    "rgba(219, 39, 119, 0.12)",
    "rgba(219, 39, 119, 0.18)",
    "#fdf2f8",
    "#fce7f3",
    "#f9a8d4",
    "#fff5fa",
    "#db2777",
    "#9d174d",
  ),
  violet: simpleTheme(
    "violet",
    "紫色",
    "linear-gradient(135deg, #7c3aed 0%, #ede9fe 100%)",
    "#7c3aed",
    "#5b21b6",
    "rgba(124, 58, 237, 0.12)",
    "rgba(124, 58, 237, 0.18)",
    "#f5f3ff",
    "#ede9fe",
    "#c4b5fd",
    "#faf7ff",
    "#7c3aed",
    "#5b21b6",
  ),
  orange: simpleTheme(
    "orange",
    "橙色",
    "linear-gradient(135deg, #ea580c 0%, #ffedd5 100%)",
    "#ea580c",
    "#9a3412",
    "rgba(234, 88, 12, 0.12)",
    "rgba(234, 88, 12, 0.18)",
    "#fff7ed",
    "#ffedd5",
    "#fdba74",
    "#fff7f1",
    "#ea580c",
    "#9a3412",
  ),
  rose: simpleTheme(
    "rose",
    "玫红",
    "linear-gradient(135deg, #e11d48 0%, #ffe4e6 100%)",
    "#e11d48",
    "#9f1239",
    "rgba(225, 29, 72, 0.12)",
    "rgba(225, 29, 72, 0.18)",
    "#fff1f2",
    "#ffe4e6",
    "#fda4af",
    "#fff5f7",
    "#e11d48",
    "#9f1239",
  ),
  slate: simpleTheme(
    "slate",
    "石墨",
    "linear-gradient(135deg, #475569 0%, #e2e8f0 100%)",
    "#475569",
    "#1e293b",
    "rgba(71, 85, 105, 0.12)",
    "rgba(71, 85, 105, 0.18)",
    "#f1f5f9",
    "#e2e8f0",
    "#cbd5e1",
    "#f8fafc",
    "#64748b",
    "#334155",
  ),
  "color-glass": {
    key: "color-glass",
    label: "彩色",
    preview: "linear-gradient(135deg, #f43f5e 0%, #f97316 17%, #f59e0b 34%, #22c55e 51%, #14b8a6 68%, #3b82f6 84%, #a855f7 100%)",
    accent: "#6d5dfc",
    accentStrong: "#4736c8",
    accentSoft: "rgba(109, 93, 252, 0.12)",
    accentSoftHover: "rgba(109, 93, 252, 0.18)",
    accentPale: "#f0efff",
    accentPaleHover: "#e3e0ff",
    accentBorder: "#bbb5ff",
    accentContrast: "#ffffff",
    pageBg,
    courseBg: "#f4fbf8",
    courseBorder: "#168776",
    courseText: "#0f5d52",
  },
};

export const scheduleThemeOptions: ScheduleThemeOption[] = [
  scheduleThemePalettes.green,
  scheduleThemePalettes.blue,
  scheduleThemePalettes.teal,
  scheduleThemePalettes.indigo,
  scheduleThemePalettes.violet,
  scheduleThemePalettes.orange,
  scheduleThemePalettes.rose,
  scheduleThemePalettes.slate,
  scheduleThemePalettes["color-glass"],
].map(({ key, label, preview }) => ({ key, label, preview }));

export function getColorGlassCourseTone(name: string, dark = false): CourseTone {
  let hash = 0;
  const seed = name.trim().replace(/\s+/g, " ");
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const saturation = 58 + ((hash >>> 8) % 18);
  if (dark) {
    const darkSaturation = Math.min(82, saturation + 4);
    return {
      bg: `linear-gradient(180deg, hsla(${hue}, ${darkSaturation}%, 34%, 0.84), hsla(${hue}, ${darkSaturation}%, 24%, 0.88))`,
      border: `hsla(${hue}, ${Math.min(86, saturation + 8)}%, 72%, 0.72)`,
      text: "#f8fffd",
    };
  }
  const bgLightness = 89 + ((hash >>> 16) % 5);
  const borderLightness = 48 + ((hash >>> 20) % 10);
  const textLightness = 25 + ((hash >>> 24) % 8);
  return {
    bg: `hsla(${hue}, ${saturation}%, ${bgLightness}%, 0.86)`,
    border: `hsla(${hue}, ${Math.min(82, saturation + 8)}%, ${borderLightness}%, 0.48)`,
    text: `hsl(${hue}, ${Math.min(76, saturation + 4)}%, ${textLightness}%)`,
  };
}

export function normalizeScheduleTheme(value?: string | null): ScheduleThemeKey {
  const next = (value ?? "").trim();
  if (!next) return "green";
  if (next === "simple") return "green";
  if (next === "colorful") return "color-glass";
  if (next === "cyan") return "teal";
  if (next === "sky") return "blue";
  if (next === "purple" || next === "violet") return "violet";
  if (next === "amber") return "orange";
  if (next === "lime") return "green";
  if (next === "pink" || next === "red") return "rose";
  if (next in scheduleThemePalettes) return next as ScheduleThemeKey;
  return "green";
}

export function getScheduleThemePalette(value?: string | null): ScheduleThemePalette {
  return scheduleThemePalettes[normalizeScheduleTheme(value)];
}

export function scheduleThemeCssVars(value?: string | null): Record<string, string> {
  const theme = getScheduleThemePalette(value);
  return {
    "--schedule-accent": theme.accent,
    "--schedule-accent-strong": theme.accentStrong,
    "--schedule-accent-soft": theme.accentSoft,
    "--schedule-accent-soft-hover": theme.accentSoftHover,
    "--schedule-accent-pale": theme.accentPale,
    "--schedule-accent-pale-hover": theme.accentPaleHover,
    "--schedule-accent-border": theme.accentBorder,
    "--schedule-accent-contrast": theme.accentContrast,
    "--schedule-page-bg": theme.pageBg,
    "--schedule-course-bg": theme.courseBg,
    "--schedule-course-border": theme.courseBorder,
    "--schedule-course-text": theme.courseText,
  };
}

export function scheduleThemeDarkCssVars(value?: string | null): Record<string, string> {
  const theme = getScheduleThemePalette(value);
  return {
    "--schedule-accent": theme.accent,
    "--schedule-accent-strong": `color-mix(in srgb, ${theme.accent} 58%, white)`,
    "--schedule-accent-soft": `color-mix(in srgb, ${theme.accent} 14%, transparent)`,
    "--schedule-accent-soft-hover": `color-mix(in srgb, ${theme.accent} 22%, transparent)`,
    "--schedule-accent-pale": `color-mix(in srgb, ${theme.accent} 18%, transparent)`,
    "--schedule-accent-pale-hover": `color-mix(in srgb, ${theme.accent} 26%, transparent)`,
    "--schedule-accent-border": `color-mix(in srgb, ${theme.accent} 42%, transparent)`,
    "--schedule-accent-contrast": "#ffffff",
    "--schedule-course-bg": `color-mix(in srgb, ${theme.courseBg} 32%, #101c19)`,
    "--schedule-course-border": `color-mix(in srgb, ${theme.courseBorder} 72%, white)`,
    "--schedule-course-text": `color-mix(in srgb, ${theme.courseText} 22%, white)`,
  };
}
