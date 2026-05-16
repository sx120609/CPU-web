export type ScheduleThemeKey =
  | "green"
  | "blue"
  | "teal"
  | "purple"
  | "orange"
  | "rose"
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
const colorGlassCourseTones: CourseTone[] = [
  { bg: "rgba(255, 228, 230, 0.70)", border: "rgba(244, 63, 94, 0.44)", text: "#8f1230" },
  { bg: "rgba(255, 237, 213, 0.70)", border: "rgba(249, 115, 22, 0.42)", text: "#8a3412" },
  { bg: "rgba(254, 243, 199, 0.72)", border: "rgba(245, 158, 11, 0.44)", text: "#7a4c09" },
  { bg: "rgba(220, 252, 231, 0.72)", border: "rgba(34, 197, 94, 0.40)", text: "#14532d" },
  { bg: "rgba(204, 251, 241, 0.72)", border: "rgba(20, 184, 166, 0.40)", text: "#115e59" },
  { bg: "rgba(219, 234, 254, 0.72)", border: "rgba(59, 130, 246, 0.40)", text: "#1e3a8a" },
  { bg: "rgba(224, 231, 255, 0.72)", border: "rgba(99, 102, 241, 0.40)", text: "#3730a3" },
  { bg: "rgba(243, 232, 255, 0.72)", border: "rgba(168, 85, 247, 0.40)", text: "#6b21a8" },
  { bg: "rgba(252, 231, 243, 0.72)", border: "rgba(236, 72, 153, 0.38)", text: "#9d174d" },
];

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
  purple: simpleTheme(
    "purple",
    "紫色",
    "linear-gradient(135deg, #7c3aed 0%, #ede9fe 100%)",
    "#7c3aed",
    "#5b21b6",
    "rgba(124, 58, 237, 0.12)",
    "rgba(124, 58, 237, 0.18)",
    "#f5f3ff",
    "#ede9fe",
    "#c4b5fd",
    "#f7f3ff",
    "#7c3aed",
    "#6b21a8",
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
  scheduleThemePalettes.purple,
  scheduleThemePalettes.orange,
  scheduleThemePalettes.rose,
  scheduleThemePalettes["color-glass"],
].map(({ key, label, preview }) => ({ key, label, preview }));

export function getColorGlassCourseTone(name: string): CourseTone {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return colorGlassCourseTones[hash % colorGlassCourseTones.length];
}

export function normalizeScheduleTheme(value?: string | null): ScheduleThemeKey {
  const next = (value ?? "").trim();
  if (!next) return "green";
  if (next === "simple") return "green";
  if (next === "colorful") return "color-glass";
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
