import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function compile(path) {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(transformSync(read(path), { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}
// Comments mention the names the checks look for; look at code only.
const code = source => source.replace(/\/\/.*$/gm, '');

const layout = compile('../entry/src/main/ets/schedulewidget/ScheduleCardLayout.ets');
const minute = 60000;
const at = (hour, min, second = 0) => new Date(2026, 10, 11, hour, min, second).getTime();
const start = at(9, 55);
const end = at(11, 35);

test('the countdown runs to the end of a class that is on and appears an hour before one that is not', () => {
  assert.deepEqual({ ...layout.cardCountdown(start, end, at(10, 20)) }, { title: '距下课', seconds: 75 * 60 });
  assert.deepEqual({ ...layout.cardCountdown(start, end, at(11, 34, 59)) }, { title: '距下课', seconds: 1 });
  // Over at the bell: nothing counts below zero.
  assert.equal(layout.cardCountdown(start, end, end).title, '');
  assert.deepEqual({ ...layout.cardCountdown(start, end, at(9, 30)) }, { title: '距上课', seconds: 25 * 60 });
  assert.deepEqual({ ...layout.cardCountdown(start, end, at(8, 55)) }, { title: '距上课', seconds: 3600 });
  assert.equal(layout.cardCountdown(start, end, at(8, 54, 59)).title, '');
  assert.deepEqual({ ...layout.cardCountdown(start, end, start) }, { title: '距下课', seconds: 100 * 60 });
  // A class of another day, or one without times, has no countdown.
  assert.equal(layout.cardCountdown(0, 0, at(10, 20)).title, '');
  assert.equal(layout.cardCountdown(start, 0, at(9, 30)).title, '');
  assert.equal(layout.CARD_COUNTDOWN_LEAD_MS, 60 * minute);
});

test('the clock text is the one the iOS system timer writes', () => {
  assert.deepEqual([0, 9, 70, 3599, 3600, 4500, 36000 + 62].map(layout.cardClock), ['0:00', '0:09', '1:10', '59:59', '1:00:00', '1:15:00', '10:01:02']);
  assert.equal(layout.cardClock(-5), '0:00');
});

test('progress and the finished state follow the clock of the card, the bell minute included', () => {
  assert.equal(layout.cardInProgress(start, end, at(9, 54, 59)), false);
  assert.equal(layout.cardInProgress(start, end, start), true);
  assert.equal(layout.cardInProgress(start, end, end), false);
  assert.equal(layout.cardProgress(start, end, at(10, 20)), 0.25);
  assert.equal(layout.cardProgress(start, end, at(12, 0)), 0);
  // A class stays unfinished through the minute it ends in, like the refresh that greys it a minute later.
  assert.equal(layout.cardEnded(end, end + minute - 1), false);
  assert.equal(layout.cardEnded(end, end + minute), true);
  assert.equal(layout.cardEnded(0, at(23, 0)), false);
});

test('between refreshes the card moves past finished classes but never empties itself', () => {
  const ends = [at(9, 40), at(11, 35), at(15, 10)];
  assert.equal(layout.cardEndedPrefix(ends, at(9, 0)), 0);
  assert.equal(layout.cardEndedPrefix(ends, at(9, 40, 59)), 0);
  assert.equal(layout.cardEndedPrefix(ends, at(9, 41)), 1);
  assert.equal(layout.cardEndedPrefix(ends, at(12, 0)), 2);
  // The last class stays until a refresh says which day comes next.
  assert.equal(layout.cardEndedPrefix(ends, at(22, 0)), 2);
  assert.equal(layout.cardEndedPrefix([0, at(11, 35)], at(22, 0)), 0);
  assert.equal(layout.cardEndedPrefix([], at(22, 0)), 0);
});

test('the text size is the largest scale at which the fullest arrangement still fits', () => {
  // A 2×2 card: 121 high inside its margins. Two classes need 114, one needs 99.
  assert.equal(layout.chooseCardScale([1.16, 1.08, 1], 121, 114), 1);
  assert.equal(layout.chooseCardScale([1.16, 1.08, 1], 121, 112), 1.08);
  assert.equal(layout.chooseCardScale([1.16, 1.08, 1], 121, 99), 1.16);
  // A fixed size is used whether or not everything fits: what does not is counted, not squeezed.
  assert.equal(layout.chooseCardScale([1.12], 121, 500), 1.12);
  assert.equal(layout.chooseCardScale([0.9], 121, 10), 0.9);
  assert.equal(layout.chooseCardScale([], 121, 10), 1);
});

test('the large today card shows fewer classes at a larger size and counts the rest', () => {
  // 4×4: 320 high, 16 margins, a 24 header and 8 under it leave 256.
  assert.deepEqual({ ...layout.largeTodayPlan(256, 7, 1, 0) }, { rows: 4, preview: 0 });
  assert.equal(layout.largeTodayHeight(4, 4), 4 * 52 + 3 * 8 + 21);
  assert.deepEqual({ ...layout.largeTodayPlan(256, 4, 0, 0) }, { rows: 4, preview: 0 });
  // 大 (1.12) lays the same card out in 288 / 1.12 − 32.
  assert.deepEqual({ ...layout.largeTodayPlan(288 / 1.12 - 32, 4, 0, 0) }, { rows: 3, preview: 0 });
  // Five classes: four and a count at the standard size, all five once there is room for 292.
  assert.deepEqual({ ...layout.largeTodayPlan(256, 5, 0, 0) }, { rows: 4, preview: 0 });
  assert.deepEqual({ ...layout.largeTodayPlan(292, 5, 0, 0) }, { rows: 5, preview: 0 });
  assert.deepEqual({ ...layout.largeTodayPlan(10, 3, 0, 0) }, { rows: 1, preview: 0 });
  assert.deepEqual({ ...layout.largeTodayPlan(256, 0, 0, 2) }, { rows: 0, preview: 0 });
});

test('a light day goes on to preview the next course day: three, two, one, then one line', () => {
  assert.equal(layout.cardPreviewHeight(3), 16 + 16 + 3 * 43);
  assert.equal(layout.cardPreviewHeight(layout.CARD_PREVIEW_SUMMARY), 28);
  assert.equal(layout.cardPreviewHeight(0), 0);
  // One class today (52): three of the next day fit under it.
  assert.deepEqual({ ...layout.largeTodayPlan(256, 1, 0, 4) }, { rows: 1, preview: 3 });
  // The next day only has two.
  assert.deepEqual({ ...layout.largeTodayPlan(256, 1, 0, 2) }, { rows: 1, preview: 2 });
  // Two today (112): two of the next day (118) fit, three (161) do not.
  assert.deepEqual({ ...layout.largeTodayPlan(256, 2, 0, 4) }, { rows: 2, preview: 2 });
  // Three today (172): one row (75) fits.
  assert.deepEqual({ ...layout.largeTodayPlan(256, 3, 0, 4) }, { rows: 3, preview: 1 });
  // No room for a row: the label and one line.
  assert.deepEqual({ ...layout.largeTodayPlan(225, 3, 0, 4) }, { rows: 3, preview: layout.CARD_PREVIEW_SUMMARY });
  // Not even that: no preview. And never when some of the classes of today are not shown.
  assert.deepEqual({ ...layout.largeTodayPlan(256, 4, 0, 4) }, { rows: 4, preview: 0 });
  assert.deepEqual({ ...layout.largeTodayPlan(256, 1, 2, 4) }, { rows: 1, preview: 0 });
});

test('the medium today card closes its gap before it drops to one class; two-day columns count what is left', () => {
  // 2×4: 149 high, 14 margins, header 24 and 5 under it leave 92.
  assert.deepEqual({ ...layout.mediumTodayPlan(92, 2, 0) }, { rows: 2, spacing: 7, footerGap: 8 });
  assert.deepEqual({ ...layout.mediumTodayPlan(92, 4, 0) }, { rows: 2, spacing: 4, footerGap: 4 });
  assert.deepEqual({ ...layout.mediumTodayPlan(96, 4, 0) }, { rows: 2, spacing: 7, footerGap: 8 });
  // 大: 121 / 1.12 − 29 = 79 holds two rows only without a footer.
  const large = 121 / 1.12 - 29;
  assert.deepEqual({ ...layout.mediumTodayPlan(large, 2, 0) }, { rows: 2, spacing: 7, footerGap: 8 });
  assert.equal(layout.mediumTodayPlan(large, 4, 0).rows, 1);
  assert.equal(layout.mediumTodayPlan(40, 0, 0).rows, 0);
  // 4×4 two-day column: 288 − 24 − 18 = 246 holds four rows of 48 with a footer, not five.
  assert.equal(layout.twoDayPlan(246, 5, 0), 4);
  assert.equal(layout.twoDayPlan(246, 4, 0), 4);
  // Five were handed over but more are left: the footer has to fit too.
  assert.equal(layout.twoDayPlan(280, 5, 0), 5);
  assert.equal(layout.twoDayPlan(280, 5, 2), 4);
  assert.equal(layout.twoDayHeight(4, 1), 4 * 48 + 3 * 7 + 19);
  assert.equal(layout.agendaRowsThatFit(97, 28, 6, 5), 3);
  assert.equal(layout.agendaRowsThatFit(97, 18, 4, 5), 4);
  assert.equal(layout.agendaRowsThatFit(5, 18, 4, 5), 1);
  // The progress line of the class that is on: 6 under a roomy summary, 4 where two classes share a 2×2 card.
  assert.deepEqual([layout.CARD_PROGRESS_EXTRA, layout.CARD_FITTED_PROGRESS_EXTRA], [6, 4]);
  assert.ok(24 + 8 + layout.CARD_FITTED_SUMMARY + layout.CARD_FITTED_PROGRESS_EXTRA + 6 + layout.CARD_COMPACT_NEXT <= 121);
});

test('the card scales its whole content, runs on its own clock and leaves the lock screen alone', () => {
  const view = code(read('../entry/src/main/ets/schedulewidget/ScheduleCardView.ets'));
  // One canvas 1 / scale the size of the card, scaled back about its top leading corner.
  assert.match(view, /\.scale\(\{ x: this\.textScale\(\), y: this\.textScale\(\), centerX: 0, centerY: 0 \}\)/);
  assert.match(view, /return this\.baseHeight\(\) \/ this\.textScale\(\);/);
  assert.match(view, /if \(this\.isLockScreen\(\) \|\| this\.state !== 'ready' \|\| this\.cardHeight <= 0 \|\| this\.cardWidth <= 0\) return 1;/);
  // A system timer ticks the clock; what is drawn always comes from the device time, never from its count.
  assert.match(view, /TextTimer\(\{ controller: this\.ticker \}\)/);
  assert.match(view, /\.onTimer\(\(\) => this\.tick\(\)\)/);
  assert.match(view, /const now = Date\.now\(\);/);
  assert.match(view, /if \(this\.pinnedNow > 0 \|\| this\.isLockScreen\(\) \|\| this\.state !== 'ready'\) return false;/);
  // onAreaChange does not run in a service card.
  assert.doesNotMatch(view, /onAreaChange/);
  assert.match(view, /\.onSizeChange\(/);
  // Builders take a fixed kind or a ForEach item, never a value worked out from state at the call site.
  for (const call of view.matchAll(/this\.(dateHeader|courseSummary|upcomingColumn|dayColumn|remainingText|emptyCourses)\(([^)]*)\)/g)) {
    assert.match(call[2], /^(?:'[a-z]+'|side|kind|index|\d)(?:, '[a-z]+')?$/, call[0]);
  }
  const agenda = code(read('../entry/src/main/ets/schedulewidget/pages/AgendaCard.ets'));
  assert.match(agenda, /widgetTextScales\(this\.textSize\)/);
  assert.match(agenda, /agendaRowsThatFit\(/);
  assert.doesNotMatch(agenda, /onAreaChange/);
  // The settings page offers every switch it stores, and the four sizes.
  const settings = read('../entry/src/main/ets/schedule/ScheduleCardSettings.ets');
  for (const key of ['showCourseName', 'showRoom', 'showTeacher', 'showTime', 'showProgress', 'hideCompleted', 'showWeek',
    'showLunarDate', 'showHoliday', 'holidayAlwaysVisible']) {
    assert.match(settings, new RegExp(`this\\.toggleRow\\('[^']+', '${key}', (?:true|false)\\)`), key);
  }
  assert.match(settings, /ForEach\(WIDGET_TEXT_SIZES/);
});
