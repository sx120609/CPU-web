// 日程：课表以外自己安排的事。最早做在药大拾间 NEXT 里（android-next/…/agenda/），现在网页和
// 各客户端共用同一份数据：每一条是 `/api/next-sync` 里 `agenda` 集合的一条记录，在哪一端改了，
// 其他端拉一次就能看到。这里是各端共用的规则，和 NEXT 的 Agenda.kt / AgendaParser.kt 逐条对应。
//
// 日期写成 `YYYY-MM-DD`，时间写成 `HH:MM`，一律按课表所在的时区（Asia/Shanghai，无夏令时）理解。

export type AgendaRepeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export interface AgendaItem {
  id: string;
  /** 1.1.0 之前日程和待办分开存；现在两者一样，只为读回旧数据保留。 */
  kind: "event" | "todo";
  title: string;
  /** 没有日期时为空。 */
  date: string;
  /** 全天的事为空。 */
  start: string;
  /** 晚于开始，可以不填。 */
  end: string;
  location: string;
  note: string;
  /** 提前几分钟提醒；-1 不提醒。 */
  remind: number;
  repeat: AgendaRepeat;
  /** 重复到哪一天为止（含当天）；空表示一直重复。 */
  until: string;
  done: boolean;
  /** 重复的事按天记完成。 */
  doneDates: string[];
  createdAt: number;
  updatedAt: number;
  /** 拾间AI 提议、用户确认后加的为 "assistant"。 */
  origin: "user" | "assistant";
}

export const AGENDA_COLLECTION = "agenda";
export const AGENDA_MAX_ITEMS = 600;
export const AGENDA_REMIND_NONE = -1;
/** 没有具体时间的事在当天这个时刻提醒。 */
export const AGENDA_UNTIMED_REMIND_MINUTES = 8 * 60;

export const AGENDA_REMIND_CHOICES: Array<{ value: number; label: string }> = [
  { value: AGENDA_REMIND_NONE, label: "不提醒" },
  { value: 0, label: "准时" },
  { value: 5, label: "5 分钟前" },
  { value: 15, label: "15 分钟前" },
  { value: 30, label: "30 分钟前" },
  { value: 60, label: "1 小时前" },
  { value: 1440, label: "1 天前" },
];

export const AGENDA_REPEAT_CHOICES: Array<{ value: AgendaRepeat; label: string }> = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "工作日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
];

const ID = /^[a-z0-9]{6,24}$/u;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME = /^(\d{2}):(\d{2})$/u;
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function agendaRemindLabel(minutes: number) {
  return AGENDA_REMIND_CHOICES.find((choice) => choice.value === minutes)?.label ?? `${minutes} 分钟前`;
}

export function agendaRepeatLabel(repeat: AgendaRepeat) {
  return AGENDA_REPEAT_CHOICES.find((choice) => choice.value === repeat)?.label ?? "不重复";
}

export function newAgendaId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "a";
  for (let index = 0; index < 11; index += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return id;
}

// MARK: 日期和时间

/** 合法的日期返回从 1970-01-01 起的天数，否则为 null。 */
export function agendaDayNumber(value: unknown): number | null {
  const match = DATE.exec(String(value ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return Math.round(time / DAY_MS);
}

export function agendaDateOf(dayNumber: number) {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

export function agendaAddDays(date: string, days: number) {
  const day = agendaDayNumber(date);
  return day === null ? "" : agendaDateOf(day + days);
}

/** 星期几，1 = 周一 … 7 = 周日。 */
export function agendaWeekday(date: string) {
  const day = agendaDayNumber(date);
  if (day === null) return 0;
  const sunday0 = new Date(day * DAY_MS).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

/** 「08:05」→ 485；不是合法时间时为 null。 */
export function agendaClockMinutes(value: unknown): number | null {
  const match = TIME.exec(String(value ?? ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

export function agendaClockText(minutes: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** 上海时间的某天某分钟对应的时间戳。 */
export function agendaEpoch(date: string, minutes: number) {
  const day = agendaDayNumber(date);
  return day === null ? NaN : day * DAY_MS + minutes * 60_000 - CHINA_OFFSET_MS;
}

/** 时间戳在上海时间是哪一天、当天第几分钟。 */
export function agendaChinaClock(epochMs: number) {
  const shifted = epochMs + CHINA_OFFSET_MS;
  const dayNumber = Math.floor(shifted / DAY_MS);
  return { date: agendaDateOf(dayNumber), minutes: Math.floor((shifted - dayNumber * DAY_MS) / 60_000) };
}

// MARK: 规整

function clip(value: string, codePoints: number) {
  const chars = Array.from(value);
  return chars.length <= codePoints ? value : chars.slice(0, codePoints).join("");
}

/**
 * 存储或别处传来的一条日程，规整成能显示的样子：截短文字、丢掉不存在的日期和时间、
 * 结束不晚于开始就去掉结束；连标题都没有的返回 null。和 NEXT 的 `AgendaCodec.normalize` 一致。
 */
export function normalizeAgendaItem(input: unknown): AgendaItem | null {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const id = typeof value.id === "string" && ID.test(value.id) ? value.id : "";
  if (!id) return null;
  const title = clip(String(value.title ?? "").trim().replace(/\s+/gu, " "), 60);
  if (!title) return null;
  const date = agendaDayNumber(value.date) === null ? "" : String(value.date);
  const start = date && agendaClockMinutes(value.start) !== null ? String(value.start) : "";
  const startMinutes = agendaClockMinutes(start);
  const endMinutes = agendaClockMinutes(value.end);
  const end = start && endMinutes !== null && startMinutes !== null && endMinutes > startMinutes ? String(value.end) : "";
  const repeatValue = String(value.repeat ?? "none");
  const repeat: AgendaRepeat = date && AGENDA_REPEAT_CHOICES.some((choice) => choice.value === repeatValue)
    ? repeatValue as AgendaRepeat
    : "none";
  const untilDay = agendaDayNumber(value.until);
  const until = repeat !== "none" && untilDay !== null && untilDay >= agendaDayNumber(date)! ? String(value.until) : "";
  const remindValue = Number(value.remind);
  const remind = date && Number.isInteger(remindValue) && (remindValue === AGENDA_REMIND_NONE || (remindValue >= 0 && remindValue <= 10_080))
    ? remindValue
    : AGENDA_REMIND_NONE;
  const doneDates = repeat === "none" || !Array.isArray(value.doneDates)
    ? []
    : [...new Set(value.doneDates.filter((day): day is string => typeof day === "string" && agendaDayNumber(day) !== null))].slice(-400);
  const number = (raw: unknown) => (Number.isFinite(Number(raw)) && Number(raw) > 0 ? Math.floor(Number(raw)) : 0);
  return {
    id,
    kind: value.kind === "todo" ? "todo" : "event",
    title,
    date,
    start,
    end,
    location: clip(String(value.location ?? "").trim(), 40),
    note: clip(String(value.note ?? ""), 1_000),
    remind,
    repeat,
    until,
    done: repeat === "none" && value.done === true,
    doneDates,
    createdAt: number(value.createdAt),
    updatedAt: number(value.updatedAt),
    origin: value.origin === "assistant" ? "assistant" : "user",
  };
}

// MARK: 哪几天有

export function agendaOccursOn(item: AgendaItem, date: string) {
  const first = agendaDayNumber(item.date);
  const day = agendaDayNumber(date);
  if (first === null || day === null || day < first) return false;
  const until = agendaDayNumber(item.until);
  if (until !== null && day > until) return false;
  switch (item.repeat) {
    case "none": return day === first;
    case "daily": return true;
    case "weekdays": return agendaWeekday(date) <= 5;
    case "weekly": return agendaWeekday(date) === agendaWeekday(item.date);
    case "monthly": return date.slice(8) === item.date.slice(8);
    default: return false;
  }
}

export function agendaDoneOn(item: AgendaItem, date: string) {
  return item.repeat === "none" ? item.done : item.doneDates.includes(date);
}

export interface AgendaOccurrence {
  item: AgendaItem;
  date: string;
  done: boolean;
}

/** 某一天的全部日程：全天的在前，其余按开始时间，再按添加的先后。 */
export function agendaOn(items: AgendaItem[], date: string): AgendaOccurrence[] {
  return items
    .filter((item) => agendaOccursOn(item, date))
    .sort((a, b) => Number(Boolean(a.start)) - Number(Boolean(b.start)) || a.start.localeCompare(b.start) || a.createdAt - b.createdAt)
    .map((item) => ({ item, date, done: agendaDoneOn(item, date) }));
}

/** 不重复、还没完成、没有具体时间而日期已过的事（逾期待办）。 */
export function agendaOverdue(item: AgendaItem, today: string) {
  const day = agendaDayNumber(item.date);
  return !item.done && item.repeat === "none" && !item.start && day !== null && day < agendaDayNumber(today)!;
}

/** 还要做的：日期已过而没勾掉的待办，再是没有日期的，按添加的先后。 */
export function agendaOpen(items: AgendaItem[], today: string) {
  const candidates = items.filter((item) => item.repeat === "none" && !item.done);
  const overdue = candidates.filter((item) => agendaOverdue(item, today)).sort((a, b) => a.date.localeCompare(b.date));
  return [...overdue, ...candidates.filter((item) => !item.date).sort((a, b) => a.createdAt - b.createdAt)];
}

/** 勾掉或取消勾掉一次（重复的事只改那一天）。返回新的一条，`updatedAt` 由调用方填。 */
export function agendaWithDone(item: AgendaItem, date: string, done: boolean): AgendaItem {
  if (item.repeat === "none") return { ...item, done };
  const dates = new Set(item.doneDates);
  if (done) dates.add(date);
  else dates.delete(date);
  return { ...item, doneDates: [...dates].sort().slice(-400) };
}

// MARK: 提醒

/** 这一次在什么时刻提醒（时间戳），不提醒时为 null。没有具体时间的只认「准时」和「1 天前」。 */
export function agendaReminderAt(item: AgendaItem, date: string): number | null {
  if (item.remind < 0) return null;
  const start = agendaClockMinutes(item.start);
  const minutes = start ?? AGENDA_UNTIMED_REMIND_MINUTES;
  const before = start === null ? (item.remind >= 1440 ? 1440 : 0) : item.remind;
  return agendaEpoch(date, minutes - before);
}

export interface AgendaReminder {
  /** 和 NEXT 上传给服务器的提醒计划同一种写法，服务器据此去重。 */
  key: string;
  at: number;
  date: string;
  item: AgendaItem;
  title: string;
  text: string;
}

export function agendaReminderKey(item: Pick<AgendaItem, "id">, date: string) {
  return `agenda:${item.id}:${date}`;
}

/** (from, until] 之间要响的提醒，最早的在前；已经勾掉的那一次不提醒。 */
export function agendaReminders(items: AgendaItem[], from: number, until: number, limit = 400): AgendaReminder[] {
  const result: AgendaReminder[] = [];
  // 提醒最多提前一周，所以只看到 until 之后一周为止的日子。
  const lastDay = agendaDayNumber(agendaChinaClock(until + 7 * DAY_MS).date)!;
  const today = agendaChinaClock(from).date;
  for (const item of items) {
    if (item.remind < 0 || !item.date) continue;
    const first = agendaDayNumber(item.date)!;
    let day = Math.max(first, agendaDayNumber(today)! - 1);
    for (; day <= lastDay; day += 1) {
      const date = agendaDateOf(day);
      if (agendaOccursOn(item, date) && !agendaDoneOn(item, date)) {
        const at = agendaReminderAt(item, date);
        if (at !== null && at > from && at <= until) {
          const when = [
            agendaReminderDayText(date, today),
            item.start ? (item.end ? `${item.start}–${item.end}` : item.start) : "",
            item.location.trim(),
          ].filter(Boolean).join(" · ");
          result.push({ key: agendaReminderKey(item, date), at, date, item, title: `日程提醒 · ${item.title}`.slice(0, 60), text: when.slice(0, 120) });
        }
      }
      if (item.repeat === "none") break;
    }
  }
  return result.sort((a, b) => a.at - b.at).slice(0, limit);
}

function agendaReminderDayText(date: string, today: string) {
  if (date === today) return "";
  if (date === agendaAddDays(today, 1)) return "明天";
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
}

// MARK: 课表网格上的位置

/**
 * 某个钟点在 `rowHeight` 高、相隔 `gap` 的节次网格上落在哪：节次里按比例，课间按比例
 * 跨过间隙，第一节之前和最后一节之后贴边。和 NEXT 的 `agendaOffset` 一致。
 */
export function agendaGridOffset(minutes: number, periods: Array<{ start: string; end: string }>, rowHeight: number, gap: number) {
  const step = rowHeight + gap;
  let previousEnd: number | null = null;
  for (const [index, period] of periods.entries()) {
    const start = agendaClockMinutes(period.start);
    const end = agendaClockMinutes(period.end);
    if (start === null || end === null) return 0;
    if (minutes < start) {
      if (index === 0) return 0;
      const breakStart = previousEnd ?? start;
      const length = Math.max(1, start - breakStart);
      return index * step - gap + gap * Math.min(length, Math.max(0, minutes - breakStart)) / length;
    }
    if (minutes <= end) return index * step + rowHeight * (minutes - start) / Math.max(1, end - start);
    previousEnd = end;
  }
  return Math.max(0, periods.length * step - gap);
}

// MARK: 一句话记下

type Period = "dawn" | "morning" | "noon" | "afternoon" | "evening";

function periodOf(word: string): Period {
  if (word === "凌晨") return "dawn";
  if (word === "早上" || word === "早晨" || word === "上午") return "morning";
  if (word === "中午") return "noon";
  if (word === "下午" || word === "傍晚") return "afternoon";
  return "evening";
}

const CHINESE_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function chineseNumber(text: string): number | null {
  if (text === "十") return 10;
  const tenAt = text.indexOf("十");
  if (tenAt < 0) return text.length === 1 ? CHINESE_DIGITS[text] ?? null : null;
  const tens = tenAt === 0 ? 1 : CHINESE_DIGITS[text[0]];
  if (tens === undefined) return null;
  const ones = tenAt === text.length - 1 ? 0 : CHINESE_DIGITS[text[tenAt + 1]];
  if (ones === undefined) return null;
  return tens * 10 + ones;
}

/** 全角数字和「点、时、号、日、天、月、分、小时」前的中文数字换成阿拉伯数字。 */
export function normalizeAgendaDigits(input: string) {
  const ascii = Array.from(input).map((char) => {
    const code = char.charCodeAt(0);
    if (code >= 0xff10 && code <= 0xff19) return String.fromCharCode(code - 0xff10 + 48);
    return char === "：" ? ":" : char;
  }).join("");
  return ascii.replace(/([零一二两三四五六七八九十]{1,3})(?=点|时|号|日|天|月|分钟|分|个?小时|周后)/gu,
    (match) => String(chineseNumber(match) ?? match));
}

function weekdayNumber(word: string) {
  return ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 } as Record<string, number>)[word] ?? 7;
}

/** 从 `today` 起（含当天）的下一个星期 `weekday`。 */
function nextOrSameWeekday(today: string, weekday: number) {
  const offset = (weekday - agendaWeekday(today) + 7) % 7;
  return agendaAddDays(today, offset);
}

/** 「周三」是下一个周三（含今天）；「这周三」本周的；「下周三」下周的。 */
function weekdayDate(today: string, prefix: string, weekday: number) {
  const monday = agendaAddDays(today, 1 - agendaWeekday(today));
  if (prefix === "下下") return agendaAddDays(monday, 14 + weekday - 1);
  if (prefix === "下") return agendaAddDays(monday, 7 + weekday - 1);
  if (prefix === "这" || prefix === "本") return agendaAddDays(monday, weekday - 1);
  return nextOrSameWeekday(today, weekday);
}

function safeDate(year: number, month: number, day: number) {
  const text = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return agendaDayNumber(text) === null ? "" : text;
}

/** 今年的某月某日，已经过了就是明年的。 */
function upcoming(today: string, month: number, day: number) {
  const year = Number(today.slice(0, 4));
  const thisYear = safeDate(year, month, day);
  if (!thisYear) return "";
  return thisYear < today ? safeDate(year + 1, month, day) : thisYear;
}

function nextDayOfMonth(today: string, day: number) {
  if (day < 1 || day > 31) return "";
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let index = 0; index < 13; index += 1) {
    const candidate = safeDate(year, month, day);
    if (candidate && candidate >= today) return candidate;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return "";
}

function clockOf(hour: string, colonMinutes: string | undefined, halfOrQuarter: string | undefined, pointMinutes: string | undefined): [number, number] | null {
  const h = Number(hour);
  if (!Number.isInteger(h)) return null;
  let m = 0;
  if (colonMinutes) m = Number(colonMinutes);
  else if (halfOrQuarter === "半") m = 30;
  else if (halfOrQuarter === "一刻") m = 15;
  else if (halfOrQuarter === "三刻") m = 45;
  else if (pointMinutes) m = Number(pointMinutes);
  return h >= 0 && h <= 24 && m >= 0 && m <= 59 ? [h === 24 ? 0 : h, m] : null;
}

function applyPeriod([hour, minute]: [number, number], period: Period | null): [number, number] {
  if (period === "afternoon" || period === "evening") return [hour >= 1 && hour <= 11 ? hour + 12 : hour, minute];
  if (period === "noon") return [hour >= 1 && hour <= 5 ? hour + 12 : hour, minute];
  if (period === "dawn" || period === "morning") return [hour === 12 ? 0 : hour, minute];
  return [hour, minute];
}

function removeAt(text: string, index: number, length: number) {
  return text.slice(0, index) + text.slice(index + length);
}

/** 去掉匹配到的部分；`skip` 是匹配开头不属于这一项的字符数（代替后行断言）。 */
function removeMatch(text: string, match: RegExpExecArray, skip = 0) {
  return removeAt(text, match.index + skip, match[0].length - skip);
}

const TRIM_CHARS = new Set(["，", ",", "。", "：", ":", "、", " ", "的", "要", "在"]);

function trimChars(value: string) {
  const chars = Array.from(value);
  let start = 0;
  let end = chars.length;
  while (start < end && TRIM_CHARS.has(chars[start])) start += 1;
  while (end > start && TRIM_CHARS.has(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join("");
}

/** 一句话解析出来的日程，还没有 id。 */
export type AgendaDraft = Omit<AgendaItem, "id" | "createdAt" | "updatedAt" | "done" | "doneDates" | "origin" | "note" | "until">;

/**
 * 把「明天下午3点 实验报告」「每周三晚上7点 羽毛球 @体育馆」这样的一句话读成一条日程：
 * 认识常见的中文日期、时间、时间段、重复、提醒和 `@地点`，剩下的就是标题。离线完成，
 * 规则与 NEXT 的 `AgendaParser` 一致（不用后行断言：iOS 15–16 的 WebKit 不支持）。
 */
export function parseAgendaText(input: string, nowMs: number = Date.now()): AgendaDraft {
  let text = normalizeAgendaDigits(input).trim();
  const now = agendaChinaClock(nowMs);
  const today = now.date;

  let remind = AGENDA_REMIND_NONE;
  const remindMatch = /提前\s*(\d+|半)\s*(分钟|分|个?小时|天)\s*(提醒我?|通知我?)?/u.exec(text);
  if (remindMatch) {
    const amount = remindMatch[1] === "半" ? -1 : Number(remindMatch[1]);
    const unit = remindMatch[2];
    if (unit.endsWith("天")) remind = (amount < 0 ? 1 : amount) * 1440;
    else if (unit.endsWith("小时")) remind = amount < 0 ? 30 : amount * 60;
    else remind = amount < 0 ? 30 : amount;
    remind = Math.min(remind, 10_080);
    text = removeMatch(text, remindMatch);
  }
  const asksReminder = /提醒我|提醒一下|叫我|通知我|提醒/u.test(text);
  text = text.replace(/提醒我一下|提醒我|提醒一下|叫我|通知我|记得|别忘了|帮我|请|添加|新建|加个|加一个|记一下|安排/gu, " ");

  let repeat: AgendaRepeat = "none";
  let date = "";
  let match: RegExpExecArray | null;
  if ((match = /每(?:天|日)/u.exec(text))) { repeat = "daily"; text = removeMatch(text, match); }
  if ((match = /(?:每个?)?工作日/u.exec(text))) { repeat = "weekdays"; text = removeMatch(text, match); }
  if ((match = /每(?:个)?(?:周|星期|礼拜)([一二三四五六日天7])/u.exec(text))) {
    repeat = "weekly";
    date = nextOrSameWeekday(today, weekdayNumber(match[1]));
    text = removeMatch(text, match);
  }
  if ((match = /每(?:个)?月(\d{1,2})[号日]/u.exec(text))) {
    repeat = "monthly";
    date = nextDayOfMonth(today, Number(match[1]));
    text = removeMatch(text, match);
  }

  let period: Period | null = null;
  const dateRules: Array<[RegExp, (m: RegExpExecArray) => string, number?]> = [
    [/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日号]?/u, (m) => safeDate(Number(m[1]), Number(m[2]), Number(m[3]))],
    [/(\d{1,2})月(\d{1,2})[日号]?/u, (m) => upcoming(today, Number(m[1]), Number(m[2]))],
    // 「10/25」：前面不能紧挨着数字或冒号（时间里的 12:30/45 不算）。
    [/(^|[^\d:])(\d{1,2})\/(\d{1,2})(?![\d:])/u, (m) => upcoming(today, Number(m[2]), Number(m[3])), 1],
    [/大后天/u, () => agendaAddDays(today, 3)],
    [/后天/u, () => agendaAddDays(today, 2)],
    [/明早|明天早上|明天上午/u, () => { period = "morning"; return agendaAddDays(today, 1); }],
    [/明晚|明天晚上/u, () => { period = "evening"; return agendaAddDays(today, 1); }],
    [/明天|明日/u, () => agendaAddDays(today, 1)],
    [/今早|今天早上|今天上午/u, () => { period = "morning"; return today; }],
    [/今晚|今夜|今天晚上/u, () => { period = "evening"; return today; }],
    [/今天|今日/u, () => today],
    [/(下下|下|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天7])/u, (m) => weekdayDate(today, m[1] ?? "", weekdayNumber(m[2]))],
    [/(\d{1,3})天(?:后|以后|之后)/u, (m) => agendaAddDays(today, Number(m[1]))],
    // 「25号」：前面不能紧挨着数字或「月」。
    [/(^|[^\d月])(\d{1,2})[号日](?!\d)/u, (m) => nextDayOfMonth(today, Number(m[2])), 1],
  ];
  if (!date) {
    for (const [regex, resolve, prefixGroup] of dateRules) {
      const found = regex.exec(text);
      if (!found) continue;
      const resolved = resolve(found);
      if (!resolved) continue;
      date = resolved;
      text = removeMatch(text, found, prefixGroup ? found[prefixGroup].length : 0);
      break;
    }
  }

  // 时段词可以和时间分开写：「下午 3点」。
  if ((match = /凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里/u.exec(text))) {
    period = periodOf(match[0]);
    text = removeMatch(text, match);
  }
  let start: [number, number] | null = null;
  let end: [number, number] | null = null;
  const clock = "(\\d{1,2})(?:[:：](\\d{2})|点(半|一刻|三刻|(\\d{1,2})分?)?|时)";
  const range = new RegExp(`${clock}\\s*(?:-|~|～|到|至|—)\\s*${clock}`, "u").exec(text);
  if (range) {
    start = clockOf(range[1], range[2], range[3], range[4]);
    end = clockOf(range[5], range[6], range[7], range[8]);
    text = removeMatch(text, range);
  } else {
    const single = new RegExp(clock, "u").exec(text);
    if (single) {
      start = clockOf(single[1], single[2], single[3], single[4]);
      text = removeMatch(text, single);
    }
  }
  // 不说上午下午时，1–6 点按下午算：说上课、开会时一般这样说。
  if (start) start = period === null && start[0] >= 1 && start[0] <= 6 ? [start[0] + 12, start[1]] : applyPeriod(start, period);
  if (end) {
    const shifted = applyPeriod(end, period);
    // 「下午3点到5点」「19:00-21:00」：结束跟着开始在一天的哪一半。
    end = start && shifted[0] * 60 + shifted[1] <= start[0] * 60 + start[1] && shifted[0] < 12 ? [shifted[0] + 12, shifted[1]] : shifted;
  }

  let location = "";
  if ((match = /[@＠]\s*([^\s，,。；;]{1,20})/u.exec(text))) { location = match[1]; text = removeMatch(text, match); }
  if ((match = /地点\s*[:：]\s*([^\s，,。；;]{1,20})/u.exec(text))) { location = match[1]; text = removeMatch(text, match); }

  const explicitTodo = /待办|todo|TODO|任务|要做/u.test(text);
  text = text.replace(/待办事项|待办|todo|TODO|日程|一个|一下/gu, " ");
  const title = trimChars(text.replace(/\s+/gu, " ").trim()) || "未命名";
  const deliverable = /^(交|提交|完成|写|做|买|取|还|带|复习|预习|打印|缴|报名|准备|看|背|整理|洗|打扫|回复|联系)/u.test(title);

  // 只说了时间：今天，那个时刻已经过了就是明天。
  if (!date && start) date = agendaEpoch(today, start[0] * 60 + start[1]) < nowMs ? agendaAddDays(today, 1) : today;
  const kind: AgendaItem["kind"] = explicitTodo || !date ? "todo" : end ? "event" : deliverable ? "todo" : "event";
  if (remind === AGENDA_REMIND_NONE && asksReminder && date) remind = 0;
  return {
    kind,
    title,
    date,
    start: start ? agendaClockText(start[0] * 60 + start[1]) : "",
    end: end ? agendaClockText(end[0] * 60 + end[1]) : "",
    location,
    remind,
    repeat,
  };
}
