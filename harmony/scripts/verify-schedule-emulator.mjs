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
function hasPart(nodes, ...parts) { return nodes.some(node => parts.every(part => String(node.text).includes(part))); }
function hasId(nodes, id) { return nodes.some(node => node.id === id); }
// Decorations hidden from screen readers report no text, only what they draw.
function draws(nodes, text) { return nodes.some(node => node.originalText === text); }
function rect(node) { return node.bounds.match(/-?\d+/g).map(Number); }
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
  const match = node => (text.startsWith('#') ? node.id === text.slice(1) : node.text === text) && node.visible !== 'false';
  // A sheet that is still sliding in, or the keyboard coming up, can hide a control for a moment.
  const nodes = await waitFor(nodes => nodes.some(match), `Missing control: ${text}`);
  const node = nodes.find(match);
  shell('uitest', 'uiInput', 'click', ...point(node).map(String));
  await pause(350);
}
// `extra` passes the harness's other launch parameters: style, weekend, now, priority, week, day, panel.
async function start({ dark = false, theme = 'color-glass', mode = 'week', state = 'loaded', ...extra } = {}) {
  shell('aa', 'force-stop', 'cn.lizmt.cpuweb.scheduleqa');
  shell('aa', 'start', '-a', 'EntryAbility', '-b', 'cn.lizmt.cpuweb.scheduleqa',
    '--ps', 'dark', String(dark), '--ps', 'theme', theme, '--ps', 'mode', mode, '--ps', 'state', state,
    ...Object.entries(extra).flatMap(([key, value]) => ['--ps', key, String(value)]));
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
nodes = await waitFor(nodes => hasPart(nodes, '周二', '第 1–4 节', '08:00–11:45') && has(nodes, '示例教师') && hasId(nodes, 'schedule-course-edit'),
  'Course quick look did not open');
assert.ok(has(nodes, '备注') && has(nodes, '带实验报告'), 'The note someone wrote is missing from the quick look');
capture('course-detail');
shell('uitest', 'uiInput', 'keyEvent', 'Back');
await pause(400);
await click('周一');
await waitFor(nodes => has(nodes, '药物设计学') && !has(nodes, '药物化学'), 'Monday selection failed');
capture('day-monday');
await click('药物设计学');
nodes = await waitFor(nodes => hasPart(nodes, '周一', '第 1–2 节') && hasId(nodes, 'schedule-course-edit'), 'Monday quick look did not open');
assert.ok(!has(nodes, '备注') && !nodes.some(node => /^\d{1,2}-\d{1,2}节$/.test(node.text)), 'A generated period label is shown as the note');
shell('uitest', 'uiInput', 'keyEvent', 'Back');
await pause(400);
pass('day mode, date selection, the course quick look and its note');

await click('周日');
await waitFor(nodes => has(nodes, '这一天没有课程'), 'Empty-day state missing');
capture('empty-day');
await click('周六');
await waitFor(nodes => has(nodes, '重叠课程'), 'Saturday fixture missing');
// Overlapping courses sit side by side, each one tappable.
nodes = layout();
const overlapping = rect(nodes.find(node => node.text === '重叠课程'));
const long = rect(nodes.find(node => String(node.text).startsWith('超长课程名称')));
assert.ok(long[2] <= overlapping[0] || overlapping[2] <= long[0], 'Overlapping courses are drawn on top of each other');
await click('重叠课程');
await waitFor(nodes => hasPart(nodes, '周六', '第 5–6 节') && has(nodes, 'B203'), 'An overlapping course did not open');
capture('overlapping-courses');
shell('uitest', 'uiInput', 'keyEvent', 'Back');
pass('empty day, long name, single period, and overlapping courses in lanes');

await pause(400);
shell('uitest', 'uiInput', 'swipe', '850', '1700', '850', '850', '900');
nodes = await waitFor(nodes => has(nodes, '12') && has(nodes, '19:45') && has(nodes, '第十二节课程'), 'Final daily period is missing');
capture('day-last-period');
await click('第十二节课程');
await waitFor(nodes => hasPart(nodes, '第 12 节', '19:00–19:45') && has(nodes, 'A112'), 'Twelfth-period details use the wrong range or time');
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
for (const style of ['minimal', 'grid', 'table', 'paper', 'board']) {
  await start({ style, now: '10:20' });
  nodes = await waitFor(nodes => has(nodes, '药物设计学') && draws(nodes, '10:20'), `${style} week failed`);
  assert.ok(point(nodes.find(node => node.text === '第十二节课程'))[1]
    < point(nodes.find(node => node.text === '首页'))[1], `${style} week does not fit above the navigation bar`);
  capture(`style-${style}-week`);
  await start({ style, mode: 'day', day: 2, dark: style === 'paper' });
  // The evening course may be below the fold where a style keeps a row for every period.
  nodes = await waitFor(nodes => has(nodes, '药物化学') && !has(nodes, '药物设计学'), `${style} day failed`);
  // The seven-day strip is the style's own date header: the selected day is marked apart from today.
  assert.deepEqual(nodes.filter(node => /^schedule-day-\d$/.test(node.id)).map(node => node.selected),
    ['false', 'true', 'false', 'false', 'false', 'false', 'false'], `${style} day strip does not mark Tuesday`);
  assert.ok(rect(nodes.find(node => node.id === 'schedule-day-1'))[3] <= rect(nodes.find(node => node.text === '药物化学'))[1],
    `${style} day strip overlaps the first course`);
  capture(`style-${style}-day`);
  await click('#schedule-day-1');
  nodes = await waitFor(nodes => has(nodes, '药物设计学') && !has(nodes, '药物化学'), `${style} day strip did not select Monday`);
  assert.equal(nodes.find(node => node.id === 'schedule-day-1').selected, 'true', `${style} day strip did not move its mark`);
}
await start({ style: 'minimal', mode: 'day', day: 7 });
await waitFor(nodes => has(nodes, '这天没有课程'), 'Rest card missing');
capture('style-minimal-rest');
pass('five more timetable styles in the week and day views');

for (const style of ['classic', 'minimal', 'grid', 'table', 'paper', 'board']) {
  await start({ style, mode: 'month' });
  await waitFor(nodes => hasPart(nodes, '年', '月') && has(nodes, '日视图'), `${style} month failed`);
  capture(`month-${style}`);
}
const month = layout().find(node => /^\d{4} 年 \d+ 月$/.test(node.text)).text;
await click('#schedule-next-month');
await waitFor(nodes => nodes.some(node => /^\d{4} 年 \d+ 月$/.test(node.text) && node.text !== month), 'Next month did not show');
await click('#schedule-previous-month');
await waitFor(nodes => has(nodes, month), 'Previous month did not show');
await click('日视图');
await waitFor(nodes => has(nodes, '周一') && nodes.some(node => /^第\d+周$/.test(node.text)), 'The month list did not open the day view');
pass('month view in six styles, month arrows, and opening a day');

await start({ week: 6 });
nodes = await waitFor(nodes => has(nodes, '第6周') && draws(nodes, '休') && draws(nodes, '班'), 'Adjusted days are not marked');
const monday = rect(nodes.find(node => node.text === '周一'));
assert.ok(!nodes.some(node => node.text === '药物设计学' && rect(node)[0] < monday[2]), 'A day off still shows its courses');
assert.equal(nodes.filter(node => node.text === '药事管理学').length, 2, 'The make-up day does not show the courses it takes over');
capture('adjusted-week');
await start({ weekend: false, priority: '重叠课程' });
nodes = await waitFor(nodes => has(nodes, '重叠课程'), 'Hidden-weekend timetable failed');
assert.ok(has(nodes, '周六') && !has(nodes, '周日'), 'A weekend day with classes must stay and an empty one must go');
capture('weekend-hidden-priority');
pass('days off, make-up days, hidden weekends and display priority');

await start({ panel: 'editor', day: 2 });
nodes = await waitFor(nodes => has(nodes, '编辑课程') && has(nodes, '保存课程') && has(nodes, '节次'), 'Course editor did not open');
assert.ok(has(nodes, '带实验报告'), 'The editor lost the note of the course');
await start({ panel: 'editor', day: 1 });
nodes = await waitFor(nodes => has(nodes, '编辑课程') && has(nodes, '保存课程') && has(nodes, '节次'), 'Course editor did not open');
// The note field of a course without one stays empty: saving must not turn the period label into a note.
assert.ok(!nodes.some(node => /^\d{1,2}-\d{1,2}节$/.test(node.text)), 'The editor offers a generated period label as the note');
capture('editor');
shell('uitest', 'uiInput', 'swipe', '540', '1700', '540', '700', '900');
await click('＋ 添加上课时间');
await waitFor(nodes => has(nodes, '上课时间 2'), 'A second meeting time was not added');
await click('保存课程');
await waitFor(nodes => has(nodes, '上课时间 2：请选择至少一节'), 'An empty meeting time was not refused');
capture('editor-second-time');
pass('course editor with several meeting times');

await start({ panel: 'sharing' });
await waitFor(nodes => has(nodes, '共享课表') && hasId(nodes, 'schedule-share-publish'), 'Sharing page did not open');
await click('#schedule-share-publish');
await waitFor(nodes => has(nodes, 'WXYZ 6789') && has(nodes, '已生成分享码'), 'Publishing did not show a share code');
capture('sharing-published');
const field = point(layout().find(node => node.id === 'schedule-share-code'));
shell('uitest', 'uiInput', 'inputText', String(field[0]), String(field[1]), 'abcd-2345');
await pause(600);
await click('查看');
await waitFor(nodes => has(nodes, '阿青 的课表') && has(nodes, '保存到本机'), 'A share was not previewed');
capture('sharing-preview');
await click('先看看');
// The user's own timetable stays mounted underneath, so only the cover's own controls are checked.
await waitFor(nodes => has(nodes, '只读') && has(nodes, '阿青') && hasId(nodes, 'schedule-close'), 'The shared timetable did not open read-only');
capture('sharing-read-only');
const shared = layout().filter(node => node.text === '药物设计学').pop();
shell('uitest', 'uiInput', 'click', ...point(shared).map(String));
await waitFor(nodes => has(nodes, '示例教师') && !hasId(nodes, 'schedule-course-edit'), 'A shared course must not be editable');
shell('uitest', 'uiInput', 'keyEvent', 'Back');
await pause(400);
await click('#schedule-close');
await waitFor(nodes => has(nodes, '保存到本机'), 'Closing a shared timetable did not return to the preview');
await click('保存到本机');
await waitFor(nodes => has(nodes, '已保存的课表') && has(nodes, '阿青'), 'The share was not saved');
capture('sharing-saved');
pass('publishing a share code, previewing, read-only viewing and saving a shared timetable');

await start();
await waitFor(nodes => has(nodes, '药物设计学'), 'Final loaded state missing');
capture('final-week-light');
writeFileSync(resolve(dir, 'results.json'), JSON.stringify({
  bundle: 'cn.lizmt.cpuweb.scheduleqa', device, verifiedAt: new Date().toISOString(),
  input: 'HDC/uitest CLI', fixture: 'deterministic offline data, actual native components', results,
}, null, 2));
console.log(`Evidence: ${dir}`);
