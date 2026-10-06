import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const loginSource = readFileSync(new URL('../entry/src/main/ets/common/NativeLoginGate.ets', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../entry/src/main/ets/schedule/NativeSchedulePage.ets', import.meta.url), 'utf8');
const tabBarSource = readFileSync(new URL('../entry/src/main/ets/common/NativeTabBar.ets', import.meta.url), 'utf8');

test('Harmony shell gates guest state with the same Web auth bridge used by iOS', () => {
  assert.match(indexSource, /requiresLogin/);
  assert.match(indexSource, /nativeLoginBegin/);
  assert.match(indexSource, /nativeSsoLogin/);
  assert.match(indexSource, /nativeAccountLogin/);
  assert.match(indexSource, /NativeLoginGate/);
  assert.match(indexSource, /Older deployed Web bundles can install the timetable bridge/);
  assert.match(indexSource, /typeof bridge\.nativeLoginBegin !== 'function'/);
  assert.match(indexSource, /auth\.ssoBegin\(\{ silent: true \}\)/);
  assert.match(indexSource, /nativeLoginResult/);
  assert.match(indexSource, /window\.CPUHarmony\?\.nativeLoginResult\?\./);
  assert.match(indexSource, /let decoded = JSON\.parse\(String\(raw \|\| '\{\}'\)\)/);
  assert.match(indexSource, /typeof decoded === 'string'/);
  assert.match(indexSource, /decoded = JSON\.parse\(decoded\)/);
  assert.match(loginSource, /privacyAccepted/);
  assert.match(loginSource, /InputType\.Password/);
  assert.match(loginSource, /LongPressGesture/);
  assert.match(loginSource, /bridgeWarmupRetries/);
  assert.match(loginSource, /prepareSchoolLogin\(true\)/);
  assert.match(loginSource, /shouldRetryBridgeWarmup/);
});

test('Harmony daily schedule keeps a dedicated seven-day pager and external date strip', () => {
  assert.match(pageSource, /private dayController: SwiperController/);
  assert.match(pageSource, /private dayPreview\(day: number\)/);
  assert.match(pageSource, /showDayStrip: false/);
  assert.match(pageSource, /this\.dayController\.changeIndex/);
  assert.match(pageSource, /this\.store\.selectDay\(index \+ 1\)/);
  assert.match(pageSource, /\.width\('100%'\)\.clip\(true\)\.margin\(\{ bottom: this\.bottomClearance \}\)/);
});

test('Harmony Web shell adopts the stable document scroll contract', () => {
  assert.match(indexSource, /html\[data-cpu-harmony-native\] body/);
  assert.match(indexSource, /#app \{ height: auto; min-height: 100%; overflow: visible; \}/);
});

test('Harmony bottom navigation renders every tab instead of clipping a percentage-width tab bar', () => {
  const bottomNavigation = indexSource.slice(indexSource.indexOf('private bottomNavigation()'), indexSource.indexOf('private bottomBarInset()'));
  assert.match(tabBarSource, /this\.item\(4, '我的'/);
  assert.match(bottomNavigation, /NativeTabBar\(/);
  assert.doesNotMatch(bottomNavigation, /constraintSize/);
});
