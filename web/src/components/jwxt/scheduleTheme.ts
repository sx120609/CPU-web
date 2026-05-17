export type ScheduleThemeKey =
  | "green"
  | "blue"
  | "teal"
  | "indigo"
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
    "青色",
    "linear-gradient(135deg, #0f766e 0%, #ccfbf1 100%)",
    "#0f766e",
    "#115e59",
    "rgba(15, 118, 110, 0.12)",
    "rgba(15, 118, 110, 0.18)",
    "#eefcf9",
    "#ccfbf1",
    "#5eead4",
    "#f0fbf9",
    "#0f766e",
    "#115e59",
  ),
  indigo: simpleTheme(
    "indigo",
    "靛蓝",
    "linear-gradient(135deg, #4f46e5 0%, #e0e7ff 100%)",
    "#4f46e5",
    "#3730a3",
    "rgba(79, 70, 229, 0.12)",
    "rgba(79, 70, 229, 0.18)",
    "#eef2ff",
    "#e0e7ff",
    "#a5b4fc",
    "#f5f7ff",
    "#4f46e5",
    "#3730a3",
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
    accent: "#168776",
    accentStrong: "#116b5f",
    accentSoft: "rgba(22, 135, 118, 0.12)",
    accentSoftHover: "rgba(22, 135, 118, 0.18)",
    accentPale: "#e8f6f3",
    accentPaleHover: "#d3eee8",
    accentBorder: "#9fd9cf",
    accentContrast: "#ffffff",
    pageBg:
      "radial-gradient(circle at 16% 2%, rgba(125, 211, 252, 0.26), transparent 28%), radial-gradient(circle at 88% 10%, rgba(196, 181, 253, 0.20), transparent 30%), radial-gradient(circle at 46% 98%, rgba(134, 239, 172, 0.16), transparent 34%), linear-gradient(180deg, #eef7ff 0%, #fbfdff 46%, #f8fafc 100%)",
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
  scheduleThemePalettes.orange,
  scheduleThemePalettes.rose,
  scheduleThemePalettes.slate,
  scheduleThemePalettes["color-glass"],
].map(({ key, label, preview }) => ({ key, label, preview }));

export function getColorGlassCourseTone(name: string): CourseTone {
  let hash = 0;
  const seed = name.trim().replace(/\s+/g, " ");
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const saturation = 58 + ((hash >>> 8) % 18);
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
  if (next === "purple" || next === "violet") return "indigo";
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
