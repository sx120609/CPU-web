import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { build } from '../node_modules/esbuild/lib/main.js';

const bundle = await build({ entryPoints: ['web/src/views/schedule/semesterLoader.ts'],
  bundle: true, write: false, format: 'iife', globalName: 'loader', platform: 'browser' });
function setup(fetch) {
  const timers = [];
  const context = vm.createContext({ setTimeout: callback => timers.push(callback) });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const published = [];
  return { loader: context.loader.createSemesterScheduleLoader(fetch, (response, week, reset) => published.push({ response, week, reset })),
    published, timers };
}
function response(scope = 'semester', week = '1', semester = '2026-2027-1') {
  return { parsed: { scope, currentSemester: semester, currentWeek: week, semesters: [],
    weeks: [1, 2, 3, 4].map(value => ({ value: String(value), label: `${value}`, current: value === Number(week) })),
    cells: [{ day: 1, bigSlot: 1, courses: [{ name: `Course ${week}`, weeks: week, weekList: [Number(week)] }] }] } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('whole semester is requested once across repeated and concurrent week navigation', async () => {
  const calls = [];
  const { loader, timers } = setup(async params => { calls.push(params); return response(); });
  const results = await Promise.all([loader.load('2026-2027-1', '1'), loader.load('2026-2027-1', '4')]);
  for (const week of ['3', '2', '1', '4']) await loader.load('2026-2027-1', week);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].week, 'all');
  assert.equal(results[0], results[1]);
  assert.equal(timers.length, 0);
});

test('manual refresh refetches all rules exactly once and subsequent navigation uses the new rules', async () => {
  const calls = [];
  const { loader } = setup(async params => { calls.push(params); return response('semester', String(calls.length)); });
  await loader.load('2026-2027-1', '1');
  const refreshed = await loader.load('2026-2027-1', '2', true);
  assert.equal(await loader.load('2026-2027-1', '4'), refreshed);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].week, 'all');
  assert.equal(calls[1].refresh, '1');
});

test('legacy week response fills the entire semester and shares background requests with navigation', async () => {
  const calls = [];
  let finishSecond;
  const { loader, timers, published } = setup(async params => {
    calls.push(params.week);
    if (params.week === '2') await new Promise(resolve => { finishSecond = resolve; });
    return response('week', params.week === 'all' ? '1' : params.week);
  });
  await loader.load('2026-2027-1', '1');
  timers.shift()();
  await flush();
  const selected = loader.load('2026-2027-1', '2');
  finishSecond();
  await selected;
  await flush();
  assert.deepEqual(calls, ['all', '2', '3', '4']);
  for (const week of ['1', '2', '3', '4']) await loader.load('2026-2027-1', week);
  assert.equal(calls.length, 4);
  assert.deepEqual(published.map(item => item.week), ['1', '2', '3', '4']);
});

test('unknown scope is not treated as a complete semester', async () => {
  const calls = [];
  // Explicitly remove scope to simulate an old server.
  const old = setup(async params => { calls.push(params.week); const value = response('week', params.week === 'all' ? '1' : params.week); delete value.parsed.scope; return value; });
  await old.loader.load('2026-2027-1', '3');
  await old.loader.load('2026-2027-1', '4');
  assert.deepEqual(calls, ['all', '3', '4']);
});

test('authorization failures do not trigger an all-weeks compatibility retry', async () => {
  let calls = 0;
  const { loader } = setup(async () => { calls++; throw Object.assign(new Error('expired'), { status: 401 }); });
  await assert.rejects(loader.load('2026-2027-1', '1'), /expired/);
  assert.equal(calls, 1);
});

test('a transient failure does not switch the page to week-by-week loading for good', async () => {
  const calls = [];
  let fail = true;
  const { loader } = setup(async params => {
    calls.push(params.week);
    if (fail) { fail = false; throw Object.assign(new Error('教务 Agent 当前繁忙'), { status: 503 }); }
    return response();
  });
  await assert.rejects(loader.load('2026-2027-1', '1'), /繁忙/);
  await loader.load('2026-2027-1', '1');
  assert.deepEqual(calls, ['all', 'all']);
});

test('a whole-semester answer that cannot be used falls back, a network error does not', async () => {
  const calls = [];
  const { loader } = setup(async params => {
    calls.push(params.week);
    if (params.week === 'all') throw new Error('教务系统未返回有效课表');
    return response('week', params.week);
  });
  await loader.load('2026-2027-1', '1');
  assert.deepEqual(calls, ['all', '1']);

  const offline = [];
  const second = setup(async params => {
    offline.push(params.week);
    throw Object.assign(new Error('暂时无法连接教务服务，请稍后重试'), { authGeneration: 3 });
  });
  await assert.rejects(second.loader.load('2026-2027-1', '1'), /无法连接/);
  assert.deepEqual(offline, ['all']);
});

test('an older server rejecting the whole-semester request falls back to single weeks', async () => {
  const calls = [];
  const { loader } = setup(async params => {
    calls.push(params.week);
    if (params.week === 'all') throw Object.assign(new Error('参数错误'), { status: 400 });
    return response('week', params.week);
  });
  await loader.load('2026-2027-1', '1');
  assert.deepEqual(calls, ['all', '1']);
});

test('clearing the account discards in-flight results without publishing them', async () => {
  let finish;
  const { loader, published } = setup(() => new Promise(resolve => { finish = resolve; }));
  const old = loader.load('2026-2027-1', '1');
  loader.clear();
  finish(response());
  await assert.rejects(old, /失效/);
  assert.equal(published.length, 0);
});

test('refresh supersedes an older whole-semester request', async () => {
  let finish;
  let calls = 0;
  const { loader, published } = setup(() => ++calls === 1
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response('semester', '2')));
  const old = loader.load('2026-2027-1', '1');
  await loader.load('2026-2027-1', '1', true);
  finish(response());
  await assert.rejects(old, /失效/);
  assert.equal(published.length, 1);
  assert.equal(published[0].response.parsed.currentWeek, '2');
  assert.equal(published[0].reset, true);
});

test('failed refresh leaves the published offline cache intact', async () => {
  let fail = false;
  const { loader, published } = setup(async () => {
    if (fail) throw Object.assign(new Error('offline'), { status: 401 });
    return response();
  });
  await loader.load('2026-2027-1', '1');
  fail = true;
  await assert.rejects(loader.load('2026-2027-1', '1', true), /offline/);
  assert.equal(published.length, 1);
  assert.equal(published[0].reset, false);
});

test('semester switches stop old background filling and keep semesters isolated', async () => {
  const calls = [];
  const { loader, timers } = setup(async params => {
    calls.push(`${params.semester}:${params.week}`);
    return response('week', '1', params.semester);
  });
  await loader.load('2026-2027-1', '1');
  await loader.load('2026-2027-2', '1');
  timers[0]();
  await flush();
  assert.deepEqual(calls, ['2026-2027-1:all', '2026-2027-2:all']);
});

test('failed prefetch retains successful weeks and retries only missing weeks', async () => {
  const calls = [];
  let fail = true;
  const { loader, timers } = setup(async params => {
    calls.push(params.week);
    if (params.week === '2' && fail) { fail = false; throw new Error('offline'); }
    return response('week', params.week === 'all' ? '1' : params.week);
  });
  await loader.load('2026-2027-1', '1');
  timers.shift()(); await flush();
  await loader.load('2026-2027-1', '1');
  timers.shift()(); await flush();
  assert.deepEqual(calls, ['all', '2', '2', '3', '4']);
});

test('cached navigation reprioritizes missing weeks and stops work for a different semester', async () => {
  const calls = [];
  const { loader, timers } = setup(async params => {
    calls.push(params.week);
    return response('week', params.week === 'all' ? '1' : params.week);
  });
  await loader.load('2026-2027-1', '1');
  loader.select('2026-2027-1', '4');
  timers.shift()(); await flush();
  assert.deepEqual(calls, ['all', '4', '3', '2']);
  await loader.load('2026-2027-1', '1', true);
  loader.select('2026-2027-2', '1');
  timers.shift()(); await flush();
  assert.deepEqual(calls, ['all', '4', '3', '2', 'all']);
});
