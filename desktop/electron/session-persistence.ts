export type PersistentSessionTarget = {
  flushStorageData: () => void;
  cookies: {
    flushStore: () => Promise<void>;
  };
};

/**
 * Chromium 会延迟把 Cookie、localStorage 等会话数据写入磁盘。
 * 桌面端更新会很快退出旧进程，因此更新或正常退出前必须主动落盘。
 */
export const flushPersistentSession = async (target: PersistentSessionTarget): Promise<void> => {
  let firstError: unknown;

  try {
    target.flushStorageData();
  } catch (error) {
    firstError = error;
  }

  try {
    await target.cookies.flushStore();
  } catch (error) {
    firstError ??= error;
  }

  if (firstError) throw firstError;
};
