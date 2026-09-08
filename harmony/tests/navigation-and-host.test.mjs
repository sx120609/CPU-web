import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
function compile(path) {
  const context=vm.createContext({module:{exports:{}}});
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
test('cold deep links queue until the native host exists; cleared hosts never receive events',()=>{
  const host=compile('../entry/src/main/ets/schedule/NativeScheduleHost.ets'); const routes=[];
  const callbacks={onNavigate:path=>routes.push(path)};
  host.requestNativeScheduleOpen(); assert.equal(routes.length,0);
  host.setNativeScheduleHostCallbacks(callbacks); assert.equal(routes.length,1); assert.match(routes[0],/refresh=1/);
  host.requestNativeScheduleOpen(); assert.equal(routes.length,2);
  host.clearNativeScheduleHostCallbacks(); host.requestNativeScheduleOpen(); assert.equal(routes.length,2);
  host.setNativeScheduleHostCallbacks(callbacks); assert.equal(routes.length,3);
});
