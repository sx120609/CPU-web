/**
 * 宿舍课表的两个入口：网页在课表页里打开宿舍弹窗（`/schedule?dorm=1`），原生 App 的课表是原生画的，
 * 用独立页面 `/dorm-schedule`。邀请链接统一写成课表页的形式，各端再按这里转到自己的入口。
 */

/** 宿舍码只收字母和数字，链接里的其余内容不往页面里带；服务端会再按宿舍码字母表校验。 */
export function normalizeDormInviteCode(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = typeof raw === "string" ? raw.replace(/\s+/g, "").toUpperCase() : "";
  return /^[A-Z0-9]{4,12}$/.test(text) ? text : "";
}

/** 原生壳里的宿舍课表页。 */
export function dormScheduleLocation(code?: unknown) {
  const normalized = normalizeDormInviteCode(code);
  return { path: "/dorm-schedule", query: normalized ? { code: normalized } : {} };
}

/** 网页里的宿舍课表：课表页加上 dorm=1。 */
export function scheduleDormLocation(code?: unknown) {
  const normalized = normalizeDormInviteCode(code);
  return { path: "/schedule", query: normalized ? { dorm: "1", code: normalized } : { dorm: "1" } };
}
