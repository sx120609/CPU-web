/** The refresh button could not reach 教务 because its authorization is gone. */
export const SCHEDULE_REFRESH_SIGNED_OUT_MESSAGE = "教务授权已失效，课表没有更新。请重新登录教务后再刷新。";

/** The account or 教务 session changed while the refresh was running. */
export const SCHEDULE_REFRESH_INTERRUPTED_MESSAGE = "课表刷新被打断，课表没有更新，请再刷新一次。";

const AUTH_FAILURE = /请先登录教务|请先完成教务授权|教务会话已失效|统一认证会话已失效|教务授权已失效|重新登录|重新授权/;

/**
 * What to tell someone whose refresh did not reach 教务. The timetable on
 * screen stays, so the message has to say that it was not updated.
 */
export function scheduleRefreshFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (AUTH_FAILURE.test(message)) return SCHEDULE_REFRESH_SIGNED_OUT_MESSAGE;
  if (!message) return "课表没有更新，请检查网络连接后重试。";
  return message.includes("没有更新") ? message : `课表没有更新：${message}`;
}
