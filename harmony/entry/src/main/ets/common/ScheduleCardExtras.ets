import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import preferences from '@ohos.data.preferences';
import { NativeAgendaItem } from '../schedule/NativeScheduleStore';
import { AgendaCardRow, agendaCardRows, agendaToggled } from '../schedule/NativeAgenda';

// What the service cards carry besides the timetable: the style they are drawn in (iOS widgets follow
// the timetable style: 表格, 素笺 and 站牌 have their own paper and rules, the rest the original look),
// a photo behind them with a veil of the card's colour, and the 日程 card ticked off on the desktop.

const CARD_PREFS = 'schedule_widget';
const STYLE_KEY = 'cardStyle';
const BACKGROUND_KEY = 'cardBackground';
const VEIL_KEY = 'cardVeil';
const AGENDA_PREFS = 'native_agenda';
const PENDING_KEY = 'pending';

export interface CardDecor {
  // classic | table | paper | board
  cardStyle: string;
  // `memory://` name of the photo, '' for none.
  background: string;
  veil: number;
  images: Record<string, number>;
}

/** A card style for a timetable style: 经典, 简约 and 格子 look alike on a card. */
export function cardStyleFor(style: string): string {
  return style === 'table' || style === 'paper' || style === 'board' ? style : 'classic';
}

/** follow (the timetable's own style) | classic | table | paper | board. */
export async function readCardStyleChoice(context: common.Context): Promise<string> {
  const prefs = await preferences.getPreferences(context, CARD_PREFS);
  return String(await prefs.get(STYLE_KEY, 'follow'));
}

export async function saveCardStyleChoice(context: common.Context, value: string): Promise<void> {
  const prefs = await preferences.getPreferences(context, CARD_PREFS);
  await prefs.put(STYLE_KEY, value);
  await prefs.flush();
}

export async function readCardBackground(context: common.Context): Promise<string[]> {
  const prefs = await preferences.getPreferences(context, CARD_PREFS);
  return [String(await prefs.get(BACKGROUND_KEY, '')), String(await prefs.get(VEIL_KEY, 0.55))];
}

/** Saves the card photo (a path in the app's files) and how much of the card's colour lies over it. */
export async function saveCardBackground(context: common.Context, path: string, veil: number): Promise<void> {
  const prefs = await preferences.getPreferences(context, CARD_PREFS);
  const previous = String(await prefs.get(BACKGROUND_KEY, ''));
  await prefs.put(BACKGROUND_KEY, path);
  await prefs.put(VEIL_KEY, Math.min(0.85, Math.max(0.15, veil)));
  await prefs.flush();
  if (previous && previous !== path) {
    try { fs.unlinkSync(previous); } catch (_) {}
  }
}

/** The style and photo for the next card update; the photo goes along as an open file. */
export async function cardDecor(context: common.Context): Promise<CardDecor> {
  const prefs = await preferences.getPreferences(context, CARD_PREFS);
  let choice = String(await prefs.get(STYLE_KEY, 'follow'));
  if (choice === 'follow') {
    const style = await preferences.getPreferences(context, 'native_schedule_style');
    choice = String(await style.get('style', 'minimal'));
  }
  const decor: CardDecor = { cardStyle: cardStyleFor(choice), background: '', veil: Number(await prefs.get(VEIL_KEY, 0.55)), images: {} };
  const path = String(await prefs.get(BACKGROUND_KEY, ''));
  if (path) {
    try {
      const file = fs.openSync(path, fs.OpenMode.READ_ONLY);
      // A new name each time: the card keeps images by name.
      const name = `bg${Date.now()}`;
      decor.images[name] = file.fd;
      decor.background = 'memory://' + name;
    } catch (_) {}
  }
  return decor;
}

// ---- The 日程 card ----

export interface AgendaCardBinding {
  state: string;
  title: string;
  rows: string;
  count: number;
  dimension: number;
  cardStyle: string;
}

function readItems(raw: string): NativeAgendaItem[] {
  try {
    const parsed = JSON.parse(raw || '[]') as NativeAgendaItem[];
    return Array.isArray(parsed) ? parsed.filter((item: NativeAgendaItem) => !!item && !!item.id) : [];
  } catch (_) {
    return [];
  }
}

function todayKey(): string { return new Date(Date.now() + 8 * 3600000).toISOString().substring(0, 10); }

export async function agendaCardBinding(context: common.Context, dimension: number): Promise<AgendaCardBinding> {
  const prefs = await preferences.getPreferences(context, AGENDA_PREFS);
  const raw = String(await prefs.get('items', ''));
  const decor = await cardDecor(context);
  for (const key of Object.keys(decor.images)) { try { fs.closeSync(decor.images[key]); } catch (_) {} }
  if (!raw) return { state: 'empty', title: '日程', rows: '[]', count: 0, dimension, cardStyle: decor.cardStyle };
  const items = readItems(raw);
  const all = agendaCardRows(items, todayKey(), 200);
  const rows: AgendaCardRow[] = all.slice(0, dimension === 4 ? 9 : 4);
  return { state: 'ready', title: '日程', rows: JSON.stringify(rows), count: all.filter((row: AgendaCardRow) => !row.done).length,
    dimension, cardStyle: decor.cardStyle };
}

/**
 * A tick on the card: shown at once in the saved list, and kept as pending until the app is next
 * opened and signed in, when it goes to the site (NativeAgendaModel.toggle).
 */
export async function toggleAgendaFromCard(context: common.Context, id: string, date: string): Promise<void> {
  const prefs = await preferences.getPreferences(context, AGENDA_PREFS);
  const items = readItems(String(await prefs.get('items', '')));
  const item = items.find((entry: NativeAgendaItem) => entry.id === id);
  if (!item) return;
  const done = !item.repeat || item.repeat === 'none' ? !item.done : !item.doneDates.includes(date);
  await prefs.put('items', JSON.stringify(agendaToggled(items, id, date, done)));
  const pending = readPending(String(await prefs.get(PENDING_KEY, '[]'))).filter((entry: PendingToggle) => !(entry.id === id && entry.date === date));
  pending.push({ id, date, done });
  await prefs.put(PENDING_KEY, JSON.stringify(pending));
  await prefs.flush();
}

export interface PendingToggle { id: string; date: string; done: boolean; }

function readPending(raw: string): PendingToggle[] {
  try {
    const parsed = JSON.parse(raw) as PendingToggle[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/** The card's ticks not yet sent, cleared as they are handed over. */
export async function takePendingAgendaToggles(context: common.Context): Promise<PendingToggle[]> {
  const prefs = await preferences.getPreferences(context, AGENDA_PREFS);
  const pending = readPending(String(await prefs.get(PENDING_KEY, '[]')));
  if (pending.length) {
    await prefs.put(PENDING_KEY, '[]');
    await prefs.flush();
  }
  return pending;
}
