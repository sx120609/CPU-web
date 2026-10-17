import type { ZhsLog } from "../api/zhihuishu";

export const HISTORY_LIMIT = 5000;
export function historyKey(scope: string) { return `cpu-zhs-history-v1:${scope}`; }
export function parseHistory(raw: string | null): ZhsLog[] {
  if (!raw) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error("本地记录格式异常");
  return rows.filter((row): row is ZhsLog => Boolean(row && typeof row === "object" &&
    typeof row.id === "string" && row.id.length <= 200 &&
    typeof row.at === "string" && Number.isFinite(Date.parse(row.at)) &&
    typeof row.message === "string" && row.message.length <= 600 &&
    ["info", "skipped", "uninspected"].includes(row.kind)))
    .map(({ id, at, message, kind }) => ({ id, at, message, kind })).slice(-HISTORY_LIMIT);
}
export function mergeHistory(...groups: ZhsLog[][]): ZhsLog[] {
  const rows = new Map<string, ZhsLog>();
  for (const group of groups) for (const row of group) rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-HISTORY_LIMIT);
}
export function saveHistory(storage: Pick<Storage, "getItem" | "setItem">, scope: string, memory: ZhsLog[], incoming: ZhsLog[]): ZhsLog[] {
  const key = historyKey(scope);
  const previous = storage.getItem(key);
  const merged = mergeHistory(parseHistory(previous), memory, incoming);
  const json = JSON.stringify(merged);
  if (json !== previous) storage.setItem(key, json);
  return merged;
}
