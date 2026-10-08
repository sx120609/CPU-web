import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
function compile(path, globals = {}) {
  const context=vm.createContext({module:{exports:{}}, ...globals});
  vm.runInContext(transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,context);
  return context.module.exports;
}
test('only the actual HTTPS app origin is allowed inside the privileged Web instance',()=>{
  const config=compile('../entry/src/main/ets/common/AppConfig.ets');
  for(const url of ['https://cputime.cn/home','https://cputime.cn:443/schedule']) assert.equal(config.isAppOrigin(url),true,url);
  for(const url of ['http://cputime.cn','https://cputime.cn:8443','https://cputime.cn:password@attacker.invalid','https://cputime.cn.attacker.invalid','https://pay.kaipay.cn']) assert.equal(config.isAppOrigin(url),false,url);
  assert.equal(config.destinationUrlForDeepLink('cpuweb://profile'),'');
  assert.match(config.destinationUrlForDeepLink('cpuweb://schedule?widgetWeek=2'),/week=current.*widgetWeek=2/);
});

test('Harmony identity preserves the website header without disabling its native schedule bridge',()=>{
  const config=compile('../entry/src/main/ets/common/AppConfig.ets');
  const client=compile('../../web/src/utils/clientInfo.ts',{
    require: id => id.endsWith('android.json') ? {versionCode:1,versionName:'test',fileName:'test.apk'} : {},
    window:{location:{search:''},sessionStorage:{getItem:()=>null}},URLSearchParams,
  });
  assert.equal(client.isHarmonyNativeApp(config.USER_AGENT_SUFFIX),true);
  assert.equal(client.isIosNextNativeShell(config.USER_AGENT_SUFFIX),false);
  assert.equal(client.isFlutterNativeShell(config.USER_AGENT_SUFFIX),false);
});

test('window enters edge-to-edge mode before mounting and tracks changing system safe areas',async()=>{
  const storage=new Map(); const events=new Map(); const loads=[];
  let bottom=98; let finishLayout;
  const ready=new Promise(resolve=>finishLayout=resolve);
  const mainWindow={setWindowLayoutFullScreen:async enabled=>{assert.equal(enabled,true);await ready;},
    getWindowAvoidArea:type=>({topRect:{height:type===0?137:0},bottomRect:{height:type===4?bottom:0}}),
    on:(event,callback)=>events.set(event,callback),off:event=>events.delete(event)};
  const Ability=compile('../entry/src/main/ets/entryability/EntryAbility.ets',{
    AppStorage:{setOrCreate:(key,value)=>storage.set(key,value)},
    require:id=>id==='@ohos.app.ability.UIAbility'?class {}:id==='@ohos.window'?{AvoidAreaType:{TYPE_SYSTEM:0,TYPE_NAVIGATION_INDICATOR:4}}:{},
  }).default;
  const ability=new Ability();
  ability.onWindowStageCreate({getMainWindow:async()=>mainWindow,loadContent:path=>loads.push(path)});
  await new Promise(setImmediate); assert.equal(loads.length,0);
  finishLayout(); await new Promise(setImmediate);
  assert.deepEqual(loads,['pages/Index']); assert.equal(storage.get('systemTopInsetPx'),137);
  assert.equal(storage.get('systemBottomInsetPx'),98);
  bottom=0; events.get('avoidAreaChange')(); assert.equal(storage.get('systemBottomInsetPx'),0);
  ability.onWindowStageDestroy(); assert.equal(events.size,0);
});
test('cold deep links queue until the native host exists; cleared hosts never receive events',()=>{
  const host=compile('../entry/src/main/ets/schedule/NativeScheduleHost.ets'); const routes=[];
  const callbacks={onNavigate:path=>routes.push(path)};
  host.requestNativeScheduleOpen(); assert.equal(routes.length,0);
  host.setNativeScheduleHostCallbacks(callbacks); assert.equal(routes.length,1); assert.equal(routes[0],'/schedule?source=deeplink');
  host.requestNativeScheduleOpen(); assert.equal(routes.length,2);
  host.clearNativeScheduleHostCallbacks(); host.requestNativeScheduleOpen(); assert.equal(routes.length,2);
  host.setNativeScheduleHostCallbacks(callbacks); assert.equal(routes.length,3);
});

test('web proxy preserves account scope through the native host for cache isolation', () => {
  const host = compile('../entry/src/main/ets/schedule/NativeScheduleHost.ets');
  const received = [];
  host.setNativeScheduleHostCallbacks({ onAuthChanged: scope => received.push(scope) });
  const bridge = compile('../entry/src/main/ets/common/HarmonyBridge.ets', {
    require: id => id.endsWith('NativeScheduleHost') ? host : {},
  });
  const proxy = new bridge.HarmonyJavaScriptProxy();
  proxy.authChanged('user-1:undergraduate'); proxy.authChanged('user-2:graduate'); proxy.authChanged();
  assert.deepEqual(received, ['user-1:undergraduate', 'user-2:graduate', '']);
});

test('tab handoff keeps the schedule visible until the destination paints and ignores stale completions', async () => {
  const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
  const methods = source.slice(source.indexOf('  private selectTab('), source.indexOf('  private configureScheduleWidget('));
  const timers = new Map(); let timerId = 0;
  const ctx = vm.createContext({module:{exports:{}}, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id)});
  vm.runInContext(transformSync('export class Navigation {' + methods + '}', {loader:'ts',format:'cjs'}).code, ctx);
  const nav = new ctx.module.exports.Navigation();
  const frames = []; const routes = []; const navigations = [];
  Object.assign(nav, {navigationRevision:0,pendingWebNavigation:0,selectedTab:2,nativeScheduleVisible:true,scheduleMounted:true,
    scheduleStore:{load(){}},controller:{runJavaScript:async script => {
      vm.runInNewContext(script, {window:{CPUTimeNative:{openWebRoute:path=>{routes.push(path);return new Promise(resolve=>navigations.push(resolve));}},CPUHarmony:{navigationReady:revision=>nav.finishWebNavigation(revision)}},
        requestAnimationFrame:callback=>frames.push(callback)});
    }}});
  nav.selectTab(0); assert.equal(nav.nativeScheduleVisible, true); assert.deepEqual(routes, ['/home']);
  navigations.shift()(); await new Promise(setImmediate);
  frames.shift()(); assert.equal(nav.nativeScheduleVisible, true);
  frames.shift()(); assert.equal(nav.nativeScheduleVisible, false);
  [...timers.values()].forEach(fn => fn());
  assert.equal(nav.scheduleLayerVisible, false);
  nav.selectTab(2); assert.equal(nav.nativeScheduleVisible, true);
  assert.equal(nav.scheduleLayerVisible, true);
  nav.selectTab(1); nav.selectTab(2);
  navigations.shift()(); await new Promise(setImmediate); frames.shift()(); frames.shift()();
  assert.equal(nav.selectedTab, 2); assert.equal(nav.nativeScheduleVisible, true);
  [...timers.values()].forEach(fn => fn());
  assert.equal(nav.scheduleLayerVisible, true);
});

test('the native header and tabs still work on a page outside the site app (药苑之声)', async () => {
  const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
  const methods = source.slice(source.indexOf('  private handleHeaderAction('), source.indexOf('  private applyAppearance('));
  let menu = null; let picked = 0;
  const ctx = vm.createContext({ module: { exports: {} }, promptAction: {
    showToast() {}, showActionMenu: options => { menu = options; return Promise.resolve({ index: picked }); } } });
  vm.runInContext(transformSync('export class Header {' + methods + '}', { loader: 'ts', format: 'cjs' }).code, ctx);
  const header = new ctx.module.exports.Header();
  const selected = []; let refreshed = 0;
  Object.assign(header, { selectedTab: 3, selectTab: (index, destination) => selected.push([index, destination]) });
  const run = async (action, page) => {
    header.controller = { refresh: () => { refreshed += 1; }, runJavaScript: async script => String(vm.runInNewContext(script, page)) };
    header.handleHeaderAction(action);
    await new Promise(setImmediate); await new Promise(setImmediate);
  };
  const outside = state => {
    const page = { assigned: [], backs: 0 };
    page.location = { assign: path => page.assigned.push(path) };
    page.window = { history: { state, back: () => { page.backs += 1; } } };
    return page;
  };

  // The site's own app keeps handling everything itself.
  const calls = [];
  await run('more', { window: { CPUHarmonyHeaderAction: (action, root) => calls.push([action, root]) } });
  assert.deepEqual(calls, [['more', '/services']]); assert.equal(menu, null);

  // First page of the outside app: back leaves to the tab's root.
  let page = outside(null); await run('back', page);
  assert.deepEqual(page.assigned, ['/services']); assert.equal(page.backs, 0);
  // Deeper inside it: back steps through its own history.
  page = outside({ back: '/voicehub/' }); await run('back', page);
  assert.deepEqual(page.assigned, []); assert.equal(page.backs, 1);
  page = outside(null); await run('messages', page); assert.deepEqual(page.assigned, ['/messages']);
  page = outside(null); await run('login', page); assert.deepEqual(page.assigned, ['/login']);

  // 更多 has no site drawer to open there, so the shell shows its own menu.
  picked = 1; page = outside(null); await run('more', page);
  assert.equal(menu.buttons.map(button => button.text).join('|'), '刷新页面|返回服务|消息|回到首页');
  assert.deepEqual(selected, [[3, '/services']]);
  picked = 0; await run('more', outside(null)); assert.equal(refreshed, 1);
  picked = 3; await run('more', outside(null)); assert.deepEqual(selected.at(-1), [0, undefined]);
  header.handleHeaderAction('home'); assert.deepEqual(selected.at(-1), [0, undefined]);

  // A tab tapped there loads the site route, because the page has no site router to push to.
  const start = source.indexOf('bridge.openWebRoute = path => {');
  const body = source.slice(start, source.indexOf('window.CPUTimeNative = bridge;', start));
  const routes = []; const loaded = [];
  const openWith = app => {
    const bridge = {};
    vm.runInNewContext(body, { bridge, document: { getElementById: () => app }, location: { assign: path => loaded.push(path) } });
    return bridge.openWebRoute;
  };
  openWith({ __vue_app__: { config: { globalProperties: { $router: { push: path => routes.push(path) } } } } })('/profile');
  assert.deepEqual(routes, ['/profile']); assert.deepEqual(loaded, []);
  const pending = openWith(null)('/profile');
  assert.deepEqual(loaded, ['/profile']); assert.ok(pending instanceof Promise || typeof pending?.then === 'function');
});
