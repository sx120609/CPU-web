import { PlacedCourseBlock } from './SchedulePlacement';
import { RawShareDocument } from './ScheduleSharing';

// The couple timetable ("情侣课表"): two bound accounts see each other's classes in one grid. The
// rules here are the Web's (web/src/views/schedule/couple.ts), as plain values so they can be
// checked without a device. See docs/couple-schedule.md.

export interface CoupleMember {
  nickname: string;
  // blue | pink
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

/** The colours of one tile. `fillEnd` is set for a class both attend: the user's colour runs into the partner's. */
export interface CoupleTint {
  fill: string;
  border: string;
  text: string;
  fillEnd: string;
}

/** A course of one day with its clock times, for "what is TA doing now". */
export interface CoupleTimedCourse {
  name: string;
  start: string;
  end: string;
}

function emptyMember(): CoupleMember { return { nickname: '', color: 'blue', syncedAt: '' }; }

export function emptyCoupleStatus(kind: string = 'unknown'): CoupleStatus {
  return { kind, code: '', expired: false, anniversary: '', me: emptyMember(), partner: emptyMember() };
}

function memberFrom(raw?: RawCoupleParty | null): CoupleMember {
  return { nickname: String(raw?.nickname ?? '').trim(), color: raw?.color === 'pink' ? 'pink' : 'blue',
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

/** The Web's `nameHash`: an unsigned 32-bit value. */
export function coupleNameHash(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (Math.imul(hash, 31) + name.charCodeAt(index)) >>> 0;
  return hash;
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
 * One person's courses stay in one colour family; courses differ a little in hue and lightness so
 * neighbours can be told apart.
 */
export function coupleTone(color: string, name: string, dark: boolean): CoupleTint {
  const pink = color === 'pink';
  const hash = coupleNameHash(name);
  const hue = (pink ? 338 : 214) + ((hash % 5) - 2) * (pink ? 5 : 7);
  const shift = ((hash >>> 4) % 3) - 1;
  return dark
    ? { fill: coupleHsl(hue, 48, 29 + shift * 3), border: coupleHsl(hue, 62, 50 + shift * 3), text: '#F5F7FF', fillEnd: '' }
    : { fill: coupleHsl(hue, 88, 93 - shift * 2), border: coupleHsl(hue, 72, 77 - shift * 3), text: coupleHsl(hue, 58, 27), fillEnd: '' };
}

/** A tile's colours by owner (me | ta | both). A class both attend keeps the user's text and border over a two-colour fill. */
export function coupleTint(owner: string, name: string, myColor: string, partnerColor: string, dark: boolean): CoupleTint {
  if (owner === 'ta') return coupleTone(partnerColor, name, dark);
  const mine = coupleTone(myColor, name, dark);
  if (owner === 'both') mine.fillEnd = coupleTone(partnerColor, name, dark).fill;
  return mine;
}

/** Two blocks are the same class when they fill the same periods under the same name. */
export function coupleBlockKey(block: PlacedCourseBlock): string {
  return `${block.whole.startSlot}|${block.whole.endSlot}|${(block.course.name ?? '').replace(/\s+/g, '')}`;
}

function owned(block: PlacedCourseBlock, owner: string, lane: number, lanes: number): PlacedCourseBlock {
  return { id: owner === 'ta' ? 'ta-' + block.id : block.id, day: block.day, bigSlot: block.bigSlot,
    startSlot: block.startSlot, endSlot: block.endSlot, lane, lanes, course: block.course, whole: block.whole,
    offWeek: block.offWeek, owner };
}

/**
 * One day of both timetables. A class both attend is drawn once. A course shares its width only
 * when it meets one of the other person's: then the user's is on the left half and the partner's
 * on the right. Everything else keeps the full column.
 */
export function mergeCoupleBlocks(mine: PlacedCourseBlock[], theirs: PlacedCourseBlock[]): PlacedCourseBlock[] {
  const keys: string[] = mine.map((block: PlacedCourseBlock) => coupleBlockKey(block));
  const shared: string[] = theirs.map((block: PlacedCourseBlock) => coupleBlockKey(block)).filter((key: string) => keys.includes(key));
  const partner: PlacedCourseBlock[] = theirs.filter((block: PlacedCourseBlock) => !keys.includes(coupleBlockKey(block)));
  const meets = (a: PlacedCourseBlock, b: PlacedCourseBlock): boolean => a.startSlot <= b.endSlot && b.startSlot <= a.endSlot;
  const merged: PlacedCourseBlock[] = mine.map((block: PlacedCourseBlock) => {
    const owner = shared.includes(coupleBlockKey(block)) ? 'both' : 'me';
    return partner.some((other: PlacedCourseBlock) => meets(other, block))
      ? owned(block, owner, block.lane, block.lanes * 2) : owned(block, owner, block.lane, block.lanes);
  });
  partner.forEach((block: PlacedCourseBlock) => {
    merged.push(mine.some((other: PlacedCourseBlock) => meets(other, block))
      ? owned(block, 'ta', block.lanes + block.lane, block.lanes * 2) : owned(block, 'ta', block.lane, block.lanes));
  });
  return merged;
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
