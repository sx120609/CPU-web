import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

function compile(path) {
  const context = vm.createContext({ module: { exports: {} }, require: () => ({}), setTimeout, clearTimeout });
  vm.runInContext(transformSync(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/@Observed/g, ''),
    { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));

const overlay = compile('../entry/src/main/ets/schedule/ScheduleOverlay.ets');
const free = compile('../entry/src/main/ets/schedule/ScheduleCommonFree.ets');

const cpu = overlay.overlayPeriods([['08:00', '08:45'], ['08:55', '09:40'], ['09:55', '10:40'], ['10:50', '11:35'], ['13:30', '14:15'],
  ['14:25', '15:10']].map(([startTime, endTime], index) => ({ number: index + 1, startTime, endTime })));
const njmu = overlay.overlayPeriods([['08:00', '08:40'], ['08:50', '09:30'], ['09:40', '10:20'], ['10:30', '11:10'], ['11:20', '12:00'],
  ['13:30', '14:10']].map(([startTime, endTime], index) => ({ number: index + 1, startTime, endTime })));

test('another school\'s classes go onto the user\'s periods by clock time and keep their own times', () => {
  // NJMU periods 3-4 run 09:40-11:10: CPU's 2 has just ended, so its 3 to 4.
  const block = { day: 1, bigSlot: 2, startSlot: 3, endSlot: 4, course: { name: '解剖', weeks: '', weekList: [] } };
  const moved = overlay.overlayRemap(block, njmu, cpu);
  assert.deepEqual([moved.startSlot, moved.endSlot], [3, 4]);
  assert.equal(moved.course.customStartTime, '09:40');
  assert.equal(moved.course.customEndTime, '11:10');
  // Period 5 (11:20-12:00) falls in CPU's lunch break: the nearest period takes it.
  assert.deepEqual(plain(overlay.overlayPlace(680, 720, cpu)), [4, 4]);
  // Same bells: nothing moves.
  assert.equal(overlay.overlayRemap(block, cpu, cpu), block);
});

test('overlapping courses in a strip column become one card with a count', () => {
  const block = (start, end, name) => ({ day: 1, bigSlot: 1, startSlot: start, endSlot: end, course: { name } });
  const cards = plain(overlay.overlayStripCards([block(1, 2, 'A'), block(2, 3, 'B'), block(5, 6, 'C')], 'me'));
  assert.deepEqual(cards.map(card => [card.startSlot, card.endSlot, card.block.course.name, card.more]), [[1, 3, 'A', 1], [5, 6, 'C', 0]]);
  assert.equal(overlay.overlayStripDayCount(336, 34), 3);
  assert.equal(overlay.overlayStripLeading('2026-09-09', ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'], 3), 1);
});

test('common free windows skip everybody\'s classes, the past and too-short gaps', () => {
  const terms = [['2026-11-10', '2026-11-11', '2026-11-12'], ['2026-11-11', '2026-11-12', '2026-11-13']];
  const busy = date => date === '2026-11-11' ? [[480, 580], [570, 640], [840, 900]] : [];
  const days = plain(free.commonFreeDays(terms, busy, '2026-11-01', '2026-11-30', 480, 1350, 60, '2026-11-11', 601));
  // Only the dates both terms cover, from today.
  assert.deepEqual(days.map(day => day.date), ['2026-11-11', '2026-11-12']);
  // Today counts from 10:15 (10:01 rounded up to the quarter hour): 10:40-14:00 and 15:00-22:30.
  assert.deepEqual(days[0].windows.map(window => [window.start, window.end]), [[640, 840], [900, 1350]]);
  assert.deepEqual(days[0].busy, [[480, 640], [840, 900]]);
  assert.equal(free.commonFreeDuration(105), '1 小时 45 分');
});
