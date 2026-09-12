import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from '../../web/node_modules/esbuild/lib/main.js';

const webRoot = fileURLToPath(new URL('../../web/src', import.meta.url));
const mocks = {
  vue: 'export const watch = (_, callback) => globalThis.changed = callback;',
  '@/api/jwxt': 'export const jwxtApi = globalThis.api;',
  '@/stores/auth': 'export const useAuthStore = () => globalThis.auth;',
  '@/stores/jwxt': 'export const useJwxtStore = () => globalThis.jwxt;',
  './clientInfo': 'export const isNativeScheduleShell = () => globalThis.native; export const isIosNextNativeShell = isNativeScheduleShell;',
};
const bundle = await build({
  entryPoints: [`${webRoot}/utils/iosNextScheduleBridge.ts`], bundle: true, write: false,
  format: 'iife', globalName: 'bridge', platform: 'browser', alias: { '@': webRoot },
  plugins: [{ name: 'session-mocks', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
  } }],
});
const sample = () => ({
  scope: 'week',
  semesters: [{ value: '2025-2026-2', label: '春季学期', current: true }],
  weeks: [{ value: '1', label: '第 1 周', current: true }], currentSemester: '2025-2026-2', currentWeek: '1',
  cells: [{ day: 1, bigSlot: 1, courses: [{ name: '药理学', weeks: '1-8周(单)', weekList: [], teacher: '张老师' }] }],
});
function setup() {
  const context = vm.createContext({ Error, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), native: true, window: { CPUTimeNative: { authChanged() {} } },
    auth: { ready: true, user: { id: 1 }, academicIdentity: 'undergraduate', isLoggedIn: true },
    jwxt: { isLoggedIn: true, hydrate() {}, async ensureSession() { return this.isLoggedIn; }, withSessionRetry: fn => fn() },
    api: { async schedule() { return { parsed: sample() }; }, async calendar() { return { parsed: null }; },
      async getScheduleEdits() { return { edits: { hidden: [], custom: [] } }; },
      async graduateSchedule() { return { parsed: sample() }; } },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  context.bridge.installIosNextScheduleBridge();
  return context;
}

test('normal browser never installs native data access', () => {
  const ctx = setup();
  delete ctx.window.CPUTimeNativeScheduleFetch;
  ctx.native = false;
  ctx.bridge.installIosNextScheduleBridge();
  assert.equal(ctx.window.CPUTimeNativeScheduleFetch, undefined);
});

test('Harmony refresh starts current-week and metadata reads together without a redundant status probe', async () => {
  const ctx = setup(); ctx.bridge.installIosNextScheduleBridge(undefined, { fastRefresh:true });
  const requested = []; let finishSchedule;
  ctx.jwxt.ensureSession = async options => { assert.equal(options.refresh,false); return true; };
  ctx.api.schedule = params => { requested.push(['schedule',params.week,params.refresh]);
    return new Promise(resolve=>finishSchedule=()=>resolve({parsed:sample()})); };
  ctx.api.calendar = async () => { requested.push(['calendar']);return {parsed:null}; };
  ctx.api.getScheduleEdits = async () => { requested.push(['edits']);return {edits:{hidden:[],custom:[]}}; };
  const pending=ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2','1',true);
  await new Promise(setImmediate);
  assert.equal(requested.length,3);assert.deepEqual(requested.find(r=>r[0]==='schedule'),['schedule','1','1']);
  finishSchedule();const result=await pending;
  assert.equal(result.error,undefined);assert.equal(result.data.currentWeek,'1');
});

test('parallel refresh does not hide a saved-edit error or accept a switched account', async () => {
  const ctx=setup();ctx.bridge.installIosNextScheduleBridge(undefined,{fastRefresh:true});
  ctx.api.getScheduleEdits=async()=>{throw new Error('修改记录不可用');};
  const failed=await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2','1',true);
  assert.equal(failed.error,'修改记录不可用');assert.equal(failed.data,undefined);
  ctx.api.getScheduleEdits=async()=>{ctx.auth.user.id=2;ctx.changed();return {edits:{hidden:[],custom:[]}};};
  const switched=await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2','1',true);
  assert.equal(switched.auth.authenticated,false);assert.equal(switched.data,undefined);
});
test('native payload uses real schedule, custom courses and normalized odd weeks', async () => {
  const ctx = setup();
  ctx.api.getScheduleEdits = async () => ({ edits: { hidden: [], custom: [{ id: 'extra', day: 2, bigSlot: 3,
    course: { name: '自习', weeks: '全部周', weekList: [] } }] } });
  const result = await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1', false);
  assert.equal(result.auth.authenticated, true);
  assert.equal(result.periods.length, 11);
  assert.equal(result.periods[0].number, 1);
  assert.equal(result.periods[0].startTime, '08:00');
  assert.equal(result.periods[0].endTime, '08:45');
  assert.deepEqual(Array.from(result.data.cells[0].courses[0].weekList), [1, 3, 5, 7]);
  assert.match(result.data.cells[0].courses[0].nativeId, /^official\|2025-2026-2\|1\|1\|/);
  assert.equal(result.data.cells[1].courses[0].name, '自习');
  assert.equal(result.data.cells[1].courses[0].nativeId, 'custom:extra');
});

test('native course identity stays stable when teacher or room changes', async () => {
  const first = setup();
  const firstResult = await first.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1', false);

  const second = setup();
  second.api.schedule = async () => {
    const changed = sample();
    changed.cells[0].courses[0].teacher = '李老师';
    changed.cells[0].courses[0].location = '教学楼 201';
    return { parsed: changed };
  };
  const secondResult = await second.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1', false);

  assert.equal(
    firstResult.data.cells[0].courses[0].nativeId,
    secondResult.data.cells[0].courses[0].nativeId,
  );
});
test('unauthenticated sessions never request academic records', async () => {
  const ctx = setup();
  ctx.jwxt.isLoggedIn = false;
  ctx.api.schedule = () => { throw new Error('must not request'); };
  const result = await ctx.window.CPUTimeNativeScheduleFetch();
  assert.equal(result.auth.authenticated, false);
  assert.equal(result.data, undefined);
});
test('account changes discard an in-flight response', async () => {
  const ctx = setup();
  ctx.api.schedule = async () => { ctx.auth.user.id = 2; ctx.changed(); return { parsed: sample() }; };
  const result = await ctx.window.CPUTimeNativeScheduleFetch();
  assert.equal(result.auth.authenticated, false);
  assert.equal(result.data, undefined);
});
test('graduate identity uses graduate schedule and calendar without undergraduate edits', async () => {
  const ctx = setup();
  ctx.auth.academicIdentity = 'graduate';
  ctx.api.schedule = ctx.api.getScheduleEdits = () => { throw new Error('wrong identity API'); };
  const result = await ctx.window.CPUTimeNativeScheduleFetch();
  assert.equal(result.source, 'graduate');
  assert.ok(result.calendar.weeks.length);
});
test('saved-edit failure is explicit rather than silently showing original courses', async () => {
  const ctx = setup();
  ctx.api.getScheduleEdits = async () => { throw new Error('修改记录暂时不可用'); };
  const result = await ctx.window.CPUTimeNativeScheduleFetch();
  assert.equal(result.error, '修改记录暂时不可用');
  assert.equal(result.data, undefined);
});

test('undergraduate semester fetch includes future weeks and deduplicates repeated courses', async () => {
  const ctx = setup();
  const requested = [];
  ctx.api.schedule = async (params) => {
    requested.push(params.week);
    const data = sample();
    data.weeks = [1, 2, 3].map(value => ({ value: String(value), label: String(value) }));
    data.cells[0].courses[0].weeks = '1-3周';
    if (params.week === '3') data.cells[0].courses.push({ name: '第三周实验', weeks: '3周', weekList: [] });
    return { parsed: data };
  };
  const completed = new Promise(resolve => { ctx.window.CPUTimeNative.schedulePrefetched = resolve; });
  const first = await ctx.window.CPUTimeNativeScheduleFetch(undefined, '1');
  assert.equal(first.completeSemester, false);
  assert.deepEqual(requested, ['all']);
  const result = await completed;
  assert.equal(result.completeSemester, true);
  assert.deepEqual(requested, ['all', '2', '3']);
  assert.equal(result.data.cells[0].courses.length, 2);
});

test('failed background work preserves the first week and retries only missing weeks', async () => {
  const ctx = setup();
  let fail = true;
  const requests = [];
  ctx.api.schedule = async (params) => {
    requests.push(params.week);
    if (params.week === '3' && fail) throw new Error('第三周读取失败');
    const data = sample();
    data.weeks = [1, 2, 3].map(value => ({ value: String(value) }));
    return { parsed: data };
  };
  let updates = 0;
  ctx.window.CPUTimeNative.schedulePrefetched = () => { updates++; };
  const first = await ctx.window.CPUTimeNativeScheduleFetch(undefined, '1');
  assert.ok(first.data);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(updates, 0);
  fail = false;
  const completed = new Promise(resolve => { ctx.window.CPUTimeNative.schedulePrefetched = resolve; });
  await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1');
  await completed;
  assert.deepEqual(requests, ['all', '2', '3', '3']);
});

test('verified semester rules require one timetable request for every week selection', async () => {
  const ctx = setup();
  let calls = 0;
  let editCalls = 0;
  ctx.api.schedule = async (params) => {
    calls++;
    assert.equal(params.week, 'all');
    return { parsed: { ...sample(), scope: 'semester', currentWeek: '' } };
  };
  ctx.api.getScheduleEdits = async () => { editCalls++; return { edits: {} }; };
  const result = await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1');
  assert.equal(result.completeSemester, true);
  const later = await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '12');
  assert.equal(later.data.currentWeek, '12');
  assert.equal(calls, 1);
  assert.equal(editCalls, 1);
});

test('foreground requests share a background request for the same week', async () => {
  const ctx = setup();
  let release;
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  let weekTwoCalls = 0;
  ctx.api.schedule = async (params) => {
    const data = sample();
    data.weeks = [1, 2].map(value => ({ value: String(value) }));
    if (params.week === '2') {
      weekTwoCalls++;
      started();
      await new Promise(resolve => { release = resolve; });
    }
    return { parsed: data };
  };
  await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1');
  await waiting;
  const second = ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '2');
  release();
  assert.ok((await second).data);
  assert.equal(weekTwoCalls, 1);
});

test('account changes stop old background work before it can publish', async () => {
  const ctx = setup();
  let release;
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  let updates = 0;
  ctx.window.CPUTimeNative.schedulePrefetched = () => { updates++; };
  ctx.api.schedule = async (params) => {
    const data = sample();
    data.weeks = [1, 2].map(value => ({ value: String(value) }));
    if (params.week === '2') { started(); await new Promise(resolve => { release = resolve; }); }
    return { parsed: data };
  };
  await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1');
  await waiting;
  ctx.auth.user.id = 2;
  ctx.changed();
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(updates, 0);
});

test('manual refresh bypasses the server cache once, not once per teaching week', async () => {
  const ctx = setup();
  const requests = [];
  ctx.api.schedule = async (params) => {
    requests.push(params);
    return { parsed: { ...sample(), weeks: [1, 2, 3].map(value => ({ value: String(value) })) } };
  };
  const completed = new Promise(resolve => { ctx.window.CPUTimeNative.schedulePrefetched = resolve; });
  await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1', true);
  await completed;
  assert.equal(requests.filter(item => item.refresh === '1').length, 1);
});

test('an old server without scope is retried through the old weekly contract', async () => {
  const ctx = setup();
  const requests = [];
  ctx.api.schedule = async (params) => {
    requests.push(params.week);
    const data = sample();
    delete data.scope;
    if (params.week === 'all') data.cells = []; // Unsupported sentinel must not poison the visible cache.
    return { parsed: data };
  };
  const result = await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '3');
  assert.deepEqual(requests, ['all', '3']);
  assert.equal(result.data.cells[0].courses[0].name, '药理学');
  assert.equal(result.completeSemester, false);
});

test('a legacy server rejecting all-weeks falls back, but auth failures never do', async () => {
  for (const status of [400, 401]) {
    const ctx = setup();
    const requests = [];
    ctx.api.schedule = async (params) => {
      requests.push(params.week);
      if (params.week === 'all') throw Object.assign(new Error('unsupported'), { status });
      return { parsed: sample() };
    };
    const result = await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1');
    if (status === 400) {
      assert.deepEqual(requests, ['all', '1']);
      assert.ok(result.data);
    } else {
      assert.deepEqual(requests, ['all']);
      assert.equal(result.data, undefined);
    }
  }
});

test('unknown scope never claims a complete semester from a course week range', async () => {
  const ctx = setup();
  ctx.api.schedule = async () => ({ parsed: { ...sample(), scope: 'unknown', weeks: [] } });
  let updates = 0;
  ctx.window.CPUTimeNative.schedulePrefetched = () => { updates++; };
  const result = await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '1');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(result.completeSemester, false);
  assert.equal(updates, 0);
});

test('prefetch starts beside the visible week and publishes each week before semester completion', async () => {
  const ctx = setup();
  const requests = [];
  const warmed = [];
  ctx.api.schedule = async (params) => {
    requests.push(params.week);
    const data = sample();
    data.currentWeek = params.week === 'all' ? '5' : params.week;
    data.weeks = Array.from({ length: 9 }, (_, index) => ({ value: String(index + 1) }));
    return { parsed: data };
  };
  ctx.window.CPUTimeNative.scheduleWeekPrefetched = value => {
    assert.equal(value.completeSemester, false);
    warmed.push(value.data.currentWeek);
  };
  const completed = new Promise(resolve => { ctx.window.CPUTimeNative.schedulePrefetched = resolve; });
  await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '5');
  await completed;
  assert.deepEqual(requests.slice(0, 5), ['all', '6', '4', '7', '3']);
  assert.deepEqual(warmed.slice(0, 4), ['6', '4', '7', '3']);
  assert.equal(warmed.length, 8);
});

test('a native cache hit reprioritizes the next background week without a foreground fetch', async () => {
  const ctx = setup();
  const requests = [];
  ctx.api.schedule = async (params) => {
    requests.push(params.week);
    const data = sample();
    data.currentWeek = params.week === 'all' ? '5' : params.week;
    data.weeks = Array.from({ length: 8 }, (_, index) => ({ value: String(index + 1) }));
    return { parsed: data };
  };
  ctx.window.CPUTimeNative.scheduleWeekPrefetched = value => {
    if (value.data.currentWeek === '6') ctx.window.CPUTimeNativeSchedulePrioritize('2025-2026-2', '6');
  };
  const completed = new Promise(resolve => { ctx.window.CPUTimeNative.schedulePrefetched = resolve; });
  await ctx.window.CPUTimeNativeScheduleFetch('2025-2026-2', '5');
  await completed;
  assert.deepEqual(requests.slice(0, 3), ['all', '6', '7']);
  assert.equal(requests.filter(value => value === '6').length, 1);
});
