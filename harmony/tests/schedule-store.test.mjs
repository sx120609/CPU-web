import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
const source = readFileSync(new URL('../entry/src/main/ets/schedule/NativeScheduleStore.ets', import.meta.url), 'utf8');
const code = transformSync(source.replace('@Observed', ''), { loader: 'ts', format: 'cjs' }).code;

function harness() {
  let now = Date.now();
  const timers = new Map();
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ module: { exports: {} }, Date: Clock,
    setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(code, context);
  const store = new context.module.exports.NativeScheduleStore();
  const requests = [];
  store.attach(request => requests.push(request), () => {});
  const snapshot = (semester = 'fall', week = '2', completeSemester = false) => ({
    version: 1, completeSemester, fetchedAt: now,
    auth: { authenticated: true, identity: 'undergraduate' },
    data: { currentSemester: semester, currentWeek: week,
      semesters: [{ value: 'fall', label: '秋', current: true }, { value: 'spring', label: '春', current: false }],
      weeks: [1,2,3].map(n => ({ value: String(n), label: String(n), current: n === 2 })),
      cells: [{ day: 1, bigSlot: 1, courses: [{ name: '药理学', weeks: '2-4周(双)', weekList: [2,4] }] }],
    },
  });
  const accept = payload => store.acceptResult(requests.at(-1).id, JSON.stringify(payload));
  return { store, requests, timers, snapshot, accept, advance: ms => now += ms };
}

test('opening schedule before Web ready resumes when the bridge appears', () => {
  const h = harness(); h.store.load(false);
  assert.equal(h.store.status, 'loading'); assert.equal(h.requests.length, 0);
  h.store.markBridgeReady(); assert.equal(h.requests.length, 1);
  h.accept(h.snapshot()); assert.equal(h.store.status, 'loaded');
});
test('repeated selection joins one request, complete semester filters locally', () => {
  const h = harness(); h.store.markBridgeReady(); h.store.load(false); h.store.load(false);
  assert.equal(h.requests.length, 1); h.accept(h.snapshot('fall','2',true));
  h.store.selectWeek('3'); assert.equal(h.store.visibleCells().length, 0);
  assert.equal(h.requests.filter(r => r.id).length, 1);
  h.store.selectWeek('2'); assert.equal(h.store.visibleCells().length, 1);
});
test('returning to a cached week rejects a slower foreground response', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept(h.snapshot());
  h.store.selectWeek('3'); const slow = h.requests.at(-1);
  h.store.selectWeek('2'); h.store.acceptResult(slow.id, JSON.stringify(h.snapshot('fall','3')));
  assert.equal(h.store.selectedWeek, '2'); assert.equal(h.store.result.currentWeek, '2');
});
test('a failed different week never shows previous-week courses', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept(h.snapshot());
  h.store.selectWeek('3'); h.accept({ version: 1, auth: { authenticated: true }, error: 'offline' });
  assert.equal(h.store.status, 'failed'); assert.equal(h.store.visibleCells().length, 0);
});

test('swipe previews use matching cache without navigating or requesting', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept(h.snapshot('fall', '2', true));
  const requests = h.requests.length;
  const outgoing = h.store.previewWeek('2');
  assert.notEqual(outgoing, h.store);
  assert.equal(outgoing.visibleCells().length, 1);
  assert.equal(h.store.previewWeek('3').visibleCells().length, 0);
  assert.equal(h.store.previewWeek('1').selectedWeek, '1');
  assert.equal(h.store.selectedWeek, '2');
  assert.equal(h.requests.length, requests);
  h.store.selectWeek('3');
  assert.equal(outgoing.selectedWeek, '2');
  assert.equal(outgoing.visibleCells().length, 1);
});

test('uncached swipe pages show loading, preserve navigation, and never borrow current courses', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept(h.snapshot());
  const preview = h.store.previewWeek('3');
  assert.equal(preview.status, 'loading');
  assert.equal(preview.result, undefined);
  assert.equal(preview.visibleCells().length, 0);
  h.store.selectWeek('3');
  assert.equal(h.store.weekOptions().length, 3);
  assert.equal(h.store.selectedWeekIndex(), 2);
  assert.equal(h.store.canMoveWeek(1), false);
  h.store.moveWeek(-1);
  assert.equal(h.store.selectedWeek, '2');
  assert.equal(h.store.visibleCells().length, 1);
});

test('auth changes and semester changes discard page navigation and preview data', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept(h.snapshot('fall', '2', true));
  h.store.selectSemester('spring');
  assert.equal(h.store.weekOptions().length, 0);
  assert.equal(h.store.previewWeek('2').result, undefined);
  h.accept(h.snapshot('spring', '2', true));
  h.store.handleAuthChanged();
  assert.equal(h.store.weekOptions().length, 0);
  assert.equal(h.store.previewWeek('2').result, undefined);
});
test('failed manual refresh retains visible data and exposes retry message', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept(h.snapshot());
  h.store.load(true); h.accept({ version: 1, auth: { authenticated: true }, error: 'offline' });
  assert.equal(h.store.status, 'loaded'); assert.equal(h.store.errorMessage, 'offline');
  assert.equal(h.store.visibleCells().length, 1);
});
test('authorization failure clears cached schedules and detail', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept(h.snapshot());
  h.store.load(true); h.accept({ version: 1, auth: { authenticated: false } });
  assert.equal(h.store.status, 'unauthorized');
  h.store.load(false); assert.equal(h.store.result, undefined);
});
test('account switch rejects old result and prefetch, new instance has no offline data', () => {
  const h = harness(); h.store.markBridgeReady(); const old = h.requests.at(-1); const data = h.snapshot();
  h.accept(data); h.advance(1); h.store.handleAuthChanged();
  h.store.acceptResult(old.id, JSON.stringify(data)); h.store.acceptPrefetched(JSON.stringify(data));
  assert.equal(h.store.result, undefined); assert.equal(harness().store.result, undefined);
});
test('refresh prevents earlier prefetch repopulating stale data', () => {
  const h = harness(); h.store.markBridgeReady(); const old = h.snapshot('fall','2',true); h.accept(old);
  h.advance(100); h.store.load(true); h.store.acceptPrefetched(JSON.stringify(old));
  assert.equal(h.store.status, 'loading'); h.accept(h.snapshot());
  h.store.selectWeek('3'); assert.equal(h.store.status, 'loading');
});
test('prefetch warms a known semester without changing visible selection', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept(h.snapshot());
  h.store.acceptPrefetched(JSON.stringify(h.snapshot('fall','3')));
  assert.equal(h.store.selectedWeek, '2'); h.store.selectWeek('3');
  assert.equal(h.store.status, 'loaded'); assert.equal(h.requests.filter(r => r.id).length, 1);
});
test('TTL uses fetch time, not arrival time', () => {
  const h = harness(); h.store.markBridgeReady(); const old = h.snapshot();
  h.advance(13 * 60 * 60 * 1000); h.accept(old); h.store.load(false);
  assert.equal(h.store.status, 'loading'); assert.equal(h.requests.length, 2);
});
test('return to this week discards historical semester parameters', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept(h.snapshot('spring','1'));
  h.store.returnToCurrentWeek(); assert.equal(h.requests.at(-1).semester, ''); assert.equal(h.requests.at(-1).week, '');
  h.accept(h.snapshot('fall','2')); assert.equal(h.store.selectedSemester, 'fall'); assert.equal(h.store.selectedWeek,'2');
});
test('unsupported schema and wrong semester fail visibly', () => {
  const h = harness(); h.store.markBridgeReady(); h.accept({ ...h.snapshot(), version: 2 });
  assert.equal(h.store.status, 'failed'); h.store.selectSemester('spring'); h.accept(h.snapshot('fall'));
  assert.match(h.store.errorMessage, /其他学期/);
});
test('request timeout leaves retryable failure, late response cannot overwrite', () => {
  const h = harness(); h.store.markBridgeReady(); const request = h.requests.at(-1);
  [...h.timers.values()].forEach(fn => fn()); assert.equal(h.store.status, 'failed');
  h.store.acceptResult(request.id, JSON.stringify(h.snapshot())); assert.equal(h.store.status, 'failed');
});

test('contiguous duplicate course rows merge without modifying cached source cells', () => {
  const h=harness(); h.store.markBridgeReady(); const data=h.snapshot();
  const course={name:'连续实验',teacher:'教师',location:'B311',weeks:'2周',weekList:[2]};
  data.data.cells=[{day:1,bigSlot:1,courses:[course]},{day:1,bigSlot:2,courses:[course]},{day:1,bigSlot:4,courses:[course]}];
  h.accept(data); const blocks=h.store.blocksForDay(1);
  assert.equal(blocks.length,2); assert.equal(blocks[0].startSlot,1); assert.equal(blocks[0].endSlot,4);
  assert.equal(blocks[0].course.slotNote,'01-04节'); assert.equal(blocks[1].startSlot,7);
  assert.equal(h.store.result.cells[0].courses[0].startSlot,undefined);
});
test('a distinct course or custom identity in the same slot is preserved', () => {
  const h=harness(); h.store.markBridgeReady(); const data=h.snapshot();
  data.data.cells=[{day:1,bigSlot:1,courses:[
    {name:'实验',weeks:'2周',weekList:[2],customId:'a'},
    {name:'实验',weeks:'2周',weekList:[2],customId:'b'},
    {name:'另一门课程',weeks:'2周',weekList:[2]}
  ]}]; h.accept(data); assert.equal(h.store.blocksForDay(1).length,3);
});
test('native grid uses the actual table position for an inconsistent school slot range', () => {
  const h=harness(); h.store.markBridgeReady(); const data=h.snapshot();
  data.data.cells=[{day:1,bigSlot:3,courses:[{name:'实验',weeks:'2周',weekList:[2],startSlot:1,endSlot:2}]}];
  h.accept(data); const [block]=h.store.blocksForDay(1);
  assert.equal(block.startSlot,5); assert.equal(block.endSlot,6); assert.equal(block.bigSlot,3);
});
test('previous and next week follow available options and stop at both boundaries', () => {
  const h=harness(); h.store.markBridgeReady(); h.accept(h.snapshot('fall','2',true));
  h.store.moveWeek(-1); assert.equal(h.store.selectedWeek,'1'); assert.equal(h.store.canMoveWeek(-1),false);
  h.store.moveWeek(-1); assert.equal(h.store.selectedWeek,'1');
  h.store.moveWeek(1); h.store.moveWeek(1); assert.equal(h.store.selectedWeek,'3'); assert.equal(h.store.canMoveWeek(1),false);
});


test('cold restart restores fresh account-scoped courses and navigation without requesting', () => {
  const h = harness(); let saved = '';
  h.store.attachPersistence(raw => saved = raw);
  h.store.handleAuthChanged('user-1:undergraduate');
  h.store.markBridgeReady(); h.accept(h.snapshot('fall', '2', true));
  h.store.selectDay(4); h.store.setViewMode('day');
  const restarted = harness(); restarted.store.restoreCache(saved);
  assert.equal(restarted.store.status, 'loaded');
  assert.equal(restarted.store.selectedDay, 4); assert.equal(restarted.store.viewMode, 'day');
  assert.equal(restarted.store.visibleCells().length, 1);
  assert.equal(restarted.store.handleAuthChanged('user-1:undergraduate'), false);
  restarted.store.markBridgeReady(); restarted.store.load(false);
  assert.equal(restarted.requests.filter(request => request.id).length, 0);
  restarted.store.load(true);
  assert.equal(restarted.requests.filter(request => request.id).length, 1);
});

test('cold caches expire at their original fetch time and reject malformed data', () => {
  const h = harness(); let saved = '';
  h.store.attachPersistence(raw => saved = raw); h.store.handleAuthChanged('user-1:undergraduate');
  h.store.markBridgeReady(); h.accept(h.snapshot('fall', '2', true));
  const expired = harness(); expired.advance(13 * 60 * 60 * 1000); expired.store.restoreCache(saved);
  assert.equal(expired.store.result, undefined);
  for (const raw of ['{', '{}', JSON.stringify({...JSON.parse(saved), accountScope: ''})]) {
    const broken = harness(); broken.store.restoreCache(raw); assert.equal(broken.store.result, undefined);
  }
});

test('logout, account switch and identity switch delete the restored disk cache', () => {
  const h = harness(); let saved = '';
  h.store.attachPersistence(raw => saved = raw); h.store.handleAuthChanged('user-1:undergraduate');
  h.store.markBridgeReady(); h.accept(h.snapshot('fall', '2', true));
  for (const scope of ['', 'user-2:undergraduate', 'user-1:graduate']) {
    const next = harness(); next.store.restoreCache(saved); let write;
    next.store.attachPersistence(raw => write = raw);
    assert.equal(next.store.handleAuthChanged(scope), true);
    assert.equal(next.store.result, undefined); assert.equal(write, '');
  }
});
