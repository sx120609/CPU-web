// Captures store screenshots from the offline acceptance build (prepare-schedule-acceptance.mjs),
// with the sample timetable the iOS client uses for its own, the system status bar hidden and
// "now" pinned to 14:00. HDC/uitest only: no account and no network.
// Usage: node capture-store-screenshots.mjs <hdc.exe> <device> <output-dir>
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [hdc, device, output] = process.argv.slice(2);
if (!hdc || !device || !output) throw new Error('Usage: node capture-store-screenshots.mjs <hdc.exe> <device> <output-dir>');
const dir = resolve(output);
mkdirSync(dir, { recursive: true });
const run = (...args) => {
  const result = spawnSync(hdc, ['-t', device, ...args], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (result.error || result.status !== 0 || /error:|fail to|^failed\b/im.test(result.stdout + result.stderr)) {
    throw Error('HDC failed: ' + args.join(' ') + '\n' + result.stdout + result.stderr);
  }
  return result.stdout;
};
const shell = (...args) => run('shell', ...args);
const pause = ms => new Promise(done => setTimeout(done, ms));
const flatten = node => [node.attributes, ...(node.children || []).flatMap(flatten)];
function layout() {
  shell('uitest', 'dumpLayout', '-p', '/data/local/tmp/promo.json');
  run('file', 'recv', '/data/local/tmp/promo.json', resolve(dir, 'layout.json'));
  return flatten(JSON.parse(readFileSync(resolve(dir, 'layout.json'), 'utf8')));
}
async function waitFor(test, message) {
  const deadline = Date.now() + 10000;
  do {
    const nodes = layout();
    if (test(nodes)) return nodes;
    await pause(300);
  } while (Date.now() < deadline);
  throw Error(message);
}
const center = node => { const [a, b, c, d] = node.bounds.match(/-?\d+/g).map(Number); return [Math.round((a + c) / 2), Math.round((b + d) / 2)]; };
async function tap(match, message) {
  const nodes = await waitFor(nodes => nodes.some(match), message);
  shell('uitest', 'uiInput', 'click', ...center(nodes.filter(match).pop()).map(String));
  await pause(700);
}
async function start(options) {
  shell('aa', 'force-stop', 'cn.lizmt.cpuweb.scheduleqa');
  shell('aa', 'start', '-a', 'EntryAbility', '-b', 'cn.lizmt.cpuweb.scheduleqa',
    ...Object.entries({ data: 'promo', clean: true, now: '14:00', ...options }).flatMap(([key, value]) => ['--ps', key, String(value)]));
  await waitFor(nodes => nodes.some(node => node.text === '首页'), 'The app did not start');
  await pause(1200);
}
function capture(name) {
  shell('uitest', 'screenCap', '-p', '/data/local/tmp/promo.png');
  run('file', 'recv', '/data/local/tmp/promo.png', resolve(dir, name + '.png'));
  console.log('captured', name);
}
const text = value => node => node.text === value;

await start({});
capture('01-week-classic');
await start({ style: 'minimal' });
capture('02-week-minimal');
await start({ style: 'paper' });
capture('03-week-paper');
await start({ style: 'board', mode: 'day', day: 3 });
capture('04-day-board');
await start({ style: 'minimal', mode: 'day', day: 3 });
capture('05-day-minimal');
await start({ mode: 'month' });
capture('06-month-classic');
await start({ style: 'minimal', mode: 'month' });
capture('07-month-minimal');
await start({});
await tap(text('有机化学'), 'No course to open');
await waitFor(nodes => nodes.some(node => node.id === 'schedule-course-edit'), 'The quick look did not open');
capture('08-course-quick-look');
await start({ panel: 'editor', day: 3 });
await waitFor(nodes => nodes.some(text('保存课程')) && nodes.some(text('节次')), 'The editor did not open');
shell('uitest', 'uiInput', 'swipe', '540', '1500', '540', '900', '900');
await pause(800);
capture('09-course-editor');
await start({ panel: 'sharing' });
await tap(node => node.id === 'schedule-share-publish', 'The sharing page did not open');
await waitFor(nodes => nodes.some(text('WXYZ 6789')), 'No share code');
capture('10-sharing');
await start({ style: 'grid', dark: true });
capture('11-week-grid-dark');
await start({ dark: true });
capture('12-week-classic-dark');
shell('aa', 'force-stop', 'cn.lizmt.cpuweb.scheduleqa');
console.log('done', dir);
