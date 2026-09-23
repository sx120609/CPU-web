import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync, buildSync } = require('esbuild');
const ts = require('typescript');

function loadModule(source, globals = {}) {
  const context = vm.createContext({ module: { exports: {} }, ...globals });
  vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}

test('navigation preserves large system insets and reserves the whole bar plus content gap', () => {
  const source = readFileSync(new URL('../entry/src/main/ets/common/NativeNavigationLayout.ets', import.meta.url), 'utf8');
  const layout = loadModule(source);
  for (const system of [0, 8, 28, 34, 48, 96, NaN, -10]) {
    const inset = layout.nativeNavigationBottomInset(system);
    assert.ok(inset >= 28);
    if (Number.isFinite(system)) assert.ok(inset >= system);
    assert.equal(layout.nativeNavigationClearance(system), inset + layout.NATIVE_TAB_BAR_HEIGHT + 8);
  }
});

test('commerce is hidden in iOS and Harmony shells but retained in ordinary browsers and Android', () => {
  const code = buildSync({
    entryPoints: [fileURLToPath(new URL('../../web/src/utils/clientInfo.ts', import.meta.url))],
    bundle: true, write: false, format: 'cjs',
    alias: { '@': fileURLToPath(new URL('../../web/src', import.meta.url)) },
  }).outputFiles[0].text;
  const context = vm.createContext({ module: { exports: {} }, URLSearchParams,
    navigator: { userAgent: 'Chrome', maxTouchPoints: 0 },
    window: { location: { search: '' } }, sessionStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(code, context);
  const api = context.module.exports;
  for (const ua of ['CPUWebIOSApp/1 CPUTimeNative/1', 'CPUWebHarmonyApp/20 CPUTimeNative/1']) {
    assert.equal(api.hidesNativeCommerce(ua), true);
  }
  for (const ua of ['Chrome', 'CPUWebScheduleApp/38', 'iPhone Safari', 'HarmonyOS HuaweiBrowser']) {
    assert.equal(api.hidesNativeCommerce(ua), false);
  }
});

test('iOS and Harmony Web shells apply the account-specific forum and game policy', () => {
  const code = buildSync({
    entryPoints: [fileURLToPath(new URL('../../web/src/utils/clientInfo.ts', import.meta.url))],
    bundle: true, write: false, format: 'cjs',
    alias: { '@': fileURLToPath(new URL('../../web/src', import.meta.url)) },
  }).outputFiles[0].text;
  const context = vm.createContext({ module: { exports: {} }, URLSearchParams,
    navigator: { userAgent: 'Chrome', maxTouchPoints: 0 },
    window: { location: { search: '' } }, sessionStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(code, context);
  const api = context.module.exports;
  const nativeUas = ['CPUWebIOSApp/1 CPUTimeNative/1', 'CPUWebHarmonyApp/20 CPUTimeNative/1'];

  for (const ua of nativeUas) {
    assert.equal(api.shouldHideNativeYaodaCanFly(false, null, ua), true);
    assert.equal(api.shouldHideNativeYaodaCanFly(true, '2020240384', ua), true);
    assert.equal(api.shouldHideNativeYaodaCanFly(true, '2020240385', ua), false);
    assert.equal(api.isNativeForumIntranetOnlyAccount('2020240384', ua), true);
    assert.equal(api.isNativeForumIntranetOnlyAccount('2020240385', ua), false);
  }

  assert.equal(api.shouldHideNativeYaodaCanFly(false, null, 'Chrome'), false);
  assert.equal(api.isNativeForumIntranetOnlyAccount('2020240384', 'CPUWebScheduleApp/38'), false);
});

function loadMainRouteGuard({ user = null, hideGame = false, restrictForum = false } = {}) {
  const routerSource = readFileSync(new URL('../../web/src/router/index.ts', import.meta.url), 'utf8');
  const source = routerSource.slice(routerSource.indexOf('router.beforeEach('));
  const messages = [];
  let guard;
  const context = vm.createContext({ module: { exports: {} },
    router: { beforeEach: (callback) => { guard = callback; } },
    window: { location: { replace() {} } }, document: {},
    hidesNativeCommerce: () => false, isNativeScheduleShell: () => false,
    usesImmediateIosScroll: () => false,
    useAuthStore: () => ({ ready: true, user, token: user ? 'session' : '', canAccessForum: true }),
    useSiteStore: () => ({ loaded: true, features: {} }),
    CACHE_FIRST_EDUCATION_ROUTES: new Set(), FEATURE_GATED: {},
    firstRouteValue: (value) => value,
    LEGACY_FILE_COLLECTION_SUBMIT_PREFIX: '/legacy-file-collection/',
    shouldHideNativeYaodaCanFly: () => hideGame,
    isNativeForumIntranetOnlyAccount: () => restrictForum,
    ElMessage: { info: (message) => messages.push(message) },
  });
  vm.runInContext(transformSync(source.replaceAll('import.meta.env.DEV', 'false'), {
    loader: 'ts', format: 'cjs', target: 'es2022',
  }).code, context);
  return { guard, messages };
}

function mainRoute(path, name) {
  return { path, fullPath: path, name, meta: { public: true }, query: {}, params: {} };
}

test('the native intranet-only account is stopped at every forum route family with the required message', async () => {
  const { guard, messages } = loadMainRouteGuard({
    user: { username: '2020240384', role: 'user' }, restrictForum: true,
  });
  for (const [path, name] of [
    ['/forum', 'forum'], ['/forum/topic/42', 'topic'], ['/market', 'market'],
    ['/post', 'post'], ['/coursereview/42', 'course'],
  ]) {
    assert.equal((await guard(mainRoute(path, name))).name, 'home');
  }
  assert.deepEqual(messages, Array(5).fill('该功能仅限连接内网使用'));
});

test('hidden native game routes cannot be opened directly', async () => {
  const { guard } = loadMainRouteGuard({ hideGame: true });
  const result = await guard(mainRoute('/services/tools/yaoda-can-fly', 'service-yaoda-can-fly'));
  assert.equal(result.name, 'services');
  assert.equal(result.replace, true);
});

function submitHandler(file, name, globals) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true);
  const method = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(method);
  const context = vm.createContext(globals);
  vm.runInContext(transformSync(`${method.getText(parsed)}; globalThis.submit = ${name};`, { loader: 'ts' }).code, context);
  return context.submit;
}

for (const [file, name] of [
  ['../../web/src/views/Login.vue', 'onSubmit'],
  ['../../web/src/views/Login.vue', 'onDevSubmit'],
  ['../../web/src/views/jwxt/Index.vue', 'onSubmit'],
]) {
  test(`${file} ${name}: unchecked consent prevents even programmatic submission`, async () => {
    const warnings = [];
    const accepted = { value: false };
    let accesses = 0;
    const busy = new Proxy({}, { get() { accesses++; return true; } });
    const submit = submitHandler(file, name, { privacyAccepted: accepted,
      ElMessage: { warning: value => warnings.push(value) }, auth: busy, jwxt: busy, dev: busy,
    });
    await submit();
    assert.equal(warnings.length, 1);
    assert.equal(accesses, 0);
    accepted.value = true;
    await submit();
    assert.ok(accesses > 0);
    assert.equal(warnings.length, 1);
  });
}
