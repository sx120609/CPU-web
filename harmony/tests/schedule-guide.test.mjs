import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function compile(path) {
  const context = vm.createContext({ module: { exports: {} }, require: () => ({}) });
  vm.runInContext(transformSync(read(path), { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));

const overlay = compile('../entry/src/main/ets/schedule/ScheduleOverlay.ets');
const guide = compile('../entry/src/main/ets/schedule/ScheduleGuide.ets');
const page = read('../entry/src/main/ets/schedule/NativeSchedulePage.ets');
const couple = read('../entry/src/main/ets/schedule/NativeScheduleCouple.ets');
const index = read('../entry/src/main/ets/pages/Index.ets');

test('一起看的周视图 is 并排 unless 合并 was chosen', () => {
  assert.equal(overlay.coupleWeekLayout('merged'), 'merged');
  // Nothing stored, or a value a later version wrote: the strip, as before the option.
  for (const raw of ['', 'split', 'stacked', undefined, null]) assert.equal(overlay.coupleWeekLayout(raw), 'split');
});

test('the week is the two-column strip only with 并排, and only while somebody else is drawn', () => {
  assert.equal(overlay.overlayStripWanted('week', false, true, true, 'split'), true);
  assert.equal(overlay.overlayStripWanted('week', false, true, true, ''), true);
  // 合并: back to the one week grid, where both people's courses are merged.
  assert.equal(overlay.overlayStripWanted('week', false, true, true, 'merged'), false);
  // As before the option: not in the day or month view, a read-only shared timetable, nobody shown, no calendar.
  assert.equal(overlay.overlayStripWanted('day', false, true, true, 'split'), false);
  assert.equal(overlay.overlayStripWanted('month', false, true, true, 'split'), false);
  assert.equal(overlay.overlayStripWanted('week', true, true, true, 'split'), false);
  assert.equal(overlay.overlayStripWanted('week', false, false, true, 'split'), false);
  assert.equal(overlay.overlayStripWanted('week', false, true, false, 'split'), false);
  // The page asks this rule with the stored layout; the merged grid is the branch below it.
  assert.match(page, /overlayStripWanted\(this\.store\.viewMode, this\.store\.readOnly, this\.couple\.showing\(\),[^;]*\n\s*this\.couple\.weekLayout\)/);
});

test('the strip\'s note shows until it is closed, the layout is chosen, or the guide said it', () => {
  assert.equal(overlay.overlayStripHintDue(true, false), true);
  assert.equal(overlay.overlayStripHintDue(true, true), false);
  assert.equal(overlay.overlayStripHintDue(false, false), false);
  assert.match(page, /if \(overlayStripHintDue\(true, this\.couple\.stripHintSeen\)\) this\.stripHint\(\)/);
  // 改回合并 and the close button both settle it; so does choosing either layout anywhere.
  const hint = page.slice(page.indexOf('private stripHint()'), page.indexOf('@Builder\n  private weekSwitcher()'));
  assert.match(hint, /两人的课并排显示，左右滑动换天。/);
  assert.match(hint, /this\.couple\.setWeekLayout\('merged'\)/);
  assert.match(hint, /this\.couple\.markStripHintSeen\(\)/);
  const set = couple.slice(couple.indexOf('setWeekLayout(value: string)'), couple.indexOf('markStripHintSeen(): void'));
  assert.match(set, /this\.markStripHintSeen\(\);\n\s*if \(layout === this\.weekLayout\) return;/);
  assert.match(set, /this\.revision \+= 1;\n\s*this\.persistence\?\.\('weekLayout', layout\)/);
  // The guide's 和 TA 一起看 says the same thing.
  assert.match(page, /if \(this\.couple\.together\(\)\) this\.couple\.markStripHintSeen\(\);/);
});

test('the layout and the note are kept on the device, and default when nothing is stored', () => {
  assert.match(couple, /weekLayout: string = 'split';/);
  // Until `restore` runs (and in the acceptance harness) the note counts as seen.
  assert.match(couple, /stripHintSeen: boolean = true;/);
  assert.match(couple, /this\.weekLayout = coupleWeekLayout\(weekLayout\);/);
  assert.match(index, /String\(await prefs\.get\('coupleWeekLayout', 'split'\)\), String\(await prefs\.get\('coupleStripHint', ''\)\) === '1'\)/);
  assert.match(index, /key === 'weekLayout' \? 'coupleWeekLayout' : key === 'stripHint' \? 'coupleStripHint'/);
  // 课表样式 offers the row only while it would change something; the couple sheet always (it is bound there).
  assert.match(index, /if \(this\.coupleModel\.together\(\)\) \{[\s\S]{0,200}CoupleWeekLayoutRow\(\{ model: this\.coupleModel \}\)/);
  assert.match(couple.slice(couple.indexOf('private boundContent()')), /CoupleWeekLayoutRow\(\{ model: this\.model \}\)/);
  assert.match(couple, /together\(\): boolean \{ return this\.bound\(\) \|\| this\.overlaying\(\); \}/);
});

test('课表怎么用 opens by itself once, on the user\'s own timetable with nothing else open', () => {
  const version = guide.SCHEDULE_GUIDE_VERSION;
  assert.equal(guide.scheduleGuideDue(0, true, false, true, false), true);
  assert.equal(guide.scheduleGuideDue(version - 1, true, false, true, false), true);
  // Seen this version already.
  assert.equal(guide.scheduleGuideDue(version, true, false, true, false), false);
  // The stored value has not been read yet (and the harness never reads one).
  assert.equal(guide.scheduleGuideDue(-1, true, false, true, false), false);
  // No courses on screen yet, a read-only shared timetable, another tab or panel, one of the page's own sheets.
  assert.equal(guide.scheduleGuideDue(0, false, false, true, false), false);
  assert.equal(guide.scheduleGuideDue(0, true, true, true, false), false);
  assert.equal(guide.scheduleGuideDue(0, true, false, false, false), false);
  assert.equal(guide.scheduleGuideDue(0, true, false, true, true), false);
  // Marked as seen the moment it opens, so closing it any way does not bring it back.
  assert.match(page, /this\.store\.guideSeen = SCHEDULE_GUIDE_VERSION;\n\s*this\.onGuideSeen\(\);\n\s*this\.openGuide\(\);/);
  assert.match(index, /this\.scheduleStore\.guideSeen = Math\.max\(0, Number\(await prefs\.get\('guideSeen', 0\)\) \|\| 0\);/);
  assert.match(index, /await prefs\.put\('guideSeen', SCHEDULE_GUIDE_VERSION\);/);
  assert.match(read('../entry/src/main/ets/schedule/NativeScheduleStore.ets'), /guideSeen: number = -1;/);
  // 更多 opens it again.
  assert.match(page, /this\.toolRow\('使用指引', '课表怎么用',[^\n]*\(\) => this\.openGuide\(\)\)/);
});

test('the guide\'s rows and their buttons', () => {
  assert.deepEqual(plain(guide.scheduleGuideItems(false)), ['tap', 'style', 'more']);
  assert.deepEqual(plain(guide.scheduleGuideItems(true)), ['tap', 'style', 'together', 'more']);
  // 换回经典 only on 简约; once pressed it reads 已换回 although the style is 经典 now.
  assert.equal(guide.scheduleGuideStyleAction('minimal', false), 'offer');
  assert.equal(guide.scheduleGuideStyleAction('classic', true), 'done');
  for (const style of ['classic', 'grid', 'table', 'paper', 'board']) assert.equal(guide.scheduleGuideStyleAction(style, false), '');
  assert.equal(guide.scheduleGuideLayoutAction('split'), 'offer');
  assert.equal(guide.scheduleGuideLayoutAction(''), 'offer');
  assert.equal(guide.scheduleGuideLayoutAction('merged'), 'done');
  assert.match(page, /if \(item === 'style'\) \{ this\.guideRestored = true; this\.onClassic\(\); \}\n\s*else this\.couple\.setWeekLayout\('merged'\);/);
  assert.match(index, /onClassic: \(\) => \{ this\.scheduleStore\.visualStyle = 'classic'; this\.saveScheduleStyle\(\); \}/);
});
