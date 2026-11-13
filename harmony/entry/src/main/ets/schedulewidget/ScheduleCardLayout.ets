// 卡片排版里不依赖界面的那部分：正在上的课上到哪了、倒计时、放得下几门课、文字放大到哪一档。
// 卡片没有 iOS 的 ViewThatFits，放不放得下只能按行高算，所以每个数都和 ScheduleCardView 里的行高对应。

// 行高约为字号的 1.2 倍，pt 按 1:1 换成 vp。
export const CARD_HEADER_HEIGHT = 24;
// 「明天的课」胶囊一行：9fp 字 11 行高 + 上下各 2 的内边距，再隔上一行 4。
export const CARD_HINT_HEIGHT = 19;
// 今日课表大号一行：色条 40 + 上下各 6。
export const CARD_LARGE_ROW = 52;
// 今日课表中号一行：色条 29 + 上下各 3。
export const CARD_MEDIUM_ROW = 35;
// 两日课表一行：课名、地点、时间三行文字 40 + 上下各 4。
export const CARD_TWO_DAY_ROW = 48;
// 「后面还有 N 门课」：9fp 字 11 行高。
export const CARD_REMAINING = 11;
// 临近课程里正在上的那一节，时间下面多一条进度：隔 2，条高 4。小号放两节时没有余量，
// 三行文字的间隔从 3 收到 2，只多出 4。今日课表、两日课表的行本身留着白，进度画在行里，不长高。
export const CARD_PROGRESS_EXTRA = 6;
export const CARD_FITTED_PROGRESS_EXTRA = 4;
// 小号放两节时第一节的色条跟着文字走：课名 18 + 3 + 地点 12 + 3 + 时间 13。
export const CARD_FITTED_SUMMARY = 49;
// 小号只放一节、课名可以两行时：课名 36 + 3 + 地点 12 + 3 + 时间 13。
export const CARD_ROOMY_SUMMARY = 67;
// 中号临近课程的一栏：课名两行 32 + 2 + 地点 11 + 2 + 时间 12；课名一行少 16。
export const CARD_COLUMN_SUMMARY = 59;
// 中号一栏上面的「当前」「下一节」：13 行高，和课程隔 7。
export const CARD_COLUMN_LABEL = 20;
// 小号第二节课的色条高。
export const CARD_COMPACT_NEXT = 27;
// 大号今日课表下面预告的下一次课：标注一行 16，每门课色条 29 + 上下各 4，课与课、课与标注隔 6。
export const CARD_PREVIEW_BANNER = 16;
export const CARD_PREVIEW_ROW = 37;
// 预告只剩一行的地方时不列课：标注后面写第一门课和一共几门。
export const CARD_PREVIEW_SUMMARY = -1;

// 上课前多久开始显示「距上课」。
export const CARD_COUNTDOWN_LEAD_MS = 60 * 60 * 1000;

// 下课那一分钟里课还算没结束（各端同一条规则：下课时间早于当前分钟才算上完）。
export function cardEnded(endAt: number, nowMs: number): boolean {
  return endAt > 0 && nowMs >= endAt + 60000;
}

export function cardInProgress(startAt: number, endAt: number, nowMs: number): boolean {
  return startAt > 0 && endAt > startAt && nowMs >= startAt && nowMs < endAt;
}

// 上到哪了，0 到 1；没在上课是 0。
export function cardProgress(startAt: number, endAt: number, nowMs: number): number {
  if (!cardInProgress(startAt, endAt, nowMs)) return 0;
  return Math.min(1, Math.max(0, (nowMs - startAt) / (endAt - startAt)));
}

export interface CardCountdown {
  // 「距下课」「距上课」；空串表示这会儿不显示倒计时。
  title: string;
  seconds: number;
}

// 正在上的课数到下课，一小时之内要开始的课数到上课，其余不显示。只能用在今天的课上。
export function cardCountdown(startAt: number, endAt: number, nowMs: number): CardCountdown {
  if (cardInProgress(startAt, endAt, nowMs)) {
    return { title: '距下课', seconds: Math.ceil((endAt - nowMs) / 1000) };
  }
  if (startAt > 0 && endAt > startAt && nowMs < startAt && startAt - nowMs <= CARD_COUNTDOWN_LEAD_MS) {
    return { title: '距上课', seconds: Math.ceil((startAt - nowMs) / 1000) };
  }
  return { title: '', seconds: 0 };
}

// 「23:10」「1:02:03」，同 iOS 系统计时文字的写法。
export function cardClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const rest = total % 60;
  const two = (value: number): string => value < 10 ? `0${value}` : `${value}`;
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${minutes}:${two(rest)}`;
}

// 开头有几门课已经上完：卡片两次刷新之间自己往后挪，不等系统来刷。最后一门留着，
// 整天上完之后换成哪天的课要等刷新来定，这之前不让课程区空掉。
export function cardEndedPrefix(ends: number[], nowMs: number): number {
  let count = 0;
  while (count < ends.length - 1 && cardEnded(ends[count], nowMs)) count += 1;
  return count;
}

// 文字大小：从大到小试，第一个整块放得下的就用。needed 是标准大小下最满的排法要的高度，
// available 是标准大小下的可用高度；放大到 scale 倍时可用高度只剩 available / scale。
export function chooseCardScale(scales: number[], available: number, needed: number): number {
  for (const scale of scales) {
    if (needed <= available / scale + 0.5) return scale;
  }
  return scales.length > 0 ? scales[scales.length - 1] : 1;
}

function rowsHeight(count: number, row: number, spacing: number): number {
  return count * row + Math.max(0, count - 1) * spacing;
}

export function cardPreviewHeight(rows: number): number {
  if (rows === CARD_PREVIEW_SUMMARY) return 12 + CARD_PREVIEW_BANNER;
  return rows > 0 ? 16 + CARD_PREVIEW_BANNER + rows * (6 + CARD_PREVIEW_ROW) : 0;
}

export interface LargeTodayPlan {
  // 今天的课放几门。
  rows: number;
  // 下一次课预告几门；0 不预告，CARD_PREVIEW_SUMMARY 只有一行标注。
  preview: number;
}

// 今日课表大号（列表）课程区要的高度。
export function largeTodayHeight(rows: number, hidden: number): number {
  return rowsHeight(rows, CARD_LARGE_ROW, 8) + (hidden > 0 ? 10 + CARD_REMAINING : 0);
}

// available：日期栏和它下面的间隔之外剩下的高度。count 是拿到手的课（最多 7 门），remaining 是没拿到的。
// 今天的课都放得下、底下还有地方时接着预告下一次课，能放几门放几门（3、2、1，再不行只留一行标注）；
// 否则从多到少试，挑第一个连同「后面还有」一起放得下的门数。
export function largeTodayPlan(available: number, count: number, remaining: number, previewCount: number): LargeTodayPlan {
  if (count > 0 && remaining === 0 && previewCount > 0) {
    const all = largeTodayHeight(count, 0);
    for (let rows = Math.min(3, previewCount); rows >= 1; rows -= 1) {
      if (all + cardPreviewHeight(rows) <= available) return { rows: count, preview: rows };
    }
    if (all + cardPreviewHeight(CARD_PREVIEW_SUMMARY) <= available) return { rows: count, preview: CARD_PREVIEW_SUMMARY };
  }
  for (let rows = count; rows > 1; rows -= 1) {
    if (largeTodayHeight(rows, count - rows + remaining) <= available) return { rows, preview: 0 };
  }
  return { rows: Math.min(1, count), preview: 0 };
}

export interface MediumTodayPlan {
  rows: number;
  spacing: number;
  // 「后面还有」和上面那门课的间隔。
  footerGap: number;
}

// 今日课表中号最多两门：放不下时两门之间的间隔从 7 一档档收到 4，再放不下（文字放大了）只留一门。
export function mediumTodayPlan(available: number, count: number, remaining: number): MediumTodayPlan {
  const most = Math.min(2, count);
  for (let rows = most; rows >= 1; rows -= 1) {
    const hidden = count - rows + remaining;
    for (const spacing of [7, 6, 5, 4]) {
      const footerGap = spacing > 4 ? 8 : 4;
      const needed = rowsHeight(rows, CARD_MEDIUM_ROW, spacing) + (hidden > 0 ? footerGap + CARD_REMAINING : 0);
      if (needed <= available) return { rows, spacing, footerGap };
    }
  }
  return { rows: Math.min(1, count), spacing: 4, footerGap: 4 };
}

// 两日课表一列课程区要的高度。
export function twoDayHeight(rows: number, hidden: number): number {
  return rowsHeight(rows, CARD_TWO_DAY_ROW, 7) + (hidden > 0 ? 8 + CARD_REMAINING : 0);
}

// 两日课表每列最多 5 门，卡片矮（或文字放大了）时少放几门，剩下的数进「后面还有」。
export function twoDayPlan(available: number, count: number, remaining: number): number {
  for (let rows = count; rows > 1; rows -= 1) {
    if (twoDayHeight(rows, count - rows + remaining) <= available) return rows;
  }
  return Math.min(1, count);
}

// 日程卡片放得下几条。
export function agendaRowsThatFit(available: number, row: number, spacing: number, count: number): number {
  let rows = count;
  while (rows > 1 && rows * row + (rows - 1) * spacing > available) rows -= 1;
  return rows;
}
