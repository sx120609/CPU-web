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
  const ctx = vm.createContext({module:{exports:{}}});
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
  nav.selectTab(2); assert.equal(nav.nativeScheduleVisible, true);
  nav.selectTab(1); nav.selectTab(2);
  navigations.shift()(); await new Promise(setImmediate); frames.shift()(); frames.shift()();
  assert.equal(nav.selectedTab, 2); assert.equal(nav.nativeScheduleVisible, true);
});
