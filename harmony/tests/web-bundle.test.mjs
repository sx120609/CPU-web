import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../entry/src/main/resources/rawfile/NativeWebCompatibility.js', import.meta.url), 'utf8');
function legacyPage() {
  const subscribers = [];
  const auth = { ready: true, isLoggedIn: true, user: { id: 42 }, academicIdentity: 'undergraduate',
    token: '__cpu_cookie_session__', $subscribe: fn => subscribers.push(fn) };
  const jwxt = { token: '__cpu_jwxt_cookie_session__', isLoggedIn: true, hydrate() {},
    ensureSession: async () => true, withSessionRetry: fn => fn(), $subscribe: fn => subscribers.push(fn) };
  const stores = new Map([['auth', auth], ['jwxt', jwxt]]);
  const routes = [];
  const requests = [];
  let notifications = 0;
  const window = { CPUTimeNative: { ready() {}, authChanged() { notifications++; } }, dispatchEvent() {} };
  const context = vm.createContext({ window, Error, URL, AbortController, setTimeout, clearTimeout,
    navigator: { userAgent: 'CPUWebHarmonyApp/19 CPUWebHarmonyAppVersion/2.1.0' }, location: { origin: 'https://cputime.cn' },
    document: { getElementById: () => ({ __vue_app__: { config: { globalProperties: {
      $pinia: { _s: stores }, $router: { push: path => routes.push(path) },
    } } } }) },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      let data;
      if (url.pathname.endsWith('schedule-edits')) data = { edits: { hidden: [], custom: [] } };
      else if (url.pathname.endsWith('calendar')) data = { parsed: null };
      else data = { parsed: { currentSemester: 'fall', currentWeek: '1', semesters: [], weeks: [],
        cells: [{ day: 1, bigSlot: 1, courses: [{ name: '药理学', weeks: '1-8周(单)', weekList: [] }] }] } };
      return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
    },
  });
  return { context, window, auth, stores, subscribers, requests, routes, notifications: () => notifications };
}
test('bundled bridge works on a legacy page without a deployed native bridge', async () => {
  const page = legacyPage();
  vm.runInContext(script, page.context);
  const result = await page.window.CPUTimeNativeScheduleFetch('fall', '3', true);
  assert.equal(result.auth.authenticated, true);
  assert.equal(result.data.currentWeek, '3');
  assert.deepEqual(Array.from(result.data.cells[0].courses[0].weekList), [1, 3, 5, 7]);
  assert.equal(page.requests[0].options.credentials, 'same-origin');
  assert.equal(page.requests[0].options.headers['X-CPU-Client'], 'harmony-app');
  assert.equal(page.requests[0].options.headers['X-Jwxt-Token'], undefined);
  page.window.CPUTimeNative.openWebRoute('/profile');
  assert.deepEqual(page.routes, ['/profile']);
  page.auth.user = null;
  page.subscribers.forEach(fn => fn());
  assert.equal(page.notifications(), 1);
});
test('bundled bridge preserves a newer Web implementation', () => {
  const page = legacyPage();
  const modern = () => 'modern';
  page.window.CPUTimeNativeScheduleFetch = modern;
  vm.runInContext(script, page.context);
  assert.equal(page.window.CPUTimeNativeScheduleFetch, modern);
  assert.equal(page.subscribers.length, 0);
});
test('ordinary browser UA does not install a native bridge', () => {
  const page = legacyPage();
  page.context.navigator.userAgent = 'Mobile Safari';
  vm.runInContext(script, page.context);
  assert.equal(page.window.CPUTimeNativeScheduleFetch, undefined);
});
test('guest without an academic store sees login state instead of a read failure', async () => {
  const page = legacyPage();
  page.stores.delete('jwxt');
  page.auth.user = null;
  page.auth.isLoggedIn = false;
  vm.runInContext(script, page.context);
  const result = await page.window.CPUTimeNativeScheduleFetch();
  assert.equal(result.auth.authenticated, false);
  assert.equal(result.error, undefined);
  assert.equal(page.requests.length, 0);
});
