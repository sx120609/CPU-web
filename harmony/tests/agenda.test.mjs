import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

// NativeAgenda.ets only imports types from the store, so it runs on its own.
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(transformSync(readFileSync(new URL('../entry/src/main/ets/schedule/NativeAgenda.ets', import.meta.url), 'utf8'),
  { loader: 'ts', format: 'cjs' }).code, context);
const { agendaChips, agendaHeaderDot, agendaOn, agendaReminders, NativeAgendaModel } = context.module.exports;

const item = (fields) => ({ id: 'abcdef123456', title: '事', date: '', start: '', end: '', location: '', note: '', remind: -1,
  repeat: 'none', until: '', done: false, doneDates: [], createdAt: 0, ...fields });
const json = (value) => JSON.parse(JSON.stringify(value));

test('a day lists all-day items first, repeats by their rule and ticks repeats by day', () => {
  const items = [
    item({ id: 'evening00001', title: '晚课', date: '2026-10-21', start: '19:00', createdAt: 1 }),
    item({ id: 'allday000001', title: '交表', date: '2026-10-21', createdAt: 2 }),
    item({ id: 'weekly000001', title: '羽毛球', date: '2026-10-01', start: '07:00', repeat: 'weekly', doneDates: ['2026-10-15'] }),
  ];
  // 2026-10-01 is a Thursday; the 21st a Wednesday, the 22nd a Thursday.
  assert.deepEqual(json(agendaOn(items, '2026-10-21').map((entry) => entry.item.id)), ['allday000001', 'evening00001']);
  assert.deepEqual(json(agendaOn(items, '2026-10-22').map((entry) => [entry.item.id, entry.done])), [['weekly000001', false]]);
  assert.equal(agendaOn(items, '2026-10-15')[0].done, true);
  assert.equal(agendaHeaderDot(items, '2026-10-21'), true);
  assert.equal(agendaHeaderDot(items, '2026-10-22'), false);
});

test('week chips sit at their clock time and keep beside a class', () => {
  const starts = ['08:00', '08:55', '13:30'];
  const ends = ['08:45', '09:40', '14:15'];
  const items = [
    item({ id: 'morning00001', title: '早读', date: '2026-10-21', start: '08:22', end: '08:45' }),
    item({ id: 'lunch0000001', title: '午饭', date: '2026-10-21', start: '12:00' }),
  ];
  const chips = agendaChips(items, '2026-10-21', starts, ends, 50, 4, [[1, 1]]);
  assert.equal(chips.length, 2);
  assert.ok(Math.abs(chips[0].y - 50 * 22 / 45) < 0.01);
  assert.equal(chips[0].beside, true);
  // In the lunch break, after period 2: across the gap before period 3, clear of the class.
  assert.equal(chips[1].beside, false);
  assert.ok(chips[1].y >= 104 && chips[1].y <= 108);
  assert.ok(chips[1].height >= 20);
  // Before the first period it is pinned onto period 1, so it keeps beside the class there.
  const early = agendaChips([item({ id: 'run000000001', title: '晨跑', date: '2026-10-21', start: '07:00', end: '07:40' })],
    '2026-10-21', starts, ends, 50, 4, [[1, 1]]);
  assert.equal(early[0].y, 0);
  assert.equal(early[0].beside, true);
});

test('reminders fire before each open occurrence', () => {
  const now = Date.UTC(2026, 9, 19, 6 - 8, 44);
  const meeting = item({ id: 'meeting00001', title: '组会', date: '2026-10-19', start: '15:00', remind: 15, location: '药学楼' });
  const [first] = agendaReminders([meeting], now, now + 86400000, 30);
  assert.equal(first.at, Date.UTC(2026, 9, 19, 14 - 8, 45));
  assert.equal(first.title, '日程提醒 · 组会');
  assert.equal(first.text, '15:00 · 药学楼');
  assert.equal(agendaReminders([{ ...meeting, done: true }], now, now + 86400000, 30).length, 0);
  const daily = item({ id: 'daily0000001', title: '背单词', date: '2026-10-01', start: '07:00', remind: 0, repeat: 'daily', doneDates: ['2026-10-20'] });
  // 07:00 today is still ahead of 06:44; the 20th was ticked off.
  assert.deepEqual(json(agendaReminders([daily], now, now + 3 * 86400000, 30).map((reminder) => reminder.date)), ['2026-10-19', '2026-10-21']);
});

test('the model shows replies on the store, ticks at once and clears when signed out', () => {
  const store = { agendaItems: [] };
  const sent = [];
  const saved = [];
  const reminded = [];
  const model = new NativeAgendaModel(store);
  model.attach((id, payload) => sent.push({ id, payload: JSON.parse(payload) }), (raw) => saved.push(raw), (items) => reminded.push(items.length));
  model.refresh(true);
  assert.equal(sent[0].payload.action, 'list');
  model.accept('unknown', '{"authenticated":true,"items":[]}');
  assert.equal(store.agendaItems.length, 0);
  model.accept(sent[0].id, JSON.stringify({ authenticated: true, items: [item({ date: '2026-10-21' }), { id: '', title: '' }] }));
  assert.equal(store.agendaItems.length, 1);
  assert.equal(model.available, true);
  assert.deepEqual(reminded, [1]);
  model.toggle('abcdef123456', '2026-10-21', true);
  assert.equal(store.agendaItems[0].done, true);
  assert.deepEqual({ ...sent[1].payload }, { action: 'toggle', id: 'abcdef123456', date: '2026-10-21', done: true });
  // A site without the bridge keeps what is shown; a signed-out answer clears it.
  model.accept(sent[1].id, '{"missing":true}');
  assert.equal(store.agendaItems.length, 1);
  model.refresh(true);
  model.accept(sent[2].id, '{"authenticated":false}');
  assert.equal(store.agendaItems.length, 0);
  assert.equal(saved.at(-1), '');
  // The saved copy comes back on the next start.
  model.restore(JSON.stringify([item({ title: '存档' })]));
  assert.equal(store.agendaItems[0].title, '存档');
});

test('the timetable saves, deletes and reads sentences through the page', () => {
  const store = { agendaItems: [], agendaAvailable: false, agendaRelay: false };
  const sent = [];
  const model = new NativeAgendaModel(store);
  model.attach((id, payload) => sent.push({ id, payload: JSON.parse(payload) }), () => undefined, () => undefined);
  const stored = item({ id: 'meeting00001', title: '组会', date: '2026-10-28', start: '15:00' });

  // A new item: the page's stored copy is handed back and its list shown.
  let outcome;
  model.save(item({ id: '', title: '组会', date: '2026-10-28', start: '15:00' }), (error, saved) => { outcome = { error, saved }; });
  assert.equal(sent[0].payload.action, 'save');
  assert.equal(sent[0].payload.data.id, '');
  model.accept(sent[0].id, JSON.stringify({ authenticated: true, relay: true, items: [stored], saved: stored }));
  assert.equal(outcome.error, '');
  assert.equal(outcome.saved.id, 'meeting00001');
  assert.equal(store.agendaItems.length, 1);
  assert.equal(store.agendaAvailable, true);
  assert.equal(store.agendaRelay, true);

  // Not stored: the page's reason, or that it could not be reached.
  model.save(stored, (error) => { outcome = error; });
  model.accept(sent[1].id, JSON.stringify({ authenticated: true, items: [stored], saved: null, error: '日程最多 600 条' }));
  assert.equal(outcome, '日程最多 600 条');
  model.save(stored, (error) => { outcome = error; });
  model.accept(sent[2].id, '{"missing":true}');
  assert.equal(outcome, '没能保存，请检查网络后再试');

  // Deleted once the page's list no longer has it.
  model.remove('meeting00001', (error) => { outcome = error; });
  assert.deepEqual({ ...sent[3].payload }, { action: 'remove', id: 'meeting00001' });
  model.accept(sent[3].id, JSON.stringify({ authenticated: true, items: [] }));
  assert.equal(outcome, '');
  assert.equal(store.agendaItems.length, 0);

  // A sentence is read without an account, and its answer never touches the list.
  model.parse('明天 15:00 组会', (draft) => { outcome = draft; });
  assert.deepEqual({ ...sent[4].payload }, { action: 'parse', text: '明天 15:00 组会' });
  model.accept(sent[4].id, JSON.stringify({ parsed: { title: '组会', date: '2026-10-27', start: '15:00', end: '', location: '', remind: -1, repeat: 'none' } }));
  assert.equal(outcome.title, '组会');
  assert.equal(store.agendaAvailable, true);

  // 微信和 QQ 也提醒 shows at once.
  model.setRelay(false);
  assert.equal(store.agendaRelay, false);
  assert.deepEqual({ ...sent[5].payload }, { action: 'relay', on: false });
});
