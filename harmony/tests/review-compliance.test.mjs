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
  // AppGallery (3.0.9): no 客户端下载 leading to the Android or iOS build inside the Harmony app only.
  assert.equal(api.hidesClientDownloads('CPUWebHarmonyApp/30 CPUTimeNative/1'), true);
  for (const ua of ['CPUWebIOSApp/1 CPUTimeNative/1', 'CPUWebScheduleApp/61 CPUTimeNative/1', 'Chrome', 'HarmonyOS HuaweiBrowser']) {
    assert.equal(api.hidesClientDownloads(ua), false);
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
    assert.equal(api.shouldHideNativeMiniGames(false, null, ua), true);
    assert.equal(api.shouldHideNativeMiniGames(true, '2020240384', ua), true);
    assert.equal(api.shouldHideNativeMiniGames(true, '2020240385', ua), false);
    assert.equal(api.isNativeForumIntranetOnlyAccount('2020240384', ua), true);
    assert.equal(api.isNativeForumIntranetOnlyAccount('2020240385', ua), false);
  }

  const harmonyUa = 'CPUWebHarmonyApp/20 CPUTimeNative/1';
  assert.equal(api.shouldHideHarmonyAssistant(false, null, harmonyUa), true);
  assert.equal(api.shouldHideHarmonyAssistant(true, '2020240384', harmonyUa), true);
  assert.equal(api.shouldHideHarmonyAssistant(true, '2020240385', harmonyUa), false);
  assert.equal(api.shouldHideHarmonyAssistant(false, null, 'CPUWebIOSApp/1 CPUTimeNative/1'), false);
  assert.equal(api.shouldHideHarmonyAssistant(true, '2020240384', 'Chrome'), false);

  assert.equal(api.shouldHideNativeMiniGames(false, null, 'Chrome'), false);
  assert.equal(api.isNativeForumIntranetOnlyAccount('2020240384', 'CPUWebScheduleApp/38'), false);
});

function loadMainRouteGuard({ user = null, hideGame = false, hideAssistant = false, restrictForum = false } = {}) {
  const routerSource = readFileSync(new URL('../../web/src/router/index.ts', import.meta.url), 'utf8');
  const source = routerSource.slice(routerSource.indexOf('router.beforeEach('));
  const messages = [];
  let guard;
  const context = vm.createContext({ module: { exports: {} },
    router: { beforeEach: (callback) => { guard = callback; } },
    window: { location: { replace() {} } }, document: {},
    applyRouteTitle: () => {},
    hidesNativeCommerce: () => false, hidesClientDownloads: () => false, openNativeIosSponsor: () => false, hasHarmonySponsor: () => false, HARMONY_SPONSOR_PATH: '/sponsor/app', isNativeScheduleShell: () => false,
    usesImmediateIosScroll: () => false,
    useAuthStore: () => ({ ready: true, user, token: user ? 'session' : '', canAccessForum: true }),
    useSiteStore: () => ({ loaded: true, features: {}, pathEnabled: () => true }),
    CACHE_FIRST_EDUCATION_ROUTES: new Set(), FEATURE_GATED: {},
    firstRouteValue: (value) => value,
    LEGACY_FILE_COLLECTION_SUBMIT_PREFIX: '/legacy-file-collection/',
    shouldHideNativeMiniGames: () => hideGame,
    shouldHideHarmonyAssistant: () => hideAssistant,
    isNativeForumIntranetOnlyAccount: () => restrictForum,
    ElMessage: { info: (message) => messages.push(message) },
  });
  vm.runInContext(transformSync(source.replaceAll('import.meta.env.DEV', 'false'), {
    loader: 'ts', format: 'cjs', target: 'es2022',
  }).code, context);
  return { guard, messages };
}

function mainRoute(path, name, meta = {}) {
  return { path, fullPath: path, name, meta: { public: true, ...meta }, query: {}, params: {} };
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
  const routerSource = readFileSync(new URL('../../web/src/router/index.ts', import.meta.url), 'utf8');
  const gameRoutes = [
    ['/services/tools/games', 'service-games'],
    ['/services/tools/yaoda-can-fly', 'service-yaoda-can-fly'],
    ['/services/tools/yaoda-can-fly/tomato-egg-noodles', 'service-tomato-egg-noodles'],
    ['/services/tools/yaoda-can-fly/zombie-defense', 'service-zombie-defense'],
    ['/services/tools/yaoda-can-fly/yaoda-nai', 'service-yaoda-nai'],
    ['/services/tools/yaoda-can-fly/greedy-nailong', 'service-greedy-nailong'],
    ['/services/tools/yaoda-can-fly/yaoda-mines', 'service-yaoda-mines'],
  ];
  const { guard } = loadMainRouteGuard({ hideGame: true });
  for (const [path, name] of gameRoutes) {
    const route = routerSource.split('\n').find((line) => line.includes(`name: "${name}"`)) || '';
    assert.match(route, new RegExp(`path: "${path.slice(1)}"`, 'u'), name);
    assert.match(route, /miniGame: true/u, name);
    const result = await guard(mainRoute(path, name, { miniGame: true }));
    assert.equal(result.name, 'services', name);
    assert.equal(result.replace, true, name);
  }
  const open = loadMainRouteGuard({ hideGame: false });
  for (const [path, name] of gameRoutes) {
    assert.notEqual((await open.guard(mainRoute(path, name, { miniGame: true })))?.name, 'services', name);
  }
  assert.notEqual((await guard(mainRoute('/services/tools', 'service-tools')))?.name, 'services');
});

test('mini-game shortcuts are recognised wherever the admin points them', () => {
  const code = buildSync({
    entryPoints: [fileURLToPath(new URL('../../web/src/utils/clientInfo.ts', import.meta.url))],
    bundle: true, write: false, format: 'cjs',
    alias: { '@': fileURLToPath(new URL('../../web/src', import.meta.url)) },
  }).outputFiles[0].text;
  const context = vm.createContext({ module: { exports: {} }, URL, URLSearchParams,
    navigator: { userAgent: 'Chrome', maxTouchPoints: 0 },
    window: { location: { search: '' } }, sessionStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(code, context);
  const { isMiniGameDestination } = context.module.exports;
  for (const url of ['/services/tools/games', '/services/tools/games/', '/services/tools/yaoda-can-fly?game_release=1',
    '/services/tools/yaoda-can-fly/tomato-egg-noodles', 'https://cputime.cn/services/tools/yaoda-can-fly']) {
    assert.equal(isMiniGameDestination(url), true, url);
  }
  for (const url of ['/services/tools', '/services/tools/games-night', '/services/tools/voicehub', '', null]) {
    assert.equal(isMiniGameDestination(url), false, String(url));
  }
});

test('Harmony guests and the restricted account cannot open assistant routes directly', async () => {
  for (const user of [null, { username: '2020240384', role: 'user' }]) {
    const { guard } = loadMainRouteGuard({ user, hideAssistant: true });
    const result = await guard(mainRoute('/search', 'search'));
    assert.equal(result.name, 'services');
    assert.equal(result.replace, true);
    assert.equal(await guard(mainRoute('/search/results', 'site-search')), true);
  }
});

function findFunction(node, name) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node;
  return ts.forEachChild(node, child => findFunction(child, name));
}

// 处理函数可能写在页面的 <script setup> 里，也可能写在页面共用的组合式函数里。
function submitHandler(file, name, globals) {
  const raw = readFileSync(new URL(file, import.meta.url), 'utf8');
  const source = file.endsWith('.vue') ? raw.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1] : raw;
  const parsed = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true);
  const method = findFunction(parsed, name);
  assert.ok(method);
  const context = vm.createContext(globals);
  vm.runInContext(transformSync(`${method.getText(parsed)}; globalThis.submit = ${name};`, { loader: 'ts' }).code, context);
  return context.submit;
}

for (const [file, name] of [
  ['../../web/src/views/Login.vue', 'onSubmit'],
  ['../../web/src/views/Login.vue', 'onDevSubmit'],
  ['../../web/src/views/jwxt/jwxtPage.ts', 'onSubmit'],
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

test('Harmony sponsorship goes through the in-app purchase bridge and never names a payment method or another store', () => {
  const code = buildSync({
    entryPoints: [fileURLToPath(new URL('../../web/src/utils/clientInfo.ts', import.meta.url))],
    bundle: true, write: false, format: 'cjs',
    alias: { '@': fileURLToPath(new URL('../../web/src', import.meta.url)) },
  }).outputFiles[0].text;
  const load = (host) => {
    const context = vm.createContext({ module: { exports: {} }, URLSearchParams,
      navigator: { userAgent: 'Chrome', maxTouchPoints: 0 },
      window: { location: { search: '' }, CPUHarmony: host }, sessionStorage: { getItem: () => null, setItem() {} },
    });
    vm.runInContext(code, context);
    return context.module.exports;
  };
  const harmony = 'CPUWebHarmonyApp/36 CPUWebHarmonyAppVersion/3.4.0';
  // Older Harmony builds have no bridge: every sponsor entry stays hidden there.
  assert.equal(load({ copyText() {} }).hasHarmonySponsor(harmony), false);
  assert.equal(load(undefined).hasStoreSponsor(harmony), false);
  const bridged = load({ iapRequest() {} });
  assert.equal(bridged.hasHarmonySponsor(harmony), true);
  assert.equal(bridged.hasStoreSponsor(harmony), true);
  // The web checkout (易支付) stays hidden in the Harmony app either way.
  assert.equal(bridged.hidesNativeCommerce(harmony), true);
  // The bridge object alone does not turn another client into a Harmony one.
  for (const ua of ['Chrome', 'CPUWebScheduleApp/68 CPUTimeNative/1', 'CPUWebIOSApp/1 CPUTimeNative/1']) {
    assert.equal(bridged.hasHarmonySponsor(ua), false);
  }
  assert.equal(bridged.HARMONY_SPONSOR_PATH, '/sponsor/app');

  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const page = read('../../web/src/views/profile/HarmonySponsor.vue');
  const visible = page.slice(0, page.indexOf('<script')).replace(/<!--[\s\S]*?-->/g, '');
  const scriptStrings = page.slice(page.indexOf('<script'), page.indexOf('<style'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const text of [visible, scriptStrings, read('../../web/src/utils/harmonyIap.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]) {
    assert.doesNotMatch(text, /App Store|应用市场|支付宝|微信|易支付|华为支付|鸿蒙支付|应用内支付|alipay|wxpay/i);
  }
  const profile = read('../../web/src/views/profile/profilePage.ts');
  assert.match(profile, /hasHarmonySponsor\(\)\s*\?\s*"赞助后开通 VIP 并获得 AI 点数，也可以在赞助墙留下一句话。"/);

  const router = read('../../web/src/router/index.ts');
  assert.match(router, /path: "sponsor\/app"[^\n]+HarmonySponsor\.vue/);
  assert.match(router, /if \(hasHarmonySponsor\(\)\) \{[\s\S]{0,200}HARMONY_SPONSOR_PATH, replace: true/);

  // Native side: one proxy method, only on the site's own pages, results sent back by id.
  const bridge = read('../entry/src/main/ets/common/HarmonyBridge.ets');
  const index = read('../entry/src/main/ets/pages/Index.ets');
  assert.match(index, /'iapRequest',/);
  assert.match(index, /setIapChannel\(\(\) => \{[\s\S]{0,120}isAppOrigin\(this\.controller\.getUrl\(\)\)/);
  assert.match(bridge, /!IAP_ACTIONS\.includes\(name\) \|\| !this\.iapGate\?\.\(\)/);
  const iap = read('../entry/src/main/ets/common/HarmonyIap.ets');
  assert.match(iap, /productType: iap\.ProductType\.CONSUMABLE,\s+queryType: iap\.PurchaseQueryType\.UNFINISHED/);
  assert.match(iap, /iap\.IAPErrorCode\.PURCHASE_FINISHED/);
});
