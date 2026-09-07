export async function refreshScheduleWidget<T>(
  refresh: Promise<T>,
  cached: T | null,
  saveLateResult: (value: T) => Promise<unknown>,
  waitMs = 5_000,
): Promise<{ value: T; fallback: boolean }> {
  if (!cached) return { value: await refresh, fallback: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const result = await Promise.race([
      refresh.then(value => ({ value, fallback: false }), () => ({ value: cached, fallback: true })),
      new Promise<{ value: T; fallback: boolean }>(resolve => {
        timer = setTimeout(() => { timedOut = true; resolve({ value: cached, fallback: true }); }, waitMs);
      }),
    ]);
    if (timedOut) void refresh.then(saveLateResult).catch(() => undefined);
    return result;
  } finally { clearTimeout(timer); }
}
