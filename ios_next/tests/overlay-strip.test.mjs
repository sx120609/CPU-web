import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../..', import.meta.url));
const root = process.env.CPU_REPO_ROOT || defaultRoot;
const read = path => readFile(`${root}/ios_next/CpuTime/CpuTime/${path}`, 'utf8');

// The overlay strip (情侣课表, a shared timetable laid on top) keeps every day slid past
// and its body runs for each new leftmost day. These hold the three things that keep a
// slide from rebuilding the whole term each time.

test('a day of the overlay strip is rebuilt only when its key changes', async () => {
  const strip = await read('ScheduleOverlayStrip.swift');
  const item = strip.slice(strip.indexOf('private struct ScheduleOverlayStripDayItem'), strip.indexOf('private struct ScheduleOverlayStripColumnHost'));
  assert.match(item, /: View, Equatable \{/);
  assert.match(item, /static func == \(lhs: Self, rhs: Self\) -> Bool \{ lhs\.key == rhs\.key \}/);
  // Everything a day's look depends on that is not behind `revision`.
  for (const field of ['page', 'revision', 'style', 'dark', 'dayWidth', 'columnWidth', 'metrics', 'isToday', 'showsNow', 'otherName']) {
    assert.match(item, new RegExp(`let ${field}: `), field);
  }
  const body = strip.slice(strip.indexOf('var body: some View {'), strip.indexOf('// MARK: Following the page'));
  // The day's data and its columns are made inside the item, not while the strip's body runs.
  assert.match(body, /content: \{ dayView\(day\(page\)\) \}\s*\)\s*\.equatable\(\)/);
  assert.doesNotMatch(body, /ScheduleOverlayStripColumnHost \{ dayView\(day\(page\)\) \}/);
});

test('the page hears of a slid-to day once the strip has settled', async () => {
  const strip = await read('ScheduleOverlayStrip.swift');
  const body = strip.slice(strip.indexOf('.onChange(of: leading)'), strip.indexOf('.onChange(of: selection)'));
  assert.match(body, /reportWhenSettled\(pages\[index\]\)/);
  assert.doesNotMatch(body, /\breport\(pages\[index\]\)/);
  const settle = strip.slice(strip.indexOf('private func reportWhenSettled'), strip.indexOf('static var settleMilliseconds'));
  assert.match(settle, /guard followTarget == nil, leading == page\.id else \{ return \}\s+report\(page\)/);
  // A day the page chooses itself (arrows, 回到今天) takes over from one about to be reported.
  const follow = strip.slice(strip.indexOf('private func follow(animated: Bool)'), strip.indexOf('private func reportWhenSettled'));
  assert.match(follow, /settleTask\?\.cancel\(\)/);
});

test('the strip dates and days are kept until what they are made from changes', async () => {
  const strip = await read('ScheduleOverlayStrip.swift');
  const memo = strip.slice(strip.indexOf('final class ScheduleOverlayStripMemo'));
  for (const input of ['result', 'calendar', 'layer', 'occurrenceChanges', 'priorities', 'today', 'weekend']) {
    assert.match(memo, new RegExp(`let ${input}: `), input);
  }
  assert.match(memo, /guard next != inputs else \{ return \}\s+inputs = next\s+revision \+= 1\s+cachedPages = nil\s+days = \[:\]/);
  const view = await read('NativeScheduleView.swift');
  const overlay = view.slice(view.indexOf('private func overlayStrip(_ result'), view.indexOf('private var overlayStripMetrics'));
  assert.match(overlay, /memo\.sync\(\.init\(result: result, calendar: store\.calendar, layer: layer,/);
  assert.match(overlay, /let pages = memo\.pages \{ overlayStripPages\(result\) \}/);
  assert.match(overlay, /day: \{ page in memo\.day\(page\) \{ overlayStripDay\(page, layer: layer, today: today, result: result\) \} \}/);
  // The display settings the columns are built with are part of the revision.
  for (const setting of ['palette', 'showLocation', 'showTeacher', 'showPeriod', 'showWeeks', 'density', 'rowHeight']) {
    assert.match(overlay, new RegExp(`${setting}: `), setting);
    assert.match(strip.slice(strip.indexOf('struct ScheduleOverlayStripRevision')), new RegExp(`let ${setting}: `), setting);
  }
});
