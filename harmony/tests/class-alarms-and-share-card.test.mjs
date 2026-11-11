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
