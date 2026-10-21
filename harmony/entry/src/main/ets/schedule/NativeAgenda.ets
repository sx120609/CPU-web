import { NativeAgendaItem, NativeScheduleStore } from './NativeScheduleStore';

// 日程 in the HarmonyOS app: the items come from the site's bridge `CPUTimeNativeAgenda`
// (web/src/utils/nativeAgendaBridge.ts), the same records as the Web page and 药大拾间 NEXT.
// The rules below follow server/src/shared/agenda.ts. Editing happens on the Web page at /agenda.

export interface NativeAgendaOccurrence {
  item: NativeAgendaItem;
  date: string;
  done: boolean;
}

export interface NativeAgendaReminder {
  id: string;
  date: string;
  at: number;
  title: string;
  text: string;
}

interface AgendaToggleRequest {
  action: string;
  id: string;
  date: string;
  done: boolean;
}

interface AgendaReply {
  authenticated?: boolean;
  missing?: boolean;
  account?: string;
  items?: NativeAgendaItem[];
}

const DAY_MS = 86400000;
const CHINA_OFFSET_MS = 8 * 3600000;
/** An item without an end takes this long on the grid, so it can be read and tapped. */
const UNTIMED_SPAN_MINUTES = 45;

/** Days since 1970-01-01 for a valid YYYY-MM-DD, otherwise -1. */
export function agendaDayNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!match) return -1;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return -1;
  return Math.round(time / DAY_MS);
}

export function agendaDateOf(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().substring(0, 10);
}

/** 1 = Monday … 7 = Sunday; 0 for an invalid date. */
export function agendaWeekday(date: string): number {
  const day = agendaDayNumber(date);
  if (day < 0) return 0;
  const sunday0 = new Date(day * DAY_MS).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

/** "08:05" → 485; -1 when it is not a time of day. */
export function agendaMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : -1;
}

export function agendaOccursOn(item: NativeAgendaItem, date: string): boolean {
  const first = agendaDayNumber(item.date);
  const day = agendaDayNumber(date);
  if (first < 0 || day < 0 || day < first) return false;
  const until = agendaDayNumber(item.until);
  if (until >= 0 && day > until) return false;
  if (item.repeat === 'daily') return true;
  if (item.repeat === 'weekdays') return agendaWeekday(date) <= 5;
  if (item.repeat === 'weekly') return agendaWeekday(date) === agendaWeekday(item.date);
  if (item.repeat === 'monthly') return date.substring(8) === item.date.substring(8);
  return day === first;
}

export function agendaDoneOn(item: NativeAgendaItem, date: string): boolean {
  return item.repeat === 'none' || !item.repeat ? item.done : item.doneDates.includes(date);
}

/** Everything on a day: all-day items first, then by start time, then in the order they were added. */
export function agendaOn(items: NativeAgendaItem[], date: string): NativeAgendaOccurrence[] {
  if (agendaDayNumber(date) < 0) return [];
  return items.filter((item: NativeAgendaItem) => agendaOccursOn(item, date))
    .sort((a: NativeAgendaItem, b: NativeAgendaItem) => (a.start ? 1 : 0) - (b.start ? 1 : 0)
      || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || a.createdAt - b.createdAt)
    .map((item: NativeAgendaItem): NativeAgendaOccurrence => ({ item, date, done: agendaDoneOn(item, date) }));
}

/** A day with all-day items or to-dos still open: a dot in the week header. */
export function agendaHeaderDot(items: NativeAgendaItem[], date: string): boolean {
  return agendaOn(items, date).some((entry: NativeAgendaOccurrence) => !entry.item.start && !entry.done);
}

/**
 * Where a clock time falls down a grid of `rowHeight` periods `gap` apart: inside a period in
 * proportion, across a break in proportion, clamped before the first and after the last period.
 */
export function agendaGridOffset(minutes: number, starts: string[], ends: string[], rowHeight: number, gap: number): number {
  const step = rowHeight + gap;
  let previousEnd = -1;
  for (let index = 0; index < starts.length; index++) {
    const start = agendaMinutes(starts[index]);
    const end = agendaMinutes(ends[index]);
    if (start < 0 || end < 0) return 0;
    if (minutes < start) {
      if (index === 0) return 0;
      const breakStart = previousEnd >= 0 ? previousEnd : start;
      const length = Math.max(1, start - breakStart);
      return index * step - gap + gap * Math.min(length, Math.max(0, minutes - breakStart)) / length;
    }
    if (minutes <= end) return index * step + rowHeight * (minutes - start) / Math.max(1, end - start);
    previousEnd = end;
  }
  return Math.max(0, starts.length * step - gap);
}

/** One timed item's place in a week column: y and height in vp; `beside` keeps it to the right of a class. */
export interface NativeAgendaChip {
  entry: NativeAgendaOccurrence;
  y: number;
  height: number;
  beside: boolean;
}

export function agendaChips(items: NativeAgendaItem[], date: string, starts: string[], ends: string[],
  rowHeight: number, gap: number, courses: number[][]): NativeAgendaChip[] {
  const bottom = Math.max(0, starts.length * (rowHeight + gap) - gap);
  const chips: NativeAgendaChip[] = [];
  agendaOn(items, date).forEach((entry: NativeAgendaOccurrence) => {
    const start = agendaMinutes(entry.item.start);
    if (start < 0) return;
    const endValue = agendaMinutes(entry.item.end);
    const end = endValue > start ? endValue : start + UNTIMED_SPAN_MINUTES;
    const y = Math.min(agendaGridOffset(start, starts, ends, rowHeight, gap), Math.max(0, bottom - 20));
    const height = Math.max(20, Math.min(agendaGridOffset(end, starts, ends, rowHeight, gap) - y, Math.max(20, bottom - y)));
    // Where each course is drawn, as the Web grid decides: an item pinned onto a class (one before
    // the first period, say) keeps beside it too.
    const step = rowHeight + gap;
    const beside = courses.some((range: number[]) => (range[0] - 1) * step < y + height && y < range[1] * step - gap);
    chips.push({ entry, y, height, beside });
  });
  return chips;
}

function chinaParts(epoch: number): string[] {
  const shifted = epoch + CHINA_OFFSET_MS;
  const day = Math.floor(shifted / DAY_MS);
  return [agendaDateOf(day), String(Math.floor((shifted - day * DAY_MS) / 60000))];
}

/** The reminders due in (from, until], earliest first; an occurrence already ticked off is skipped. */
export function agendaReminders(items: NativeAgendaItem[], from: number, until: number, limit: number): NativeAgendaReminder[] {
  const result: NativeAgendaReminder[] = [];
  const today = agendaDayNumber(chinaParts(from)[0]);
  const lastDay = agendaDayNumber(chinaParts(until + 7 * DAY_MS)[0]);
  items.forEach((item: NativeAgendaItem) => {
    if (item.remind < 0 || !item.date) return;
    const first = agendaDayNumber(item.date);
    if (first < 0) return;
    for (let day = Math.max(first, today - 1); day <= lastDay; day++) {
      const date = agendaDateOf(day);
      if (agendaOccursOn(item, date) && !agendaDoneOn(item, date)) {
        const start = agendaMinutes(item.start);
        const minutes = start >= 0 ? start - item.remind : 8 * 60 - (item.remind >= 1440 ? 1440 : 0);
        const at = day * DAY_MS + minutes * 60000 - CHINA_OFFSET_MS;
        if (at > from && at <= until) {
          const when: string[] = [];
          if (day !== today) when.push(day === today + 1 ? '明天' : `${Number(date.substring(5, 7))}月${Number(date.substring(8))}日`);
          if (item.start) when.push(item.end ? `${item.start}–${item.end}` : item.start);
          if (item.location) when.push(item.location);
          result.push({ id: item.id, date, at, title: `日程提醒 · ${item.title}`.substring(0, 60), text: when.join(' · ') });
        }
      }
      if (!item.repeat || item.repeat === 'none') break;
    }
  });
  return result.sort((a: NativeAgendaReminder, b: NativeAgendaReminder) => a.at - b.at).slice(0, limit);
}

/** A bridge item made safe to draw; null when it lacks an id or title. */
export function agendaSanitize(raw: NativeAgendaItem): NativeAgendaItem | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.title !== 'string' || !raw.title) return null;
  const text = (value: string): string => typeof value === 'string' ? value : '';
  return {
    id: raw.id,
    title: raw.title,
    date: agendaDayNumber(text(raw.date)) >= 0 ? raw.date : '',
    start: agendaMinutes(text(raw.start)) >= 0 ? raw.start : '',
    end: agendaMinutes(text(raw.end)) >= 0 ? raw.end : '',
    location: text(raw.location),
    note: text(raw.note),
    remind: typeof raw.remind === 'number' ? raw.remind : -1,
    repeat: text(raw.repeat) || 'none',
    until: agendaDayNumber(text(raw.until)) >= 0 ? raw.until : '',
    done: raw.done === true,
    doneDates: Array.isArray(raw.doneDates) ? raw.doneDates.filter((day: string) => agendaDayNumber(day) >= 0) : [],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
  };
}

/**
 * Reads 日程 through the page and keeps them on the timetable store. Requests run in the Web
 * session (`requester`), the reply comes back through `accept` with the same id.
 */
export class NativeAgendaModel {
  private store: NativeScheduleStore;
  private requester?: (id: string, payload: string) => void;
  private persist?: (raw: string) => void;
  private remind?: (items: NativeAgendaItem[]) => void;
  private pending: Set<string> = new Set<string>();
  private sequence: number = 0;
  private lastLoaded: number = 0;
  /** The site answered for a signed-in account. */
  available: boolean = false;

  constructor(store: NativeScheduleStore) {
    this.store = store;
  }

  attach(requester: (id: string, payload: string) => void, persist: (raw: string) => void,
    remind: (items: NativeAgendaItem[]) => void): void {
    this.requester = requester;
    this.persist = persist;
    this.remind = remind;
  }

  /** The copy saved last time, shown before the page answers. */
  restore(raw: string): void {
    const items = this.parseItems(raw);
    if (items.length) this.store.agendaItems = items;
  }

  /** Reads the items again; without `force` at most every 20 seconds. */
  refresh(force: boolean = false): void {
    const now = Date.now();
    if (!this.requester || (!force && now - this.lastLoaded < 20000)) return;
    this.lastLoaded = now;
    this.send('{"action":"list"}');
  }

  /** Ticks an occurrence off or back on: shown at once, then saved through the page. */
  toggle(id: string, date: string, done: boolean): void {
    this.store.agendaItems = this.store.agendaItems.map((item: NativeAgendaItem): NativeAgendaItem => {
      if (item.id !== id) return item;
      const copy = agendaSanitize(item) ?? item;
      if (!copy.repeat || copy.repeat === 'none') copy.done = done;
      else copy.doneDates = done ? copy.doneDates.concat([date]) : copy.doneDates.filter((day: string) => day !== date);
      return copy;
    });
    const request: AgendaToggleRequest = { action: 'toggle', id: id, date: date, done: done };
    this.send(JSON.stringify(request));
  }

  accept(id: string, raw: string): void {
    if (!this.pending.has(id)) return;
    this.pending.delete(id);
    let reply: AgendaReply | undefined;
    try { reply = JSON.parse(raw) as AgendaReply; } catch (_) { reply = undefined; }
    // An older site without the bridge, or no answer: keep what is shown.
    if (!reply || reply.missing) return;
    if (!reply.authenticated) {
      this.clear();
      return;
    }
    const items = (reply.items ?? []).map((item: NativeAgendaItem) => agendaSanitize(item))
      .filter((item: NativeAgendaItem | null) => item !== null) as NativeAgendaItem[];
    this.available = true;
    this.store.agendaItems = items;
    this.persist?.(JSON.stringify(items));
    this.remind?.(items);
  }

  clear(): void {
    this.available = false;
    this.store.agendaItems = [];
    this.persist?.('');
    this.remind?.([]);
  }

  private send(payload: string): void {
    if (!this.requester) return;
    const id = `agenda-${Date.now()}-${++this.sequence}`;
    this.pending.add(id);
    this.requester(id, payload);
  }

  private parseItems(raw: string): NativeAgendaItem[] {
    if (!raw) return [];
    try {
      const list = JSON.parse(raw) as NativeAgendaItem[];
      if (!Array.isArray(list)) return [];
      return list.map((item: NativeAgendaItem) => agendaSanitize(item))
        .filter((item: NativeAgendaItem | null) => item !== null) as NativeAgendaItem[];
    } catch (_) {
      return [];
    }
  }
}
