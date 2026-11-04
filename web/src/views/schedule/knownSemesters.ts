import { jwxtScopedStorageKey } from "@/utils/jwxtCache";

/**
 * 课表学期下拉合并「这次课表给的学期」和「之前见过的学期」。
 * 整学期课表的缓存过期前不会重新请求；只用当前这份的列表时，看旧学期会只剩那份缓存当时的选项。
 */
export const KNOWN_SEMESTERS_BASE = "cpu-schedule-semesters-v1";

export type SemesterOption = { value: string; label: string; current?: boolean };

function storageKey(scope: string) {
  return jwxtScopedStorageKey(KNOWN_SEMESTERS_BASE, scope);
}

export function readKnownSemesters(scope: string): SemesterOption[] {
  try {
    const key = storageKey(scope);
    if (!key) return [];
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is SemesterOption => Boolean(item) && typeof item.value === "string" && typeof item.label === "string")
      : [];
  } catch {
    return [];
  }
}

/** 合并后按学期从新到旧；「当前学期」标记以这次课表为准。 */
export function mergeSemesters(fresh: SemesterOption[], known: SemesterOption[]): SemesterOption[] {
  const byValue = new Map<string, SemesterOption>();
  for (const item of known) byValue.set(item.value, { value: item.value, label: item.label });
  for (const item of fresh) byValue.set(item.value, { ...item });
  return [...byValue.values()].sort((a, b) => b.value.localeCompare(a.value));
}

export function rememberSemesters(scope: string, list: SemesterOption[]) {
  const key = storageKey(scope);
  if (!list.length || !key) return;
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, 40).map(({ value, label }) => ({ value, label }))));
  } catch {
    // 存不了就只用这次的列表
  }
}
