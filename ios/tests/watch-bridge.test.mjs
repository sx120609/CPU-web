import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from '../../web/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const result = await build({ entryPoints: [`${root}ios/bridge/envelope.ts`], bundle: true, format: 'esm', platform: 'node', write: false, alias: { '@': `${root}web/src` } });
const { scheduleEnvelope } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const add = (days) => new Date(Date.UTC(2025, 11, 29 + days)).toISOString().slice(0, 10);
function sample(weeks = '1-3周') {
  return {
    version: 1, fetchedAt: Date.parse('2026-01-05T00:00:00Z'), completeSemester: true,
    auth: { authenticated: true, token: 'never-forward-this' },
    calendar: { weeks: [1, 2, 3].map(week => ({ week, days: Array.from({ length: 7 }, (_, day) => add((week - 1) * 7 + day)) })) },
    data: { currentSemester: 'fixture-semester', currentWeek: '2', cells: [{ day: 1, bigSlot: 1, courses: [{ name: '测试课', weeks, weekList: [], cookie: 'private' }] }] },
  };
}

test('normalizes continuous, odd, even, discrete and mixed week clauses with shared rules', async () => {
  for (const [text, expected] of [['1-3周', [1, 2, 3]], ['1-3周(单)', [1, 3]], ['1-3周(双)', [2]], ['1、3周', [1, 3]], ['1-2周(双),3周', [2, 3]]]) {
    assert.deepEqual((await scheduleEnvelope(sample(text))).courses[0].weeks, expected);
  }
});

test('allowlist excludes credentials and keeps empty metadata with authoritative periods', async () => {
  const value = await scheduleEnvelope(sample());
  assert.equal(value.courses[0].teacher, null); assert.equal(value.courses[0].room, null);
  assert.equal(value.courses[0].startTime, '08:00'); assert.equal(value.courses[0].endTime, '09:40');
  assert.deepEqual(value.periods.slice(0, 2), [
    { number: 1, startTime: '08:00', endTime: '08:45' },
    { number: 2, startTime: '08:55', endTime: '09:40' },
  ]);
  assert.equal(value.timezone, 'Asia/Shanghai'); assert.equal(value.currentWeek, 2);
  assert.equal(JSON.stringify(value).includes('never-forward-this'), false);
  assert.equal(JSON.stringify(value).includes('private'), false);
});

test('stable identities merge duplicate rules without duplicate courses', async () => {
  const input = sample('1周'); input.data.cells[0].courses.push({ name: '测试课', weeks: '3周', weekList: [] });
  const value = await scheduleEnvelope(input);
  assert.equal(value.courses.length, 1); assert.deepEqual(value.courses[0].weeks, [1, 3]);
  assert.equal(value.courses[0].id, (await scheduleEnvelope(input)).courses[0].id);
});

test('week-only sources explicitly bound coverage and never claim future weeks are empty', async () => {
  const input = sample(); input.completeSemester = false;
  const value = await scheduleEnvelope(input);
  assert.deepEqual(value.coveredWeeks, [2]); assert.deepEqual(value.courses[0].weeks, [2]);
});

test('missing calendar, mismatched semester and unsupported source version fail closed', async () => {
  for (const change of [input => input.calendar = null, input => input.calendar.currentSemester = 'other', input => input.version = 2,
    input => input.calendar.weeks[1].days = input.calendar.weeks[0].days, input => input.auth.authenticated = false]) {
    const input = sample(); change(input); await assert.rejects(scheduleEnvelope(input));
  }
});

test('source timestamp survives serialization and stale historical semester has no current week', async () => {
  const input = sample(); input.fetchedAt = Date.parse('2026-02-05T00:00:00Z');
  const value = await scheduleEnvelope(input);
  assert.equal(value.generatedAt, input.fetchedAt); assert.equal(value.currentWeek, 0);
  assert.equal(value.semester.startDate, '2025-12-29');
});

const { readFile } = await import('node:fs/promises');
const { default: vm } = await import('node:vm');
const shipped = await readFile(new URL('../cpuweb/Resources/WatchScheduleBridge.js', import.meta.url), 'utf8');
function legacyContext() {
  const messages = [];
  const requests = [];
  const subscribers = [];
  let resolve;
  const published = new Promise(done => { resolve = done; });
  const auth = { ready: true, isLoggedIn: true, user: { id: 42 }, academicIdentity: 'undergraduate',
    token: '__cpu_cookie_session__', $subscribe: fn => subscribers.push(fn) };
  const jwxt = { token: '__cpu_jwxt_cookie_session__', isLoggedIn: true, hydrate() {},
    ensureSession: async () => jwxt.isLoggedIn, withSessionRetry: fn => fn(), $subscribe: fn => subscribers.push(fn) };
  const window = { webkit: { messageHandlers: { cpuIOS: { postMessage: value => { messages.push(value); resolve(value); } } } } };
  class XHR { open() {} addEventListener() {} }
  const context = vm.createContext({ window, URL, crypto, TextEncoder, Uint8Array, AbortController, Error,
    XMLHttpRequest: XHR, addEventListener() {}, location: { origin: 'https://cputime.cn', href: 'https://cputime.cn/schedule' },
    setTimeout: (fn, ms) => setTimeout(fn, ms === 400 ? 0 : ms), clearTimeout,
    document: { getElementById: () => ({ __vue_app__: { config: { globalProperties: { $pinia: { _s: new Map([['auth', auth], ['jwxt', jwxt]]) } } } } }) },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      const input = sample();
      const data = url.pathname.endsWith('schedule-edits') ? { edits: { hidden: [], custom: [] } }
        : url.pathname.endsWith('calendar') ? { parsed: input.calendar }
          : { parsed: { ...input.data, scope: 'semester', weeks: [1, 2, 3].map(value => ({ value: String(value) })) } };
      return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
    },
  });
  return { context, window, auth, jwxt, requests, messages, published };
}

test('shipped bundle reads authenticated structured data without enabling the ios_next shell', async () => {
  const page = legacyContext(); vm.runInContext(shipped, page.context);
  const message = await page.published;
  assert.equal(message.action, 'watchSchedule'); assert.equal(message.version, 1);
  const value = JSON.parse(message.payload);
  assert.equal(value.courses[0].name, '测试课'); assert.deepEqual(value.coveredWeeks, [1, 2, 3]);
  assert.equal(value.periods.length, 11);
  assert.equal(page.window.CPUTimeNative, undefined); assert.equal(page.window.CPUTimeNativeScheduleFetch, undefined);
  assert.equal(page.requests[0].options.credentials, 'same-origin');
  assert.equal(JSON.stringify(page.messages).includes('__cpu_cookie_session__'), false);
});

test('shipped bundle reports login requirement without requesting academic records', async () => {
  const page = legacyContext(); page.jwxt.isLoggedIn = false;
  vm.runInContext(shipped, page.context);
  const message = await page.published;
  assert.equal(message.status, 'loginRequired'); assert.equal(page.requests.length, 0);
});
