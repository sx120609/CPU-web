import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
const source = readFileSync(new URL('../bridge/navigation.ts', import.meta.url), 'utf8');
const context = vm.createContext({ module: { exports: {} }, require: () => ({}) });
vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
const { createHarmonyNavigation, parentRoute, localReturnPath } = context.module.exports;

function harness(initial = '/home') {
  const before = [], after = [], replaces = [], scrolls = [];
  let blocked = false, backCount = 0, finishBack;
  const route = value => { const url = new URL(value, 'https://cputime.cn');
    return { fullPath: value, path: url.pathname, query: Object.fromEntries(url.searchParams) }; };
  const host = { history: { state: { back: null } }, scrollY: 0,
    requestAnimationFrame: fn => fn(), scrollTo: (_x, y) => scrolls.push(y) };
  const router = { currentRoute: { value: route(initial) },
    beforeEach: fn => before.push(fn), afterEach: fn => after.push(fn),
    replace: async path => { replaces.push(path); return move(path); },
    back: () => { backCount++; finishBack = () => move(host.history.state.back); },
  };
  function move(path, push = false) {
    before.forEach(fn => fn());
    const previous = router.currentRoute.value, next = route(path);
    if (!blocked) { if (push) host.history.state.back = previous.fullPath; router.currentRoute.value = next; }
    after.forEach(fn => fn(next, previous, blocked ? { type: 'aborted' } : undefined));
    return blocked ? { type: 'aborted' } : undefined;
  }
  const nav = createHarmonyNavigation(router, host);
  return { nav, router, host, replaces, scrolls, push: path => move(path, true),
    path: () => router.currentRoute.value.fullPath, block: value => blocked = value,
    finishBack: () => finishBack(), backCount: () => backCount };
}

test('legacy topic return pushes do not make native back reopen the topic', async () => {
  const h = harness(); h.push('/forum'); h.host.scrollY = 680;
  h.push('/forum/topic/42?from=%2Fforum'); h.push('/forum');
  assert.equal(h.host.history.state.back, '/forum/topic/42?from=%2Fforum');
  assert.equal(h.scrolls.at(-1), 680);
  await h.nav.back(); assert.equal(h.path(), '/home'); assert.equal(h.backCount(), 0);
});

test('returning to search preserves its query and coalesces repeated back taps', async () => {
  const h = harness(); h.push('/search/results?q=药学'); h.push('/forum/topic/42');
  await h.nav.back(); await h.nav.back(); assert.equal(h.backCount(), 1);
  h.finishBack(); assert.equal(h.path(), '/search/results?q=药学');
});

test('tab changes discard another tab history and cancelled navigation preserves the current trail', async () => {
  const h = harness(); h.push('/forum'); h.push('/forum/topic/42');
  await h.nav.openTab('/services'); h.push('/services/tools'); h.push('/services/tools/assessment-form');
  h.host.history.state.back = '/forum/topic/42'; h.block(true);
  await h.nav.back(); assert.equal(h.path(), '/services/tools/assessment-form');
  h.block(false); await h.nav.back(); assert.equal(h.path(), '/services/tools');
  await h.nav.back(); assert.equal(h.path(), '/services'); assert.equal(await h.nav.back(), false);
});

test('forum filter changes stay in one page and explicit return destinations never push history', async () => {
  const h = harness(); h.push('/forum'); h.push('/forum?channel=hot');
  h.push('/forum/topic/42'); h.host.history.state.back = '/other';
  await h.nav.back('/home', '/forum?channel=hot'); assert.equal(h.path(), '/forum?channel=hot');
  await h.nav.back(); assert.equal(h.path(), '/home');
});

test('direct entries across route families have valid parents and unsafe from paths are ignored', async () => {
  const cases = [
    ['/forum/topic/1','/forum'], ['/forum/b/chat','/forum'], ['/post','/forum'], ['/u/1','/forum'],
    ['/profile/privacy','/profile'], ['/profile/verification','/profile'], ['/vip','/profile'], ['/sponsor','/profile'],
    ['/messages/qqbot-reminders','/messages'], ['/coursereview/1','/coursereview'],
    ['/services/tools','/services'], ['/services/tools/assessment-form','/services/tools'],
    ['/services/tools/yaoda-can-fly','/services/tools'], ['/services/tools/manage','/services/tools'],
    ['/services/tools/questionnaires/q','/services/tools'], ['/services/tools/grade-checks/g','/services/tools/grade_check'],
    ['/services/tools/filestore','/services/tools/file_collect'], ['/services/tools/filestore/submit/f','/services/tools/filestore'],
    ['/services/tools/filestore/status/f','/services/tools/filestore'], ['/register','/login'],
  ];
  for (const [path, expected] of cases) {
    assert.equal(parentRoute(path), expected);
    const h = harness(path + '?from=%2F%2Fexample.com'); await h.nav.back();
    assert.equal(h.path(), expected, path);
  }
  for (const path of ['//example.com', '/\\example.com', 'https://example.com', '/home\n']) assert.equal(localReturnPath(path), '');
});
