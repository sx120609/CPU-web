import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

function compile(path, globals = {}) {
  const context = vm.createContext({ module: { exports: {} }, require: () => ({}), ...globals });
  vm.runInContext(transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}

const dorm = compile('../entry/src/main/ets/schedule/ScheduleDorm.ets');

/** The real Index.ets methods for the dorm timetable, run on a stand-in page. */
function host({ current = '2026-2027-1', shown = '2026-2027-1', publish } = {}) {
  const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
  const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
  const methods = slice('  private viewingCurrentSemester(', '  // 重叠课程谁显示在前面')
    + slice('  private handleNativeNavigation(', '  private requestSchedule(');
  const ctx = vm.createContext({ module: { exports: {} }, clearTimeout, ...dorm });
  vm.runInContext(transformSync('export class Host {' + methods + '}', { loader: 'ts', format: 'cjs' }).code, ctx);
  const page = new ctx.module.exports.Host();
  const offers = []; const tabs = []; const loads = [];
  Object.assign(page, {
    requiresLogin: false, dormAccount: 'acct-a', navigationRevision: 0,
    scheduleStore: {
      result: {}, bridgeReady: true, status: 'loaded', load: force => loads.push(force),
      semesterOptions: () => [{ value: '2025-2026-2', current: false }, { value: current, current: true }],
      prioritySemester: () => shown,
    },
    sharePublishBody: publish ?? (() => ({ semester: shown, schedule: { cells: [] }, calendar: { weeks: [{ week: 1 }] } })),
    scriptLiteral: value => JSON.stringify(value),
    // The page answers like web/src/utils/nativeDormBridge.ts would: the request arrives as sent.
    runWebTask: async expression => {
      offers.push(vm.runInNewContext(expression, { window: { CPUTimeNativeDorm: request => request } }));
      return '';
    },
    selectTab: (index, destination) => tabs.push([index, destination]),
  });
  return { page, offers, tabs, loads };
}

test('dorm invite links inside the app open the dorm page with their code', () => {
  assert.equal(dorm.dormPagePath('/schedule?dorm=1&code=%20abc234'), '/dorm-schedule?code=ABC234');
  assert.equal(dorm.dormPagePath('/schedule?code=ABC234&dorm=1#top'), '/dorm-schedule?code=ABC234');
  assert.equal(dorm.dormPagePath('/schedule?dorm=1&code=%3Cscript%3E'), '/dorm-schedule');
  assert.equal(dorm.dormPagePath('/schedule?dorm=1'), '/dorm-schedule');
  for (const path of ['/schedule', '/schedule?couple=1&code=ABC234', '/schedule?dorm=0', '/schedule/share/ABCD2345?dorm=1', '/dorm-schedule?code=ABC234']) {
    assert.equal(dorm.dormPagePath(path), '', path);
  }
  assert.equal(dorm.dormSchedulePage(' k7m2qx '), '/dorm-schedule?code=K7M2QX');
});

test('the dorm page gets the term running now and opens under 服务 so Back returns to the timetable', async () => {
  const h = host();
  h.page.openDormSchedule();
  await new Promise(setImmediate);
  assert.deepEqual(h.tabs, [[3, '/dorm-schedule']]);
  assert.equal(h.offers.length, 1);
  assert.equal(h.offers[0].action, 'offer');
  assert.equal(h.offers[0].account, 'acct-a');
  assert.equal(h.offers[0].snapshot.semester, '2026-2027-1');

  // An in-app invite link goes to the dorm page, not the native timetable.
  h.page.handleNativeNavigation('/schedule?dorm=1&code=abc234');
  await new Promise(setImmediate);
  assert.deepEqual(h.tabs.at(-1), [3, '/dorm-schedule?code=ABC234']);
  assert.deepEqual(h.loads, []);
  // Any other timetable link still shows the native timetable.
  h.page.handleNativeNavigation('/schedule?couple=1');
  assert.equal(h.page.selectedTab, 2);
  assert.deepEqual(h.loads, [false]);
});

test('a past term on screen, an unfinished term or a signed-out shell hands nothing over', async () => {
  const past = host({ shown: '2025-2026-2' });
  await past.page.offerDormSchedule();
  assert.equal(past.offers.length, 0);

  const partial = host({ publish: () => { throw new Error('整学期课表还没有加载完，请刷新课表后再试'); } });
  await partial.page.offerDormSchedule();
  assert.equal(partial.offers.length, 0);

  const gated = host();
  gated.page.requiresLogin = true;
  await gated.page.offerDormSchedule();
  gated.page.handleNativeNavigation('/schedule?dorm=1');
  assert.equal(gated.offers.length, 0);
  assert.deepEqual(gated.tabs, []);
});
