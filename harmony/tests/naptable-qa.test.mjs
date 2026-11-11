// Source checks for problems found by hand on the emulator after the NapTable port.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../entry/src/main/ets/${path}`, import.meta.url), 'utf8');

test('accent text in the new sheets follows the theme, so it stays readable in dark mode', () => {
  for (const file of ['schedule/NativeCommonFree.ets', 'schedule/NativeOccurrenceEditor.ets']) {
    const source = read(file);
    assert.doesNotMatch(source, /fontColor\('#0F766E'\)/, `${file} draws dark teal text on a dark sheet`);
  }
  // The selected day chip in 宿舍 → 空闲 sets its text colour against the accent fill.
  assert.match(read('schedule/NativeDormSheet.ets'),
    /Text\(day\.name\)[\s\S]{0,120}fontColor\(day\.ymd === this\.model\.view\?\.free\.date \? \$r\('app\.color\.app_on_accent'\)/);
});

test('long-press menus show the larger course card and group their actions alike', () => {
  const body = read('schedule/NativeScheduleBody.ets');
  const strip = read('schedule/ScheduleOverlayStrip.ets');
  for (const source of [body, strip]) {
    assert.doesNotMatch(source, /MenuPreviewMode\.IMAGE/);
    assert.match(source, /scheduleCoursePreview\(/);
  }
  assert.match(strip, /MenuItemGroup\(\)/);
  assert.match(strip, /contentFontColor\('#DC2626'\)/);
});

test('更多 and 找共同空闲 keep their title outside the scrolling list', () => {
  const page = read('schedule/NativeSchedulePage.ets');
  const tools = page.slice(page.indexOf('private toolsSheet()'), page.indexOf('private toolSection('));
  assert.ok(tools.indexOf("Text('更多')") < tools.indexOf('Scroll()'), 'the 更多 title scrolls away under the close button');
  const free = read('schedule/NativeCommonFree.ets');
  const build = free.slice(free.indexOf('build()'), free.indexOf('private title('));
  assert.ok(build.indexOf("Text('找共同空闲')") < build.indexOf('Scroll()'));
});

test('the quick look does not break a time range or a period range across lines', () => {
  assert.match(read('schedule/NativeSchedulePage.ets'), /replace\(\/\[–-\]\/g, '\\u2060–\\u2060'\)/);
});

test('the background framing editor gets light status bar text', () => {
  const index = read('pages/Index.ets');
  assert.match(index, /const blackout = this\.imagePreviewVisible \|\| this\.cropTarget !== ''/);
});
