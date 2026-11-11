import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

function compile(path) {
  const context = vm.createContext({ module: { exports: {} }, require: () => ({}), setTimeout, clearTimeout });
  vm.runInContext(transformSync(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/@Observed/g, '')
    .replace(/@Builder\s*\nexport function dayShareCard[\s\S]*$/, ''), { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const alarms = compile('../entry/src/main/ets/schedule/ScheduleClassAlarms.ets');
const reminders = compile('../entry/src/main/ets/schedule/NativeAgendaReminders.ets');

test('上课闹钟 ring before the first morning class and the first class after the noon break', () => {
  const days = {
    '2026-11-12': [{ start: 480, end: 585, name: '药理学' }, { start: 810, end: 900, name: '药剂学' }],
    // A class running into the afternoon: no separate after-lunch alarm.
    '2026-11-13': [{ start: 600, end: 790, name: '实验' }, { start: 800, end: 880, name: '药分' }],
    '2026-11-14': [{ start: 840, end: 930, name: '体育' }],
  };
  const now = alarms.alarmMoment('2026-11-11', 23 * 60);
  const planned = plain(alarms.planClassAlarms(date => days[date] ?? [], '2026-11-11', 45, 20, now));
  assert.deepEqual(planned.map(item => [item.kind, item.date, item.title]), [
    ['morning', '2026-11-12', '早课：08:00「药理学」'], ['nap', '2026-11-12', '午休结束：13:30「药剂学」'],
    ['morning', '2026-11-13', '早课：10:00「实验」'], ['nap', '2026-11-14', '午休结束：14:00「体育」']]);
  assert.equal(planned[0].at, alarms.alarmMoment('2026-11-12', 435));
  // Off, and alarms already past, give nothing.
  assert.equal(alarms.planClassAlarms(date => days[date] ?? [], '2026-11-11', 0, 0, now).length, 0);
  assert.equal(alarms.planClassAlarms(date => days[date] ?? [], '2026-11-12', 45, 0, alarms.alarmMoment('2026-11-12', 500)).length, 1);
});

test('class alarms take their share of the system\'s 30 reminders first', () => {
  assert.deepEqual(plain(reminders.reminderShares(14, 40)), [14, 16]);
  assert.deepEqual(plain(reminders.reminderShares(0, 40)), [0, 30]);
  assert.deepEqual(plain(reminders.reminderShares(3, 5)), [3, 5]);
});

test('the 日程 card lists overdue to-dos, the next two weeks and undated to-dos, and ticks off locally', () => {
  const agenda = compile('../entry/src/main/ets/schedule/NativeAgenda.ets');
  const item = (id, title, date, start = '', extra = {}) => ({ id, title, date, start, end: '', location: '', note: '', remind: -1,
    repeat: 'none', until: '', done: false, doneDates: [], createdAt: 1, ...extra });
  const items = [item('a', '交报告', '2026-11-09'), item('b', '组会', '2026-11-11', '14:00'), item('c', '体检', '2026-11-13'),
    item('d', '买实验服', ''), item('e', '跑步', '2026-11-01', '07:00', { repeat: 'daily', doneDates: ['2026-11-11'] }),
    item('f', '下月的事', '2026-12-30')];
  const rows = plain(agenda.agendaCardRows(items, '2026-11-11', 20));
  assert.deepEqual(rows.map(row => [row.id, row.when, row.done]).slice(0, 4),
    [['a', '逾期 · 11.9', false], ['e', '今天 07:00', true], ['b', '今天 14:00', false], ['e', '明天 07:00', false]]);
  assert.ok(rows.some(row => row.id === 'c' && row.when === '周五 11.13'));
  assert.deepEqual(rows.at(-1), { id: 'd', date: '', title: '买实验服', done: false, overdue: false, when: '待办' });
  assert.ok(!rows.some(row => row.id === 'f'));
  assert.equal(agenda.agendaCardRows(items, '2026-11-11', 4).length, 4);
  const ticked = plain(agenda.agendaToggled(items, 'e', '2026-11-12', true));
  assert.deepEqual(ticked.find(entry => entry.id === 'e').doneDates, ['2026-11-11', '2026-11-12']);
  assert.equal(plain(agenda.agendaToggled(items, 'a', '', true)).find(entry => entry.id === 'a').done, true);
});
