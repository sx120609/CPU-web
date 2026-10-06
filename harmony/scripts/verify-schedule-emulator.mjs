// HDC/uitest only: no Windows UI input, desktop capture, account, or network API.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const [hdc, device, output] = process.argv.slice(2);
if (!hdc || !device || !output) throw new Error('Usage: node verify-schedule-emulator.mjs <hdc.exe> <device> <output-dir>');
const dir = resolve(output);
mkdirSync(dir, { recursive: true });
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(...args) {
  const result = spawnSync(hdc, ['-t', device, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (result.error || result.status !== 0 || /error:|fail to|^failed\b/im.test(result.stdout + result.stderr)) {
    throw new Error(`${args.join(' ')}: ${result.error || result.stdout + result.stderr}`);
  }
  return result.stdout.trim();
}
const shell = (...args) => run('shell', ...args);
function flatten(root) {
  return [root.attributes, ...(root.children || []).flatMap(flatten)];
}
function layout() {
  shell('uitest', 'dumpLayout', '-p', '/data/local/tmp/schedule-acceptance.json');
  run('file', 'recv', '/data/local/tmp/schedule-acceptance.json', resolve(dir, 'current-layout.json'));
  return flatten(JSON.parse(readFileSync(resolve(dir, 'current-layout.json'), 'utf8')));
}
function has(nodes, text) { return nodes.some(node => node.text === text); }
async function waitFor(test, message) {
  const deadline = Date.now() + 8000;
  do {
    const nodes = layout();
    if (test(nodes)) return nodes;
    await pause(250);
  } while (Date.now() < deadline);
  throw new Error(message);
}
function point(node) {
  const [x1, y1, x2, y2] = node.bounds.match(/-?\d+/g).map(Number);
  return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];
}
// `#name` selects a control by its ArkUI id (icon-only buttons have no text); anything else matches visible text.
async function click(text) {
  const nodes = layout();
  const node = nodes.find(node => (text.startsWith('#') ? node.id === text.slice(1) : node.text === text) && node.visible !== 'false');
  assert.ok(node, `Missing control: ${text}`);
  shell('uitest', 'uiInput', 'click', ...point(node).map(String));
  await pause(350);
}
async function start({ dark = false, theme = 'color-glass', mode = 'week', state = 'loaded' } = {}) {
  shell('aa', 'force-stop', 'cn.lizmt.cpuweb.scheduleqa');
  shell('aa', 'start', '-a', 'EntryAbility', '-b', 'cn.lizmt.cpuweb.scheduleqa',
    '--ps', 'dark', String(dark), '--ps', 'theme', theme, '--ps', 'mode', mode, '--ps', 'state', state);
  await pause(600);
}
function capture(name) {
  shell('uitest', 'screenCap', '-p', `/data/local/tmp/${name}.png`);
  run('file', 'recv', `/data/local/tmp/${name}.png`, resolve(dir, `${name}.png`));
  writeFileSync(resolve(dir, `${name}.json`), readFileSync(resolve(dir, 'current-layout.json')));
}
function pass(name) { results.push({ name, passed: true }); console.log(`PASS ${name}`); }

await start();
let nodes = await waitFor(nodes => has(nodes, '药物设计学') && has(nodes, '第5周'), 'Weekly timetable did not load');
capture('week-light');
shell('uitest', 'uiInput', 'swipe', '560', '1700', '560', '1250', '900');
nodes = await waitFor(nodes => has(nodes, '12') && has(nodes, '19:45'), 'Twelfth period could not be scrolled into view');
assert.ok(has(nodes, '12') && has(nodes, '19:00') && has(nodes, '19:45'));
const course = nodes.find(node => node.text === '第十二节课程');
const nav = nodes.find(node => node.text === '首页');
assert.ok(point(course)[1] < point(nav)[1], 'Last lesson is obscured by bottom navigation');
capture('week-last-period');
pass('weekly phone grid, 12 configured periods, and bottom clearance');

await click('#schedule-next-week');
await waitFor(nodes => has(nodes, '第6周'), 'Next week did not commit');
await click('#schedule-previous-week');
await waitFor(nodes => has(nodes, '第5周'), 'Previous week did not commit');
shell('uitest', 'uiInput', 'swipe', '850', '1100', '160', '1100', '1200');
await waitFor(nodes => has(nodes, '第6周'), 'Swipe did not commit next week');
for (let i = 0; i < 3; i++) await click('#schedule-next-week');
await waitFor(nodes => has(nodes, '第9周'), 'Repeated week changes lost input');
capture('week-after-swipes');
pass('week arrows, swipe, and repeated changes');

await click('第9周');
await waitFor(nodes => has(nodes, '选择周次'), 'Week picker did not open');
await click('20');
await waitFor(nodes => has(nodes, '第20周') && !has(nodes, '选择周次'), 'Last week selection failed');
capture('last-week');
pass('week picker and last-week boundary');

await start();
await click('日');
// The day view opens on today's weekday; pick Tuesday so the check does not depend on the run date.
await click('周二');
await waitFor(nodes => has(nodes, '药物化学') && !has(nodes, '药物设计学'), 'Day view did not select Tuesday');
nodes = layout();
const dateLabel = nodes.find(node => node.text === '周一');
const firstPeriod = nodes.find(node => node.text === '1');
assert.ok(dateLabel.bounds.match(/-?\d+/g).map(Number)[3] < firstPeriod.bounds.match(/-?\d+/g).map(Number)[1],
  'Date strip overlaps the first period');
capture('day-light');
await click('药物化学');
await waitFor(nodes => has(nodes, '课程详情') && has(nodes, '示例教师'), 'Course details did not open');
capture('course-detail');
shell('uitest', 'uiInput', 'keyEvent', 'Back');
await pause(400);
await click('周一');
await waitFor(nodes => has(nodes, '药物设计学') && !has(nodes, '药物化学'), 'Monday selection failed');
capture('day-monday');
pass('day mode, date selection, and course details');

await click('周日');
await waitFor(nodes => has(nodes, '这一天没有课程'), 'Empty-day state missing');
capture('empty-day');
await click('周六');
await waitFor(nodes => has(nodes, '重叠课程'), 'Saturday fixture missing');
await click('重叠课程');
await waitFor(nodes => has(nodes, '同一时段的课程'), 'Overlapping courses are not accessible');
capture('overlapping-courses');
shell('uitest', 'uiInput', 'keyEvent', 'Back');
pass('empty day, long name, single period, and overlapping-course chooser');

await pause(400);
shell('uitest', 'uiInput', 'swipe', '850', '1700', '850', '850', '900');
nodes = await waitFor(nodes => has(nodes, '12') && has(nodes, '19:45') && has(nodes, '第十二节课程'), 'Final daily period is missing');
capture('day-last-period');
await click('第十二节课程');
await waitFor(nodes => has(nodes, '课程详情') && has(nodes, '12节') && has(nodes, '19:00-19:45'), 'Twelfth-period details use the wrong range or time');
capture('twelfth-period-detail');
shell('uitest', 'uiInput', 'keyEvent', 'Back');
pass('daily final period and configured-time details');

await start({ dark: true });
nodes = await waitFor(nodes => has(nodes, '药物设计学'), 'Dark timetable did not load');
capture('week-dark');
await start({ dark: true, mode: 'day' });
await waitFor(nodes => has(nodes, '周二') && has(nodes, '1'), 'Dark daily timetable did not load');
await click('周二');
await waitFor(nodes => has(nodes, '药物化学'), 'Dark daily timetable did not show Tuesday');
capture('day-dark');
pass('dark weekly and daily modes');

for (const theme of ['green', 'blue', 'teal', 'indigo', 'violet', 'orange', 'rose', 'slate', 'color-glass']) {
  await start({ theme });
  await waitFor(nodes => has(nodes, '药物设计学'), `${theme} timetable failed`);
  capture(`theme-${theme}`);
}
pass('all nine native schedule themes');

for (const [state, title] of [['loading', '正在加载课表'], ['unauthorized', '教务授权已失效'], ['failed', '课表暂时无法加载']]) {
  await start({ state });
  await waitFor(nodes => has(nodes, title), `${state} state missing`);
  capture(`state-${state}`);
}
pass('loading, authorization, and error states');
await start();
await waitFor(nodes => has(nodes, '药物设计学'), 'Final loaded state missing');
capture('final-week-light');
writeFileSync(resolve(dir, 'results.json'), JSON.stringify({
  bundle: 'cn.lizmt.cpuweb.scheduleqa', device, verifiedAt: new Date().toISOString(),
  input: 'HDC/uitest CLI', fixture: 'deterministic offline data, actual native components', results,
}, null, 2));
console.log(`Evidence: ${dir}`);
