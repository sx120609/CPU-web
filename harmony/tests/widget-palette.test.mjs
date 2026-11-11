import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
function compile(path) {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}
const palette = compile('../entry/src/main/ets/common/ScheduleWidgetPalette.ets');
// 小组件按风格拆开后，配色在 ScheduleWidgetStyle.swift 里。
const swift = readFileSync(new URL('../../ios_next/CpuTime/CPUWebWidgets/ScheduleWidgetStyle.swift', import.meta.url), 'utf8');
const resources = folder => Object.fromEntries(JSON.parse(readFileSync(
  new URL(`../entry/src/main/resources/${folder}/element/color.json`, import.meta.url), 'utf8')).color.map(item => [item.name, item.value]));

// 把 Swift 的 `Color(red: 232 / 255, green: 91 / 255, blue: 1)` 读成 #E85B4B。
function swiftColors(source) {
  return [...source.matchAll(/Color\(red: ([^,]+), green: ([^,]+), blue: ([^)]+)\)/g)].map(match => '#' + match.slice(1, 4)
    .map(part => Math.round(part.includes('/') ? Number(part.split('/')[0]) : Number(part) * 255))
    .map(value => value.toString(16).padStart(2, '0').toUpperCase()).join(''));
}
// 以及 `(232, 91, 75)` 这样的 0–255 三元组；`dark ? (…) : (…)` 只取冒号后面的浅色值。
const hex = parts => '#' + parts.map(value => Number(value).toString(16).padStart(2, '0').toUpperCase()).join('');
const swiftTriples = source => [...source.matchAll(/\((\d+), (\d+), (\d+)\)/g)].map(match => hex(match.slice(1, 4)));
const swiftLightTriples = source => [...source.matchAll(/dark \? \([^)]*\) : \((\d+), (\d+), (\d+)\)/g)].map(match => hex(match.slice(1, 4)));
const widgetPalette = swift.slice(swift.indexOf('enum WidgetPalette'));
const section = (start, end) => widgetPalette.slice(widgetPalette.indexOf(start), widgetPalette.indexOf(end, widgetPalette.indexOf(start)));
const themeOrder = source => [...source.matchAll(/case \.(\w+):/g)].map(match => match[1] === 'colorGlass' ? 'color-glass' : match[1]);

// iOS 的散列：码点逐个 hash * 31 + 码点，保留低 31 位（Swift 64 位 Int 不会溢出），用 BigInt 独立算一遍。
function iosIndex(name) {
  let hash = 0n;
  for (const character of name) hash = (hash * 31n + BigInt(character.codePointAt(0))) & 0x7fffffffn;
  return Number(hash % 6n);
}

test('widget palette values are the ones in the iOS WidgetPalette', () => {
  assert.deepEqual([...palette.COLOR_GLASS_ACCENTS], swiftTriples(section('colorGlassAccents: ', '\n    ]')));
  assert.deepEqual([...palette.COLOR_GLASS_TINTS], swiftColors(section('colorGlassTints', '\n    ]')));
  const accents = section('static func accent(for theme', 'static func accent(for course');
  const accentThemes = themeOrder(accents);
  assert.deepEqual([...accentThemes].sort(), [...palette.WIDGET_THEMES].sort());
  assert.equal(swiftLightTriples(accents).length, accentThemes.length);
  swiftLightTriples(accents).forEach((color, index) => assert.equal(palette.widgetThemeAccent(accentThemes[index]), color, accentThemes[index]));
  const tints = section('guard theme != .colorGlass', 'private static func index');
  const tintThemes = themeOrder(tints).filter(theme => theme !== 'color-glass');
  swiftColors(tints).forEach((color, index) => assert.equal(palette.widgetThemeTint(tintThemes[index]), color, tintThemes[index]));
  const [dark, light] = swiftColors(section('static func background', 'static func tint'));
  assert.equal(resources('base').widget_surface, light);
  assert.equal(resources('dark').widget_surface, dark);
});

test('course colour index is the iOS hash, including names outside the BMP', () => {
  const names = ['药剂学', '药物分析', '免疫学', '人工智能药学', '药理学', '天然药物化学实验', '天然药物化学', '𠀀化学', 'Organic 化学 II',
    '课程'.repeat(40), ...Array.from({ length: 200 }, (_, index) => `课程${index}`)];
  for (const name of names) assert.equal(palette.widgetCourseColorIndex(name), iosIndex(name), name);
  assert.equal(palette.widgetCourseAccent('药剂学', 'color-glass'), '#4A78F2');
  assert.equal(palette.widgetCourseAccent('药剂学', 'rose'), '#E11D48');
  assert.equal(palette.widgetCourseTint('药剂学', 'color-glass', true), '#2E4A78F2');
  assert.equal(palette.normalizedWidgetTheme(' Rose '), 'rose');
  assert.equal(palette.normalizedWidgetTheme('purple'), 'color-glass');
});

test('card tint resources follow iOS: light tints per course or theme, dark is the accent at 18%', () => {
  const light = resources('base');
  const dark = resources('dark');
  palette.COLOR_GLASS_ACCENTS.forEach((accent, index) => {
    assert.equal(light[`widget_tint_glass_${index}`], palette.COLOR_GLASS_TINTS[index]);
    assert.equal(dark[`widget_tint_glass_${index}`], `#2E${accent.slice(1)}`);
  });
  for (const theme of palette.WIDGET_THEMES.filter(theme => theme !== 'color-glass')) {
    assert.equal(light[`widget_tint_${theme}`], palette.widgetThemeTint(theme));
    assert.equal(dark[`widget_tint_${theme}`], `#2E${palette.widgetThemeAccent(theme).slice(1)}`);
  }
  // 两套资源名字一一对应，卡片用到的每个颜色在深浅色下都有定义。
  const card = readFileSync(new URL('../entry/src/main/ets/schedulewidget/ScheduleCardView.ets', import.meta.url), 'utf8');
  for (const [, name] of card.matchAll(/\$r\('app\.color\.(\w+)'\)/g)) {
    assert.ok(name in light, `base ${name}`); assert.ok(name in dark, `dark ${name}`);
  }
});
