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

test('no stray control characters in the app sources (a backspace in a regex broke every desktop shortcut)', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const base = fileURLToPath(new URL('../entry/src/main/ets/', import.meta.url));
  const walk = (dir) => readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]);
  for (const file of walk(base).filter((name) => name.endsWith('.ets') || name.endsWith('.ts'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/, file);
  }
  assert.match(read('entryability/EntryAbility.ets'), /\/\[\?&\]action=\(today\|agendaList\|agenda\|free\)\/\.exec/);
});

test('上课闹钟 sits in the cards panel that 更多 names for it, with one-line segment labels', async () => {
  const index = read('pages/Index.ets');
  assert.ok(index.indexOf("Text('锁屏卡片')") < index.indexOf("Text('上课闹钟')"), '上课闹钟 is not in the 桌面与锁屏服务卡片 panel');
  assert.match(read('schedule/NativeSchedulePage.ets'), /'桌面与锁屏服务卡片', '卡片风格、背景和上课闹钟'/);
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../../web/package.json', import.meta.url));
  const { transformSync } = require('esbuild');
  const source = read('schedule/ScheduleClassAlarms.ets');
  const body = source.slice(source.indexOf('export function alarmSegmentText'), source.indexOf('export function alarmLeadText'));
  const { code } = transformSync(body.replace('export ', '') + '\nglobalThis.segment = alarmSegmentText;', { loader: 'ts' });
  new Function(code)();
  assert.deepEqual([30, 45, 60, 90, 10].map(globalThis.segment), ['30分', '45分', '1小时', '1.5小时', '10分']);
});
