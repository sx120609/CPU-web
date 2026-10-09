import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync, buildSync } = require('esbuild');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function load(source, globals = {}) {
  const context = vm.createContext({ module: { exports: {} }, URL, ...globals });
  vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, context);
  return context.module.exports;
}
const policy = load(read('../../web/src/utils/nativeForumVisibility.ts'));

test('only the selected Harmony account loses community visibility', () => {
  const code = buildSync({
    entryPoints: [fileURLToPath(new URL('../../web/src/utils/clientInfo.ts', import.meta.url))],
    bundle: true, write: false, format: 'cjs',
    alias: { '@': fileURLToPath(new URL('../../web/src', import.meta.url)) },
  }).outputFiles[0].text;
  const context = vm.createContext({ module: { exports: {} }, URLSearchParams,
    window: { location: { search: '' } }, navigator: { userAgent: 'Chrome', maxTouchPoints: 0 },
    sessionStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(code, context);
  const { shouldHideHarmonyForum, isNativeForumIntranetOnlyAccount } = context.module.exports;
  for (const ua of ['CPUWebHarmonyApp/20 CPUTimeNative/1', 'CPUWebHarmonyApp/22']) {
    assert.equal(shouldHideHarmonyForum('2020240384', ua), true);
    assert.equal(shouldHideHarmonyForum(' 2020240384 ', ua), true);
    for (const user of ['2020240385', '', null]) assert.equal(shouldHideHarmonyForum(user, ua), false);
  }
  for (const ua of ['Chrome', 'HuaweiBrowser HarmonyOS', 'CPUWebIOSApp/1 CPUTimeNative/1', 'CPUWebScheduleApp/38']) {
    assert.equal(shouldHideHarmonyForum('2020240384', ua), false);
  }
  assert.equal(isNativeForumIntranetOnlyAccount('2020240384', 'CPUWebIOSApp/1'), true);
});

test('destination policy covers nested, encoded and absolute forum links without hiding service routes', () => {
  for (const path of ['/forum', '/forum/topic/42?from=home', '/post', '/market', '/coursereview/1',
    '/u/7', '/announcements', '/admin?tab=topics', '/community-rules.html',
    'https://cputime.cn/forum/b/general', '/%66orum/topic/3']) {
    assert.equal(policy.isForumDestination(path), true, path);
  }
  for (const path of ['/home/services', '/profile', '/profile/privacy', '/services',
    '/lost-found?item=1', '/messages', '/services/tools/questionnaire', '/forum-other']) {
    assert.equal(policy.isForumDestination(path), false, path);
  }
});

test('Harmony direct entries leave no title or intranet toast while service notifications remain reachable', async () => {
  const source = read('../../web/src/router/index.ts');
  let guard;
  const messages = [];
  const doc = { title: 'existing' };
  load(source.slice(source.indexOf('router.beforeEach(')).replaceAll('import.meta.env.DEV', 'false'), {
    router: { beforeEach: callback => { guard = callback; } }, window: {}, document: doc,
    hidesNativeCommerce: () => false, isNativeScheduleShell: () => false,
    usesImmediateIosScroll: () => false,
    useAuthStore: () => ({ ready: true, forumHidden: true, token: 'session', user: { username: '2020240384' } }),
    useSiteStore: () => ({ loaded: true, features: {} }),
    CACHE_FIRST_EDUCATION_ROUTES: new Set(), FEATURE_GATED: {},
    firstRouteValue: value => value, LEGACY_FILE_COLLECTION_SUBMIT_PREFIX: '/legacy/',
    isNativeForumIntranetOnlyAccount: () => true, shouldHideNativeYaodaCanFly: () => false,
    shouldHideHarmonyAssistant: () => false,
    isForumDestination: policy.isForumDestination, ElMessage: { info: text => messages.push(text) },
  });
  const route = (path, query = {}) => ({ path, fullPath: path, name: path === '/messages' ? 'messages' : 'topic',
    meta: { public: true, title: 'hidden title' }, query, params: {} });
  for (const path of ['/forum', '/post', '/market', '/coursereview/3', '/announcements', '/u/5', '/admin']) {
    assert.equal((await guard(route(path))).name, 'home');
    assert.equal(doc.title, 'existing');
  }
  for (const query of [{ tab: 'private' }, { tab: 'reply' }, { tab: 'like' }, { tab: 'system' }, { forumId: '42' }]) {
    assert.equal((await guard(route('/messages', query))).name, 'messages');
  }
  assert.equal(await guard(route('/messages', { tab: 'service-tool' })), true);
  assert.equal(messages.length, 0);
});

test('community messages, moderation notices and legacy payload links cannot contribute unread details', () => {
  const notices = [
    { id: 1, category: 'reply', link: '/forum/topic/1' },
    { id: 2, category: 'like' },
    { id: 3, category: 'direct-message' },
    { id: 4, category: 'system', payload: { type: 'topic-review' } },
    { id: 5, category: 'service-tool', link: '/services/tools/filestore' },
    { id: 6, category: 'lost-found', link: '/lost-found?item=4' },
    { id: 7, category: 'lost-found', payload: { topicId: 4 } },
    { id: 8, category: 'service-tool', link: 'https://cputime.cn/forum/topic/1' },
  ];
  assert.deepEqual(Array.from(policy.visibleNativeNotices(notices, true), item => item.id), [5, 6]);
  assert.equal(policy.visibleNativeNotices(notices, false), notices);
});

test('service-only home never requests forum summary and removes configured forum services', async () => {
  const calls = [];
  const api = load(read('../../web/src/api/home.ts'), {
    require: name => name.includes('nativeForumVisibility') ? policy : { request: {
      get: async url => { calls.push(url); return [{ url: '/forum', name: 'hidden' }, { url: '/jwxt', name: 'academic' }]; },
    } },
  }).homeApi;
  const summary = await api.summary({}, true);
  assert.deepEqual(calls, ['/services']);
  assert.equal(summary.services.length, 1);
  assert.equal(summary.services[0].url, '/jwxt');
  assert.equal(summary.hotTopics.length + summary.latestTopics.length + summary.announce.length, 0);
  await api.summary({});
  assert.equal(calls.at(-1), '/home/summary');
});

test('message refresh cannot apply an old account response after account switching', async () => {
  const auth = { user: { id: 1 }, forumHidden: false };
  let resolve;
  let options;
  load(read('../../web/src/stores/message.ts'), {
    window: {}, require: name => name === 'pinia' ? { defineStore: (_id, value) => { options = value; } }
      : name.includes('nativeForumVisibility') ? policy
      : name.includes('stores/auth') ? { useAuthStore: () => auth }
      : { messageApi: { list: () => new Promise(done => { resolve = done; }) } },
  });
  const store = { ...options.state(), ...options.actions };
  const pending = store.refresh();
  auth.user = { id: 2 };
  auth.forumHidden = true;
  resolve([{ id: 1, category: 'direct-message' }]);
  await pending;
  assert.equal(store.unreadCount, 0);
  store.setNotices([{ id: 2, category: 'like' }, { id: 3, category: 'lost-found' }]);
  assert.equal(store.unreadCount, 1);
  assert.equal(store.directUnreadCount, 0);
  assert.equal(store.latestDirectNotice, null);
});

test('global smart-post restoration is stopped when switching into the hidden account', () => {
  const auth = { ready: true, user: { id: 42 }, forumHidden: true };
  const watches = [], resumed = [];
  let cleared = 0;
  const source = read('../../web/src/components/forum/SmartPostTaskIndicator.vue')
    .match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1];
  load(source, { window: { matchMedia: () => ({ matches: true }) },
    require: name => name === 'vue' ? {
      computed: fn => ({ get value() { return fn(); } }),
      ref: value => ({ value }),
      watch: (getter, callback, options) => {
        watches.push(() => callback(getter()));
        if (options?.immediate) callback(getter());
      },
    } : name === 'vue-router' ? { useRouter: () => ({}) }
      : name.endsWith('/auth') ? { useAuthStore: () => auth }
      : { useSmartPostJobStore: () => ({ resume: id => resumed.push(id), clearForLogout: () => cleared++ }) },
  });
  assert.equal(cleared, 1);
  assert.equal(resumed.length, 0);
  auth.forumHidden = false;
  watches[0]();
  assert.deepEqual(resumed, [42]);
  auth.forumHidden = true;
  watches[0]();
  assert.equal(cleared, 2);
});
