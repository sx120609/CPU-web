import { randomInt } from "node:crypto";

// 树洞的纯规则：在岗判定、虚拟 ID、宣泄室编号、溯源审批和提醒节流。数据库读写在 treehole.ts。

export const TREEHOLE_CONSENT_VERSION = "2026-10-25";
export const TREEHOLE_SESSION_MODES = ["async", "live"] as const;
export const TREEHOLE_SESSION_TAGS = ["normal", "focus", "crisis"] as const;
export const TREEHOLE_CRISIS_URGENCIES = ["normal", "high", "urgent"] as const;
export const TREEHOLE_ROOM_CATEGORIES = ["praise", "vent", "cry", "relax", "other"] as const;
export const TREEHOLE_ROOM_FOUNDERS_REQUIRED = 3;
export const TREEHOLE_REVEAL_APPROVALS_REQUIRED = 2;
export const TREEHOLE_TEMP_ONLINE_MINUTES = 120;
// 打开的对话页至少每 15 秒刷新一次“正在看”，35 秒没刷新就当已经离开。
export const TREEHOLE_PRESENCE_SEEN_MS = 35_000;
export const TREEHOLE_RENOTIFY_MS = 30 * 60_000;

export type TreeholeSessionMode = typeof TREEHOLE_SESSION_MODES[number];
export type TreeholeSessionTag = typeof TREEHOLE_SESSION_TAGS[number];

export type TreeholeShiftLike = { weekday: number; startMinute: number; endMinute: number };

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** 北京时间的星期（1 = 周一 … 7 = 周日）和当天分钟数；与服务器时区无关。 */
export function shanghaiClock(now: Date) {
  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  return {
    weekday: local.getUTCDay() || 7,
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
    dayStartMs: Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - SHANGHAI_OFFSET_MS,
  };
}

export function normalizeShifts(shifts: TreeholeShiftLike[]) {
  const result: TreeholeShiftLike[] = [];
  for (const shift of shifts) {
    const weekday = Math.trunc(Number(shift.weekday));
    const startMinute = Math.trunc(Number(shift.startMinute));
    const endMinute = Math.trunc(Number(shift.endMinute));
    if (!(weekday >= 1 && weekday <= 7)) throw new Error("排班的星期不正确");
    if (!(startMinute >= 0 && endMinute <= 24 * 60 && startMinute < endMinute)) throw new Error("排班的开始时间要早于结束时间，且不能跨过零点");
    result.push({ weekday, startMinute, endMinute });
  }
  result.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  for (let i = 1; i < result.length; i += 1) {
    const previous = result[i - 1];
    if (previous.weekday === result[i].weekday && result[i].startMinute < previous.endMinute) {
      throw new Error("同一天的排班时间不能重叠");
    }
  }
  if (result.length > 42) throw new Error("每位洞主最多 42 个排班时段");
  return result;
}

/** 当前所在的排班时段及其结束时刻。 */
export function currentShift(shifts: TreeholeShiftLike[], now: Date) {
  const clock = shanghaiClock(now);
  const shift = shifts.find((item) => item.weekday === clock.weekday && item.startMinute <= clock.minute && clock.minute < item.endMinute);
  if (!shift) return null;
  return { shift, endsAt: new Date(clock.dayStartMs + shift.endMinute * 60_000) };
}

/** 从现在起七天内下一个排班的开始时刻。 */
export function nextShiftStart(shifts: TreeholeShiftLike[], now: Date) {
  const clock = shanghaiClock(now);
  let best: Date | null = null;
  for (const shift of shifts) {
    let dayOffset = (shift.weekday - clock.weekday + 7) % 7;
    if (dayOffset === 0 && shift.startMinute <= clock.minute) dayOffset = 7;
    const startsAt = new Date(clock.dayStartMs + dayOffset * DAY_MS + shift.startMinute * 60_000);
    if (!best || startsAt < best) best = startsAt;
  }
  return best;
}

export type TreeholePresenceInput = {
  isHost: boolean;
  enabled: boolean;
  presenceOverride?: string | null;
  presenceOverrideUntil?: Date | null;
  shifts: TreeholeShiftLike[];
};

export type TreeholePresence = {
  online: boolean;
  source: "schedule" | "manual" | "disabled";
  until: Date | null;
  inShift: boolean;
  nextShiftAt: Date | null;
};

/** 在岗 = 排班时段内且没有手动下线，或在排班外手动临时上线。手动状态到期后回到排班。 */
export function resolveHostPresence(input: TreeholePresenceInput, now: Date): TreeholePresence {
  const nextShiftAt = nextShiftStart(input.shifts, now);
  if (!input.isHost || !input.enabled) return { online: false, source: "disabled", until: null, inShift: false, nextShiftAt };
  const active = currentShift(input.shifts, now);
  const overrideActive = Boolean(input.presenceOverride && input.presenceOverrideUntil && input.presenceOverrideUntil > now);
  if (overrideActive && input.presenceOverride === "offline") {
    return { online: false, source: "manual", until: input.presenceOverrideUntil!, inShift: Boolean(active), nextShiftAt };
  }
  if (overrideActive && input.presenceOverride === "online") {
    return { online: true, source: "manual", until: input.presenceOverrideUntil!, inShift: Boolean(active), nextShiftAt };
  }
  return { online: Boolean(active), source: "schedule", until: active?.endsAt ?? null, inShift: Boolean(active), nextShiftAt };
}

/**
 * 洞主点“下线”或“上线”后要写入的手动状态。
 * 排班内下线到本时段结束为止，下个时段自动在岗；排班外上线临时保持两小时。
 */
export function presenceOverrideFor(action: "online" | "offline", shifts: TreeholeShiftLike[], now: Date) {
  const active = currentShift(shifts, now);
  if (action === "offline") {
    return active
      ? { presenceOverride: "offline", presenceOverrideUntil: active.endsAt }
      : { presenceOverride: null, presenceOverrideUntil: null };
  }
  return active
    ? { presenceOverride: null, presenceOverrideUntil: null }
    : { presenceOverride: "online", presenceOverrideUntil: new Date(now.getTime() + TREEHOLE_TEMP_ONLINE_MINUTES * 60_000) };
}

export type TreeholeSessionRole = "visitor" | "host" | "admin";

/**
 * 会话隔离（红线）：只有来访者本人、接待这次会话的洞主和核心管理员能看。
 * 其他洞主、其他来访者、站点管理员都返回 null。洞主被停用后也看不到。
 */
export function treeholeSessionRole(
  session: { visitorId: number; hostId: number },
  viewer: { userId: number; staffId: number | null; isHost: boolean; isAdmin: boolean },
): TreeholeSessionRole | null {
  if (session.visitorId === viewer.userId) return "visitor";
  if (viewer.isHost && viewer.staffId !== null && session.hostId === viewer.staffId) return "host";
  if (viewer.isAdmin) return "admin";
  return null;
}

const ALIAS_ALPHABET ="ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 每次新会话一个新的来访者虚拟 ID，与账号和以往会话都没有关联。 */
export function generateVisitorAlias(random: (max: number) => number = randomInt) {
  let code = "";
  for (let i = 0; i < 4; i += 1) code += ALIAS_ALPHABET[random(ALIAS_ALPHABET.length)];
  return `来访者 ${code}`;
}

export function normalizeHostCode(raw: string) {
  const value = String(raw || "").trim();
  if (!/^\d{1,2}$/u.test(value) || Number(value) < 1) throw new Error("洞主编号是 01 到 99 的两位数字");
  return value.padStart(2, "0");
}

export function hostDisplayName(hostCode: string | null | undefined) {
  return hostCode ? `小艾绒 ${hostCode}` : "小艾绒";
}

/** 宣泄室次序编号：优先复用在群成员没有占用的最小号，没有空号就顺延。 */
export function nextRoomSeq(usedSeqs: Iterable<number | null | undefined>) {
  const used = new Set<number>();
  for (const seq of usedSeqs) if (typeof seq === "number" && seq > 0) used.add(seq);
  let seq = 1;
  while (used.has(seq)) seq += 1;
  return seq;
}

/** 宣泄室虚拟 ID = 推荐洞主编号后两位 + 次序编号（至少两位），例如 01 + 67 = 0167。 */
export function roomVisitorAlias(hostCode: string, seq: number) {
  return `${hostCode.slice(-2).padStart(2, "0")}${String(seq).padStart(2, "0")}`;
}

const PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/u;
const CONTACT_HANDLE_PATTERN = /(?:qq|扣扣|企鹅|vx|wx|v信|微信|威信|wechat|weixin|手机号?|电话|tel)\s*(?:号|号码)?\s*[:：是为]?\s*[a-z0-9_-]{5,}/iu;
const ADD_FRIEND_PATTERN = /(?:加|➕|\+)\s*(?:我|一下|个)?\s*(?:qq|vx|wx|v信|微信|好友|联系方式)/iu;

/** 宣泄室禁止互加好友和私下联系：拦下手机号、QQ/微信号和“加我微信”一类的话。 */
export function looksLikeContactExchange(text: string) {
  const compact = String(text || "").replace(/[\s​-‍]+/gu, "");
  return PHONE_PATTERN.test(compact) || CONTACT_HANDLE_PATTERN.test(compact) || ADD_FRIEND_PATTERN.test(compact);
}

export type RevealApprovalState = {
  approvals: number;
  required: number;
  approved: boolean;
};

/** 溯源要两名不同的核心管理员同意。approverIds 已去重；提交人是管理员时本人算一票。 */
export function revealApprovalState(approverIds: number[]): RevealApprovalState {
  const approvals = new Set(approverIds).size;
  return {
    approvals,
    required: TREEHOLE_REVEAL_APPROVALS_REQUIRED,
    approved: approvals >= TREEHOLE_REVEAL_APPROVALS_REQUIRED,
  };
}

/**
 * 对方是否需要一条站内提醒：对方刚才还开着这个对话就不提醒；
 * 离开后只提醒一次，之后每半小时最多再提醒一次。
 */
export function shouldNotifyCounterpart(input: { seenAt?: Date | null; notifiedAt?: Date | null }, now: Date) {
  const seenAt = input.seenAt?.getTime() ?? 0;
  if (seenAt && now.getTime() - seenAt < TREEHOLE_PRESENCE_SEEN_MS) return false;
  const notifiedAt = input.notifiedAt?.getTime() ?? 0;
  if (!notifiedAt) return true;
  if (notifiedAt < seenAt) return true;
  return now.getTime() - notifiedAt >= TREEHOLE_RENOTIFY_MS;
}

export function roomCategoryLabel(category: string) {
  switch (category) {
    case "praise": return "夸夸室";
    case "vent": return "倾诉室";
    case "cry": return "哭哭室";
    case "relax": return "解压室";
    default: return "宣泄室";
  }
}
