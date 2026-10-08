import { NativeCourseBlock } from './NativeScheduleStore';
import { PlacedCourseBlock, placeScheduleBlocks } from './SchedulePlacement';
import { RawShareDocument } from './ScheduleSharing';

// The couple timetable ("情侣课表"): two bound accounts see each other's classes in one grid. The
// rules here are the Web's (web/src/views/schedule/couple.ts), as plain values so they can be
// checked without a device. See docs/couple-schedule.md.

export interface CoupleMember {
  nickname: string;
  // One of COUPLE_COLORS.
  color: string;
  // When this side's timetable last reached the server; empty when it never did.
  syncedAt: string;
}

export interface CoupleStatus {
  // unknown (not asked yet) | none | pending (the user made an invite nobody accepted yet) | active
  kind: string;
  code: string;
  expired: boolean;
  anniversary: string;
  me: CoupleMember;
  partner: CoupleMember;
}

// The server's answers, before anything in them is trusted. A member of the status answer and a
// timetable snapshot of the schedules answer share the field names `me` and `partner`.
interface RawCoupleSnapshotMeta { syncedAt?: string; }
interface RawCoupleInvite { code?: string | null; expired?: boolean; }
export interface RawCoupleParty extends RawShareDocument {
  nickname?: string;
  color?: string;
  snapshot?: RawCoupleSnapshotMeta | null;
}
export interface RawCoupleStatus {
  status?: string;
  anniversary?: string | null;
  invite?: RawCoupleInvite;
  me?: RawCoupleParty | null;
  partner?: RawCoupleParty | null;
}

/** One person's colours: every course of theirs is drawn in them. */
export interface CoupleTint {
  fill: string;
  border: string;
  text: string;
}

/** A course of one day with its clock times, for "what is TA doing now". */
export interface CoupleTimedCourse {
  name: string;
  start: string;
  end: string;
}

/** The colours a person can pick. The same seven as the Web and the server. */
export const COUPLE_COLORS: string[] = ['blue', 'pink', 'purple', 'teal', 'green', 'amber', 'orange'];
const COUPLE_HUES: number[] = [214, 338, 268, 178, 138, 42, 22];
const COUPLE_COLOR_NAMES: string[] = ['蓝', '粉', '紫', '青', '绿', '黄', '橙'];

/** A colour key as the server sent it; one this build does not know is blue. */
export function coupleColorKey(value?: string): string {
  return COUPLE_COLORS.includes(value ?? '') ? (value ?? 'blue') : 'blue';
}

export function coupleColorName(color: string): string {
  return COUPLE_COLOR_NAMES[Math.max(0, COUPLE_COLORS.indexOf(color))];
}

function emptyMember(): CoupleMember { return { nickname: '', color: 'blue', syncedAt: '' }; }

export function emptyCoupleStatus(kind: string = 'unknown'): CoupleStatus {
  return { kind, code: '', expired: false, anniversary: '', me: emptyMember(), partner: emptyMember() };
}

function memberFrom(raw?: RawCoupleParty | null): CoupleMember {
  return { nickname: String(raw?.nickname ?? '').trim(), color: coupleColorKey(raw?.color),
    syncedAt: String(raw?.snapshot?.syncedAt ?? '') };
}

export function coupleStatusFrom(raw?: RawCoupleStatus | null): CoupleStatus {
  const status = emptyCoupleStatus('none');
  if (raw?.status === 'pending') {
    status.kind = 'pending';
    status.code = String(raw.invite?.code ?? '');
    status.expired = raw.invite?.expired !== false;
  } else if (raw?.status === 'active') {
    status.kind = 'active';
    status.anniversary = String(raw.anniversary ?? '');
    status.me = memberFrom(raw.me);
    status.partner = memberFrom(raw.partner);
  }
  return status;
}

/** CSS `hsl()` with whole-number hue, saturation and lightness, as `#RRGGBB`. */
export function coupleHsl(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - chroma / 2;
  const sector = Math.floor(h / 60);
  const rgb: number[] = sector === 0 ? [chroma, x, 0] : sector === 1 ? [x, chroma, 0] : sector === 2 ? [0, chroma, x]
    : sector === 3 ? [0, x, chroma] : sector === 4 ? [x, 0, chroma] : [chroma, 0, x];
  return '#' + rgb.map((value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * One person, one colour: all of a person's courses are drawn in it, so the two timetables can
 * be told apart at a glance (the Web's `couplePersonTone`).
 */
export function couplePersonTone(color: string, dark: boolean): CoupleTint {
  const hue = COUPLE_HUES[Math.max(0, COUPLE_COLORS.indexOf(color))];
  return dark
    ? { fill: coupleHsl(hue, 48, 29), border: coupleHsl(hue, 62, 50), text: '#F5F7FF' }
    : { fill: coupleHsl(hue, 88, 93), border: coupleHsl(hue, 72, 77), text: coupleHsl(hue, 58, 27) };
}

/** Two blocks are the same class when they fill the same periods under the same name. */
export function coupleBlockKey(block: PlacedCourseBlock): string {
  return `${block.whole.startSlot}|${block.whole.endSlot}|${(block.course.name ?? '').replace(/\s+/g, '')}`;
}

function owned(block: PlacedCourseBlock, owner: string, notes: PlacedCourseBlock[]): PlacedCourseBlock {
  return { id: owner === 'ta' ? 'ta-' + block.id : block.id, day: block.day, bigSlot: block.bigSlot,
    startSlot: block.startSlot, endSlot: block.endSlot, lane: block.lane, lanes: block.lanes, course: block.course,
    whole: block.whole, offWeek: block.offWeek, owner, notes };
}

/**
 * One day of both timetables. A class both attend is the user's tile, drawn once. Courses never
 * share a column with the other person's: one of the partner's that meets one of the user's gets
 * no tile, it is written as a line under the user's course (`notes`). The rest of the partner's
 * courses keep a full tile.
 */
export function mergeCoupleBlocks(mine: PlacedCourseBlock[], theirs: PlacedCourseBlock[]): PlacedCourseBlock[] {
  const keys: string[] = mine.map((block: PlacedCourseBlock) => coupleBlockKey(block));
  const shared: string[] = theirs.map((block: PlacedCourseBlock) => coupleBlockKey(block)).filter((key: string) => keys.includes(key));
  const none: PlacedCourseBlock[] = [];
  const partner: PlacedCourseBlock[] = theirs.filter((block: PlacedCourseBlock) => !keys.includes(coupleBlockKey(block)))
    .map((block: PlacedCourseBlock) => owned(block, 'ta', none));
  const meets = (a: PlacedCourseBlock, b: PlacedCourseBlock): boolean => a.startSlot <= b.endSlot && b.startSlot <= a.endSlot;
  const merged: PlacedCourseBlock[] = mine.map((block: PlacedCourseBlock) => {
    return owned(block, shared.includes(coupleBlockKey(block)) ? 'both' : 'me',
      partner.filter((other: PlacedCourseBlock) => meets(other, block)));
  });
  partner.forEach((block: PlacedCourseBlock) => {
    if (!mine.some((other: PlacedCourseBlock) => meets(other, block))) merged.push(block);
  });
  return merged;
}

/** The line under one of the user's courses: the partner's course then, or how many. */
export function coupleNoteLabel(notes: PlacedCourseBlock[]): string {
  return notes.length > 1 ? `${notes.length} 门课` : (notes.length ? notes[0].course.name : '');
}

/** The partner's side of a day: their own tiles, the courses written as notes, and the classes both attend. */
export function couplePartnerSide(merged: PlacedCourseBlock[]): PlacedCourseBlock[] {
  const blocks: NativeCourseBlock[] = [];
  const seen: string[] = [];
  const add = (block: PlacedCourseBlock): void => {
    const key = coupleBlockKey(block);
    if (seen.includes(key)) return;
    seen.push(key);
    blocks.push(block.whole);
  };
  merged.forEach((block: PlacedCourseBlock) => {
    if (block.owner === 'ta') add(block);
    (block.notes ?? []).forEach((note: PlacedCourseBlock) => add(note));
  });
  const none: Record<string, number> = {};
  const empty: PlacedCourseBlock[] = [];
  const side: PlacedCourseBlock[] = placeScheduleBlocks(blocks, none).map((block: PlacedCourseBlock) => owned(block, 'ta', empty));
  merged.forEach((block: PlacedCourseBlock) => {
    if (block.owner !== 'both') return;
    const copy = owned(block, 'both', empty);
    copy.id = 'both-' + block.id;
    copy.lane = 0;
    copy.lanes = 1;
    side.push(copy);
  });
  return side;
}

function epochDay(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return NaN;
  const time = Date.UTC(Number(date.substring(0, 4)), Number(date.substring(5, 7)) - 1, Number(date.substring(8, 10)));
  // "2026-02-30" rolls over into March: not a date.
  return new Date(time).toISOString().substring(0, 10) === date ? Math.floor(time / 86400000) : NaN;
}

/** Day 1 is the anniversary itself. 0 without one, or when it is not in the past. */
export function coupleDaysTogether(anniversary: string, today: string): number {
  const start = epochDay(anniversary);
  const end = epochDay(today);
  return isNaN(start) || isNaN(end) || end < start ? 0 : end - start + 1;
}

function clockMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

/**
 * What the partner is doing at `minutes` past midnight. `inTerm` is false when today is outside
 * the partner's term. `short` is the status line (with the name); the sheet uses the long form.
 */
export function coupleNowText(name: string, hasData: boolean, inTerm: boolean, courses: CoupleTimedCourse[], minutes: number,
  short: boolean = true): string {
  const who = short ? (name || 'TA') + ' ' : '';
  if (!hasData) return who + '还没有同步课表';
  if (!inTerm) return who + '今天不在学期内';
  if (!courses.length) return who + '今天没有课';
  const ordered = courses.slice().sort((left: CoupleTimedCourse, right: CoupleTimedCourse) => clockMinutes(left.start) - clockMinutes(right.start));
  const current = ordered.find((item: CoupleTimedCourse) => clockMinutes(item.start) <= minutes && minutes < clockMinutes(item.end));
  if (current) return short ? `${who}在上《${current.name}》· ${current.end} 下课` : `在上《${current.name}》，${current.end} 下课`;
  const next = ordered.find((item: CoupleTimedCourse) => clockMinutes(item.start) > minutes);
  if (next) return short ? `${who}下一节《${next.name}》· ${next.start}` : `下一节《${next.name}》${next.start} 开始`;
  return who + '今天的课都上完了';
}

/** "3 小时前" for a server timestamp; empty when it cannot be read. */
export function coupleRelativeTime(iso: string, now: number): string {
  const time = Date.parse(iso ?? '');
  if (isNaN(time)) return '';
  const elapsed = now - time;
  if (elapsed < 60000) return '刚刚';
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} 小时前`;
  if (elapsed < 30 * 86400000) return `${Math.floor(elapsed / 86400000)} 天前`;
  const local = new Date(time + 8 * 3600000);
  return `${local.getUTCMonth() + 1}月${local.getUTCDate()}日`;
}

/** A cheap fingerprint of an upload, to skip sending the same timetable again. */
export function coupleFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/** What the invite sheet sends: the code, where to type it, and the link that opens the Web page with it filled in. */
export function coupleInvitation(code: string, origin: string): string {
  let base = origin;
  while (base.endsWith('/')) base = base.substring(0, base.length - 1);
  return `我们来绑定情侣课表吧！邀请码 ${code}（24 小时内有效）。在药大拾间「课表 → 更多 → 情侣课表」里输入，或者打开 ${base}/schedule?couple=1&code=${code} 就能绑定。`;
}
