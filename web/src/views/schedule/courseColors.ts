// 单门课的颜色：在课程速览里给某门课换一个色相，或者一键给整学期的课排开颜色。
// 只换色相，深浅和饱和度仍由当前配色和样式决定，所以换了配色、深浅色、样式都协调。
// 跟配色选择一样只存在这台设备上（localStorage），不进课表数据，也不影响原生课表。
import { reactive } from "vue";

export const COURSE_COLOR_STORAGE_KEY = "cpu-schedule-course-colors-v1";

/** 速览里的色板：12 个色相，从红开始绕一圈。 */
export const COURSE_COLOR_HUES = [0, 24, 40, 52, 96, 140, 168, 190, 210, 230, 262, 300] as const;

/** 换了色的课在各个样式里用的饱和度。 */
export const COURSE_COLOR_SATURATION = 66;

export function courseColorKey(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeHue(value: unknown) {
  const hue = Number(value);
  if (!Number.isFinite(hue)) return null;
  return ((Math.round(hue) % 360) + 360) % 360;
}

function readStored(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COURSE_COLOR_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: Record<string, number> = {};
    for (const [name, value] of Object.entries(data)) {
      const hue = normalizeHue(value);
      if (hue !== null && courseColorKey(name)) out[courseColorKey(name)] = hue;
    }
    return out;
  } catch {
    return {};
  }
}

const overrides = reactive<Record<string, number>>(typeof localStorage === "undefined" ? {} : readStored());

function persist() {
  try {
    if (Object.keys(overrides).length) localStorage.setItem(COURSE_COLOR_STORAGE_KEY, JSON.stringify(overrides));
    else localStorage.removeItem(COURSE_COLOR_STORAGE_KEY);
  } catch {
    /* 存不下就只在这次打开里生效 */
  }
}

/** 这门课换过的色相；没换过返回 null。在渲染里调用会随着更改刷新。 */
export function courseHueOverride(name: string): number | null {
  const hue = overrides[courseColorKey(name)];
  return typeof hue === "number" ? hue : null;
}

export function setCourseHue(name: string, hue: number | null) {
  const key = courseColorKey(name);
  if (!key) return;
  const value = hue === null ? null : normalizeHue(hue);
  if (value === null) delete overrides[key];
  else overrides[key] = value;
  persist();
}

export function hasCourseColorOverrides() {
  return Object.keys(overrides).length > 0;
}

export function clearCourseHues() {
  for (const key of Object.keys(overrides)) delete overrides[key];
  persist();
}

/**
 * 一键分配：按课名排好后把色相均匀排开，相邻两门课尽量隔得远（每次跳过大半圈），
 * 同一批课每次分配的结果都一样。
 */
export function spreadCourseHues(names: readonly string[]): Record<string, number> {
  const unique = Array.from(new Set(names.map(courseColorKey).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const count = unique.length;
  const out: Record<string, number> = {};
  if (!count) return out;
  const step = 360 / count;
  // 找一个和 count 互质、接近 count 一半多一点的跨度，让顺序上挨着的课颜色差得开。
  let stride = Math.max(1, Math.round(count * 0.618));
  while (count > 1 && gcd(stride, count) !== 1) stride += 1;
  unique.forEach((name, index) => {
    out[name] = Math.round(((index * stride) % count) * step + 8) % 360;
  });
  return out;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function assignCourseHues(names: readonly string[]) {
  const spread = spreadCourseHues(names);
  for (const key of Object.keys(overrides)) delete overrides[key];
  Object.assign(overrides, spread);
  persist();
  return Object.keys(spread).length;
}
