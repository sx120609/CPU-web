export type AssistantHistorySyncItem = {
  id: string;
  updatedAt: number;
};

export function mergeAssistantHistorySessions<T extends AssistantHistorySyncItem>(
  localSessions: T[],
  cloudSessions: T[],
  deletedIds: Iterable<string>,
  limit: number,
) {
  const deleted = new Set(deletedIds);
  const merged = new Map<string, T>();
  for (const item of [...cloudSessions, ...localSessions]) {
    if (!item?.id || deleted.has(item.id)) continue;
    const current = merged.get(item.id);
    if (!current || item.updatedAt >= current.updatedAt) merged.set(item.id, item);
  }
  return [...merged.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(0, limit));
}
