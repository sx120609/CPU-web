// 重叠课程的显示优先级。和 scheduleEdits.ts 分开放：那个文件会被打进三端的
// 课表桥，这里的逻辑只有服务端和以后要支持优先级的客户端用得到。

/** 键是 schedulePriorityKey(课程名)，值越大越靠前；没有键表示未指定。 */
export type SchedulePriorityMap = Record<string, number>;

export const MAX_SCHEDULE_PRIORITIES = 200;
export const MAX_SCHEDULE_PRIORITY = 9999;
const MAX_KEY_LENGTH = 80;

/** 优先级跟着课程走，不跟着某一节走，所以只看课程名。 */
export function schedulePriorityKey(name: unknown) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

/**
 * `undefined` 表示调用方根本没带这个字段（旧客户端），和显式的空对象（清空）不是一回事。
 */
export function normalizeSchedulePriority(input: unknown): SchedulePriorityMap | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const entries: Array<[string, number]> = [];
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = schedulePriorityKey(rawKey);
    const value = Number(rawValue);
    if (!key || key.length > MAX_KEY_LENGTH) continue;
    if (!Number.isInteger(value) || value < 1 || value > MAX_SCHEDULE_PRIORITY) continue;
    entries.push([key, value]);
  }
  // 超出上限时留下最靠前的那些。
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return Object.fromEntries(entries.slice(0, MAX_SCHEDULE_PRIORITIES).sort((a, b) => a[0].localeCompare(b[0])));
}

/**
 * 保存时要写下的优先级。课表编辑是整份覆盖的，不认识优先级的客户端保存一次就会把它
 * 抹掉，所以请求里没带这个字段时沿用已保存的。返回 `undefined` 表示不必写这个键。
 */
export function resolveSavedSchedulePriority(incoming: unknown, stored: unknown): SchedulePriorityMap | undefined {
  const next = normalizeSchedulePriority(incoming) ?? normalizeSchedulePriority(stored);
  return next && Object.keys(next).length ? next : undefined;
}
