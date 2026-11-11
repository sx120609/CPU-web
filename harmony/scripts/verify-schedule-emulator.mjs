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
// The fixture term starts on 2026-09-07; "now" is drawn only in the week that holds today.
const todayWeek = String(Math.min(20, Math.max(1, Math.floor((Date.now() + 8 * 3600000 - Date.UTC(2026, 8, 7)) / 604800000) + 1)));
for (const style of ['minimal', 'grid', 'table', 'paper', 'board']) {
  await start({ style, now: '10:20', week: todayWeek });
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
  await waitFor(nodes => hasPart(nodes, '年', '月'), `${style} month failed`);
  capture(`month-${style}`);
  // 当天安排 sits under the calendar.
  shell('uitest', 'uiInput', 'swipe', '540', '1600', '540', '500', '900');
  await waitFor(nodes => has(nodes, '当天安排') && has(nodes, '日视图'), `${style} month has no 当天安排`);
}
await start({ mode: 'month' });
const month = (await waitFor(nodes => nodes.some(node => /^\d{4} 年 \d+ 月$/.test(node.text)), 'Month title missing'))
  .find(node => /^\d{4} 年 \d+ 月$/.test(node.text)).text;
await click('#schedule-next-month');
await waitFor(nodes => nodes.some(node => /^\d{4} 年 \d+ 月$/.test(node.text) && node.text !== month), 'Next month did not show');
await click('#schedule-previous-month');
await waitFor(nodes => has(nodes, month), 'Previous month did not show');
shell('uitest', 'uiInput', 'swipe', '540', '1600', '540', '500', '900');
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

// ---- NapTable features ----

// Single meetings: Monday's first course cancelled and Tuesday's moved to Thursday evening.
await start({ occurrences: 1, day: 1 });
nodes = await waitFor(nodes => has(nodes, '已停课') && has(nodes, '调') && has(nodes, '药物分析'), 'Seeded single-meeting changes missing');
capture('occurrences-week');
const live = nodes.find(node => node.text === '药物分析');
shell('uitest', 'uiInput', 'longClick', ...point(live).map(String));
await waitFor(nodes => has(nodes, '调整这一次') && has(nodes, '这次停课') && has(nodes, '在这节课加日程'), 'Long-press menu missing');
capture('occurrences-menu');
await click('这次停课');
await waitFor(nodes => nodes.filter(node => node.text === '已停课').length >= 2, 'The meeting was not cancelled');
const cancelled = layout().filter(node => node.text === '药物分析').pop();
shell('uitest', 'uiInput', 'click', ...point(cancelled).map(String));
await click('恢复原安排');
await waitFor(nodes => nodes.filter(node => node.text === '已停课').length === 1, 'The meeting was not restored');
await start({ occurrences: 1, day: 1, panel: 'occurrence' });
await waitFor(nodes => has(nodes, '调整这一次') && hasId(nodes, 'occurrence-save'), 'The 调整这一次 sheet did not open');
await click('#occurrence-slot-11');
await click('#occurrence-slot-12');
await click('#occurrence-save');
await waitFor(nodes => !hasId(nodes, 'occurrence-save'), 'The single change was not saved');
capture('occurrences-moved');
pass('long-press menu, 这次停课, 恢复原安排 and 调整这一次');

// A classmate at another school laid over: the two-column strip.
await start({ overlay: 1 });
nodes = await waitFor(nodes => hasId(nodes, 'schedule-overlay-strip') && hasPart(nodes, '叠加了', '小林'), 'Overlay strip missing');
assert.ok(has(nodes, '系统解剖学') || has(nodes, '药物设计学'));
capture('overlay-strip');
shell('uitest', 'uiInput', 'swipe', '900', '1300', '350', '1300', '600');
await pause(1500);
capture('overlay-strip-swiped');
await click('#schedule-overlay-off');
await waitFor(nodes => !hasId(nodes, 'schedule-overlay-strip'), 'Taking the overlay off did not bring the grid back');
pass('overlay strip, swiping it and taking it off');

// 更多, 找共同空闲, the overlay picker.
await start({ panel: 'tools' });
await waitFor(nodes => has(nodes, '日历与日程') && has(nodes, '一起看') && has(nodes, '外观与设置'), 'Grouped 更多 missing');
capture('tools');
await start({ overlay: 1, panel: 'commonFree' });
await waitFor(nodes => has(nodes, '找共同空闲') && has(nodes, '小林') && has(nodes, '空闲时段'), 'Common free page missing');
capture('common-free');
await start({ overlay: 1, panel: 'overlayPicker' });
await waitFor(nodes => has(nodes, '叠加到我的课表') && has(nodes, '不叠加'), 'Overlay picker missing');
capture('overlay-picker');
pass('grouped 更多, 找共同空闲 and the overlay picker');

// The month: 当天安排 with 日程; a holiday's rest card; the day card.
await start({ mode: 'month' });
await pause(1500);
shell('uitest', 'uiInput', 'swipe', '540', '1600', '540', '500', '900');
await waitFor(nodes => has(nodes, '当天安排') && hasId(nodes, 'schedule-month-open-day'), '当天安排 missing under the month');
capture('month-day-panel');
await start({ mode: 'day', day: 7, style: 'minimal', holiday: '国庆快乐' });
await waitFor(nodes => has(nodes, '国庆快乐') && hasId(nodes, 'schedule-fireworks'), 'Holiday greeting or fireworks button missing');
capture('holiday');
await start({ panel: 'shareCard', day: 1, occurrences: 1 });
await waitFor(nodes => has(nodes, '由 拾间课表 生成') && has(nodes, '停课'), 'Day share card missing');
capture('share-card');
pass('当天安排, holiday fireworks and the day card');

// 宿舍课表, native.
await start({ dorm: 'active', panel: 'dormWeek' });
await waitFor(nodes => hasId(nodes, 'dorm-tab-week') && hasPart(nodes, '第 10 周'), 'Dorm week missing');
await click('#dorm-cell-0-0');
// The details sit under the grid.
shell('uitest', 'uiInput', 'swipe', '540', '1800', '540', '700', '900');
await waitFor(nodes => has(nodes, '看这天的空闲时段 ›'), 'A dorm cell did not open its details');
capture('dorm-cell');
await click('#dorm-tab-free');
await waitFor(nodes => hasPart(nodes, '的空闲时段') && has(nodes, '每人当天的课'), 'Dorm free page missing');
await click('#dorm-tab-morning');
await waitFor(nodes => hasPart(nodes, '早八'), 'Dorm 早八 page missing');
await click('#dorm-tab-room');
await waitFor(nodes => has(nodes, 'K7M2QX') && has(nodes, '立即同步我的课表'), 'Dorm room page missing');
capture('dorm-room');
pass('native 宿舍课表: 一周, a cell, 空闲, 早八 and 宿舍');

// Cards in the four styles.
await start({ panel: 'cards', background: 1 });
await waitFor(nodes => nodes.filter(node => node.text === '药物化学').length >= 5, 'Card styles missing');
capture('card-styles');
pass('service cards in the timetable styles and over a photo');

await start();
await waitFor(nodes => has(nodes, '药物设计学'), 'Final loaded state missing');
capture('final-week-light');
writeFileSync(resolve(dir, 'results.json'), JSON.stringify({
  bundle: 'cn.lizmt.cpuweb.scheduleqa', device, verifiedAt: new Date().toISOString(),
  input: 'HDC/uitest CLI', fixture: 'deterministic offline data, actual native components', results,
}, null, 2));
console.log(`Evidence: ${dir}`);
