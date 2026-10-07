import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../app/src/main/assets/NativeShellBootstrap.js', import.meta.url), 'utf8')
  .replaceAll('__CPU_APP_ORIGIN__', 'https://cputime.cn');
const compatibility = readFileSync(new URL('../app/src/main/assets/NativeWebCompatibility.js', import.meta.url), 'utf8');
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15) CPUWebScheduleApp/39 CPUWebScheduleAppVersion/4.0.0 CPUTimeNative/1';

function page({ origin = 'https://cputime.cn', ua = ANDROID_UA, port = true, stores, fetch } = {}) {
  const messages = [];
  const listeners = new Map();
  const root = { dataset: {}, attributes: new Set(), toggleAttribute(name, on) { on ? this.attributes.add(name) : this.attributes.delete(name); },
    appendChild(node) { node.isConnected = true; this.children.push(node); }, children: [] };
  const history = { state: null, pushState() {}, replaceState() {} };
  const location = { origin, pathname: '/home', search: '', hash: '' };
  const window = {
    location, history,
    CPUAndroidNativePort: port ? { postMessage: text => messages.push(JSON.parse(text)) } : undefined,
    dispatchEvent() {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    scrollY: 0,
    scrollTo() {},
    requestAnimationFrame: fn => fn(),
  };
  const document = {
    readyState: 'complete', documentElement: root, head: root, body: { dataset: {} }, cookie: '__Host-cpu-csrf=csrf-token',
    createElement: () => ({ isConnected: false, textContent: '' }),
    getElementById: () => (stores ? { __vue_app__: { config: { globalProperties: {
      $pinia: { _s: stores }, $router: stores.router,
    } } } } : null),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
  };
  const context = vm.createContext({
    window, document, location, history, navigator: { userAgent: ua }, console, URL, Error, Event, AbortController,
    setTimeout, clearTimeout, JSON, Promise, Map, Set,
    addEventListener: (name, fn) => listeners.set(name, fn),
    requestAnimationFrame: fn => fn(),
    MutationObserver: class { observe() {} },
    getComputedStyle: () => ({ display: 'none' }),
    fetch: fetch ?? (async () => { throw new Error('unexpected fetch'); }),
  });
  context.window.window = window;
  return { context, window, messages, root, history, location, listeners };
}

const posts = (p, type) => p.messages.filter(m => m.kind === 'post' && m.payload.type === type).map(m => m.payload);

test('bootstrap installs the native bridge and hides the Web bars on the trusted origin', () => {
  const p = page();
  vm.runInContext(bootstrap, p.context);
  const bridge = p.window.CPUTimeNative;
  assert.equal(bridge.platform, 'android');
  assert.equal(p.root.dataset.cpuAndroidNative, '1');
  assert.equal(p.root.dataset.cpuIosNext, '1');
  assert.match(p.root.children[0].textContent, /\.layout-root > \.mobile-tabbar/);
  bridge.ready();
  bridge.navigate('/schedule?refresh=1');
  bridge.authChanged({ account: 'opaque', authenticated: true, ready: true, canAccessAdmin: true });
  bridge.notificationsChanged(3, 1);
  assert.equal(posts(p, 'ready').length, 1);
  assert.deepEqual(posts(p, 'navigate')[0], { type: 'navigate', path: '/schedule?refresh=1' });
  assert.deepEqual(posts(p, 'authChanged')[0], { type: 'authChanged', account: 'opaque', authenticated: true, ready: true, canAccessAdmin: true });
  assert.deepEqual(posts(p, 'notificationsChanged')[0], { type: 'notificationsChanged', unreadCount: 3, directUnreadCount: 1 });
});

test('bootstrap reports SPA routes once and resolves native calls through the same channel', () => {
  const p = page();
  vm.runInContext(bootstrap, p.context);
  assert.deepEqual(posts(p, 'route').map(m => m.path), ['/home']);
  p.location.pathname = '/forum/topic/9';
  p.history.pushState({}, '', '/forum/topic/9');
  p.history.replaceState({}, '', '/forum/topic/9');
  assert.deepEqual(posts(p, 'route').map(m => m.path), ['/home', '/forum/topic/9']);
  assert.equal(p.root.attributes.has('data-cpu-page-navigation'), true);
  p.window.CPUTimeNative.__resolve('n1', '{"ok":true}');
  assert.deepEqual(p.messages.at(-1), { kind: 'resolve', id: 'n1', value: '{"ok":true}' });
});

test('native navigation depth suppresses the router echo of a native tab switch', () => {
  const p = page();
  vm.runInContext(bootstrap, p.context);
  p.window.CPUTimeNative.nativeNavigationDepth = 1;
  assert.equal(p.window.CPUTimeNative.navigate('/schedule'), false);
  assert.equal(posts(p, 'navigate').length, 0);
});

test('bootstrap falls back to the JavaScript interface when message listeners are unavailable', () => {
  const p = page({ port: false });
  const legacy = [];
  p.window.CPUAndroidNative = { post: text => legacy.push(JSON.parse(text)) };
  vm.runInContext(bootstrap, p.context);
  p.window.CPUTimeNative.ready();
  assert.equal(legacy.at(-1).payload.type, 'ready');
});

test('bootstrap does nothing on another origin or in an ordinary browser', () => {
  for (const options of [{ origin: 'https://evil.example' }, { ua: 'Mozilla/5.0 Chrome/130' }]) {
    const p = page(options);
    vm.runInContext(bootstrap, p.context);
    assert.equal(p.window.CPUTimeNative, undefined);
    assert.equal(p.messages.length, 0);
  }
});

function legacyStores() {
  const subscribers = [];
  const auth = { ready: true, isLoggedIn: true, user: { id: 42 }, academicIdentity: 'undergraduate',
    token: '__cpu_cookie_session__', $subscribe: fn => subscribers.push(fn), fetchMe: async () => undefined };
  const jwxt = { token: '__cpu_jwxt_cookie_session__', isLoggedIn: true, hydrate() {},
    ensureSession: async () => true, withSessionRetry: fn => fn(), $subscribe: fn => subscribers.push(fn) };
  const routes = [];
  const router = { currentRoute: { value: { path: '/home', fullPath: '/home', query: {}, meta: {} } },
    push: path => routes.push(path), replace: async path => routes.push(path), back() {}, beforeEach() {}, afterEach() {} };
  const stores = new Map([['auth', auth], ['jwxt', jwxt]]);
  stores.router = router;
  return { stores, auth, routes, subscribers };
}

test('the compatibility bundle serves the schedule bridge on an old Web deployment', async () => {
  const { stores, routes } = legacyStores();
  const requests = [];
  const p = page({ stores, fetch: async (url, options) => {
    requests.push({ url: String(url), options });
    let data;
    if (url.pathname.endsWith('schedule-edits')) data = { edits: { hidden: [], custom: [] } };
    else if (url.pathname.endsWith('calendar')) data = { parsed: null };
    else data = { parsed: { currentSemester: 'fall', currentWeek: '1', semesters: [], weeks: [], scope: 'week',
      cells: [{ day: 1, bigSlot: 1, courses: [{ name: '药理学', weeks: '1-8周(单)', weekList: [] }] }] } };
    return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
  } });
  vm.runInContext(bootstrap, p.context);
  vm.runInContext(compatibility, p.context);
  const result = await p.window.CPUTimeNativeScheduleFetch('fall', '3', false);
  assert.equal(result.auth.authenticated, true);
  assert.equal(result.data.currentWeek, '3');
  assert.deepEqual(Array.from(result.data.cells[0].courses[0].weekList), [1, 3, 5, 7]);
  assert.equal(requests[0].options.headers['X-CPU-Client'], 'android-app');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(typeof p.window.CPUTimeNative.nativeLoginBegin, 'function');
  assert.equal(typeof p.window.CPUTimeNative.refreshAuth, 'function');
  assert.equal(typeof p.window.CPUAndroidEditor, 'function');
  assert.equal(typeof p.window.CPUAndroidBack, 'function');
  p.window.CPUTimeNative.openWebRoute('/profile');
  assert.deepEqual(routes, ['/profile']);
  assert.ok(posts(p, 'ready').length >= 1);
  assert.equal(posts(p, 'header')[0].state.path, '/home');
});

test('the compatibility bundle keeps a newer Web bridge and still adds the native helpers', () => {
  const { stores } = legacyStores();
  const p = page({ stores });
  const modern = () => 'modern';
  vm.runInContext(bootstrap, p.context);
  p.window.CPUTimeNativeScheduleFetch = modern;
  vm.runInContext(compatibility, p.context);
  assert.equal(p.window.CPUTimeNativeScheduleFetch, modern);
  assert.equal(typeof p.window.CPUTimeNative.restoreAcademicSession, 'function');
  assert.ok(posts(p, 'ready').length >= 1);
});

test('the course editor protocol is exposed under the Android name with the Android client header', async () => {
  const { stores } = legacyStores();
  let edits = { hidden: [], custom: [] };
  const writes = [];
  const p = page({ stores, fetch: async (url, options) => {
    if (options.method === 'PUT') { writes.push(options); edits = JSON.parse(options.body).edits; }
    return { ok: true, json: async () => ({ code: 0, data: { edits } }) };
  } });
  vm.runInContext(bootstrap, p.context);
  vm.runInContext(compatibility, p.context);
  const opened = await p.window.CPUAndroidEditor({ action: 'open', semester: 'fall' });
  const saved = await p.window.CPUAndroidEditor({ action: 'save', session: opened.session, cells: [],
    form: { name: '新增课程', teacher: '', location: 'B311', note: '', day: 2, startSlot: 3, endSlot: 4, weekList: [2, 4] } });
  assert.equal(saved.saved, true);
  assert.equal(writes[0].headers['X-CPU-Client'], 'android-app');
  assert.equal(writes[0].headers['X-CSRF-Token'], 'csrf-token');
  assert.equal(edits.custom[0].course.name, '新增课程');
});

test('the course editor accepts the evening twelfth period offered by the native picker', async () => {
  const { stores } = legacyStores();
  let edits = { hidden: [], custom: [] };
  const writes = [];
  const p = page({ stores, fetch: async (url, options) => {
    if (options.method === 'PUT') { writes.push(options); edits = JSON.parse(options.body).edits; }
    return { ok: true, json: async () => ({ code: 0, data: { edits } }) };
  } });
  vm.runInContext(bootstrap, p.context);
  vm.runInContext(compatibility, p.context);
  const form = { name: '晚课', teacher: '', location: '', note: '', day: 7, startSlot: 12, endSlot: 12, weekList: [13, 15] };
  let opened = await p.window.CPUAndroidEditor({ action: 'open', semester: 'fall' });
  const saved = await p.window.CPUAndroidEditor({ action: 'save', session: opened.session, cells: [], form });
  assert.equal(saved.error, undefined);
  assert.equal(saved.saved, true);
  assert.equal(edits.custom[0].day, 7);
  assert.equal(edits.custom[0].course.startSlot, 12);
  assert.equal(edits.custom[0].course.endSlot, 12);
  opened = await p.window.CPUAndroidEditor({ action: 'open', semester: 'fall' });
  const rejected = await p.window.CPUAndroidEditor({ action: 'save', session: opened.session, cells: [],
    form: { ...form, endSlot: 13 } });
  assert.match(rejected.error, /节次/);
  assert.equal(writes.length, 1);
});

test('the course editor saves one item per run of periods and ranks the course in front', async () => {
  const { stores } = legacyStores();
  let edits = { hidden: [], custom: [], priority: { '体育': 2 } };
  const writes = [];
  const p = page({ stores, fetch: async (url, options) => {
    if (options.method === 'PUT') { writes.push(options); edits = JSON.parse(options.body).edits; }
    return { ok: true, json: async () => ({ code: 0, data: { edits } }) };
  } });
  vm.runInContext(bootstrap, p.context);
  vm.runInContext(compatibility, p.context);
  const editor = p.window.CPUAndroidEditor;
  assert.deepEqual({ ...(await editor({ action: 'priority', semester: 'fall' })).priority }, { '体育': 2 });
  let opened = await editor({ action: 'open', semester: 'fall' });
  assert.deepEqual({ ...opened.priority }, { '体育': 2 });
  const form = { name: '  药理  学 ', teacher: '', location: 'A1', note: '', preferred: true,
    arrangements: [{ day: 1, slots: [5, 1, 2], weekList: [3, 1] }, { day: 4, slots: [9], weekList: [2] }] };
  const saved = await editor({ action: 'save', session: opened.session, cells: [], form });
  assert.equal(saved.error, undefined);
  assert.equal(saved.saved, true);
  // Periods that are not consecutive become one existing-format item per run.
  assert.deepEqual(edits.custom.map(item => [item.day, item.course.startSlot, item.course.endSlot, item.course.weekList]),
    [[1, 1, 2, [1, 3]], [1, 5, 5, [1, 3]], [4, 9, 9, [2]]]);
  assert.equal(new Set(edits.custom.map(item => item.id)).size, 3);
  assert.deepEqual(edits.priority, { '体育': 2, '药理 学': 3 });
  assert.deepEqual({ ...saved.priority }, { '体育': 2, '药理 学': 3 });

  // Turning the switch off removes only this course's rank.
  opened = await editor({ action: 'open', semester: 'fall' });
  const lowered = await editor({ action: 'save', session: opened.session, cells: [],
    form: { ...form, preferred: false, arrangements: [{ day: 2, slots: [3, 4], weekList: [1] }] } });
  assert.equal(lowered.saved, true);
  assert.deepEqual(edits.priority, { '体育': 2 });
  assert.equal(edits.custom.length, 4);

  // An action that says nothing about the priority still sends the stored map, so it is never wiped.
  opened = await editor({ action: 'open', semester: 'fall' });
  edits.hidden.push('jwxt|1|1|1|2|旧课|||');
  opened = await editor({ action: 'open', semester: 'fall' });
  await editor({ action: 'restoreHidden', session: opened.session, key: 'jwxt|1|1|1|2|旧课|||' });
  assert.deepEqual(edits, { hidden: [], custom: edits.custom, priority: { '体育': 2 } });

  opened = await editor({ action: 'open', semester: 'fall' });
  const empty = await editor({ action: 'save', session: opened.session, cells: [],
    form: { ...form, arrangements: [form.arrangements[0], { day: 3, slots: [], weekList: [1] }] } });
  assert.equal(empty.error, '上课时间 2：请检查星期和节次范围');
  assert.equal(writes.length, 3);
});

test('hiding or editing a block leaves the rows of the same course in other weeks alone', async () => {
  // JWXT lists one course in the same periods as two rows: weeks 1-5 and weeks 7-16.
  const row = (weeks, weekList) => ({ name: '物理化学', teacher: '张三', location: 'C201', weeks, weekList, startSlot: 3, endSlot: 4 });
  const early = row('1-5周', [1, 2, 3, 4, 5]);
  const cells = [{ day: 2, bigSlot: 2, courses: [early, row('7-16周', [7, 8, 9, 10, 11, 12, 13, 14, 15, 16])] }];
  const original = { day: 2, bigSlot: 2, startSlot: 3, endSlot: 4, course: early };
  for (const action of ['delete', 'save']) {
    const { stores } = legacyStores();
    let edits = { hidden: [], custom: [] };
    const p = page({ stores, fetch: async (url, options) => {
      if (options.method === 'PUT') edits = JSON.parse(options.body).edits;
      return { ok: true, json: async () => ({ code: 0, data: { edits } }) };
    } });
    vm.runInContext(bootstrap, p.context);
    vm.runInContext(compatibility, p.context);
    const opened = await p.window.CPUAndroidEditor({ action: 'open', semester: 'fall' });
    const result = await p.window.CPUAndroidEditor({ action, session: opened.session, original, cells,
      form: { name: '物理化学', teacher: '张三', location: 'C305', note: '',
        arrangements: [{ day: 2, slots: [3, 4], weekList: [1, 2, 3, 4, 5] }] } });
    assert.equal(result.saved, true);
    assert.deepEqual(edits.hidden, ['jwxt|2|2|3|4|物理化学|张三|C201|1-5周']);
    assert.equal(edits.custom.length, action === 'save' ? 1 : 0);
  }
});

test('share codes go through the signed-in session and carry the site nickname', async () => {
  const { stores, auth } = legacyStores();
  auth.user.nickname = ' 阿青 ';
  const requests = [];
  const p = page({ stores, fetch: async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('ZZZZ2222')) return { ok: false, status: 404, json: async () => ({ code: 404, message: '分享课表不存在或已撤销' }) };
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { code: 'ABCD2345' } }) };
  } });
  vm.runInContext(bootstrap, p.context);
  vm.runInContext(compatibility, p.context);
  const shares = p.window.CPUAndroidShares;

  const published = await shares({ action: 'publish', body: { semester: 'fall', schedule: {}, calendar: {} } });
  assert.equal(published.data.code, 'ABCD2345');
  assert.equal(requests[0].url, '/api/schedule-shares');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['X-CSRF-Token'], 'csrf-token');
  assert.equal(requests[0].options.headers['X-CPU-Client'], 'android-app');
  assert.deepEqual(JSON.parse(requests[0].options.body), { semester: 'fall', schedule: {}, calendar: {}, ownerName: '阿青' });

  await shares({ action: 'revoke', code: 'abcd2345' });
  assert.equal(requests[1].url, '/api/schedule-shares/ABCD2345');
  assert.equal(requests[1].options.method, 'DELETE');
  assert.equal(requests[1].options.headers['X-CSRF-Token'], 'csrf-token');

  await shares({ action: 'meta', code: 'ABCD2345' });
  assert.equal(requests[2].url, '/api/schedule-shares/ABCD2345/meta');
  assert.equal(requests[2].options.headers['X-CSRF-Token'], undefined);

  const missing = await shares({ action: 'get', code: 'ZZZZ2222' });
  assert.equal(missing.status, 404);
  assert.equal(missing.error, '分享课表不存在或已撤销');

  // Only a share code reaches the URL.
  const invalid = await shares({ action: 'get', code: '../users/1' });
  assert.equal(invalid.status, 400);
  assert.equal(requests.length, 4);

  // Reading a code needs no account; the user's own codes do.
  auth.isLoggedIn = false;
  assert.equal((await shares({ action: 'mine' })).status, 401);
  assert.equal((await shares({ action: 'publish', body: {} })).status, 401);
  assert.equal((await shares({ action: 'get', code: 'ABCD2345' })).data.code, 'ABCD2345');
});
