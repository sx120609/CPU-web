import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
function compile(path, dependencies = {}) {
  const context = vm.createContext({ module: { exports: {} }, require: name => {
    if (!(name in dependencies)) throw Error(`Unexpected import: ${name}`);
    return dependencies[name];
  } });
  vm.runInContext(transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}
const web = compile('../../web/src/components/jwxt/scheduleTheme.ts');
const palettes = compile('../entry/src/main/ets/schedule/SchedulePalettes.ets');
const native = compile('../entry/src/main/ets/schedule/ScheduleVisuals.ets', { './SchedulePalettes': palettes });
const design = compile('../entry/src/main/ets/schedule/ScheduleDesign.ets', { './ScheduleVisuals': native });
const layout = compile('../entry/src/main/ets/schedule/ScheduleLayout.ets', { './ScheduleVisuals': native });

function contrast(first, second) {
  const luminance = hex => {
    const values = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a,b) => b-a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('Harmony widget names and location text remain readable in every theme and appearance', () => {
  for (const { key } of palettes.SCHEDULE_PALETTES) {
    for (const dark of [false, true]) {
      for (let index = 0; index < 48; index++) {
        const tone = design.harmonyCourseColor(`课程${index}`, key, dark);
        for (const role of ['text', 'accent']) {
          assert.ok(contrast(tone[role], tone.fill) >= 4.5, `${key} ${dark} ${role}: ${JSON.stringify(tone)}`);
        }
      }
    }
  }
});

function composite(hex, base) {
  if (hex.length === 7) return hex;
  const alpha = parseInt(hex.slice(1, 3), 16) / 255;
  const fg = hex.slice(3).match(/../g).map(v => parseInt(v, 16));
  const bg = base.slice(1).match(/../g).map(v => parseInt(v, 16));
  return '#' + fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

test('native timetable cards preserve text contrast over cells in both appearances', () => {
  for (const { key } of palettes.SCHEDULE_PALETTES) {
    for (const dark of [false, true]) {
      for (const name of ['药物设计学', '药物化学', '药物分析', '天然药物化学实验', '人工智能药学', '药剂学',
        ...Array.from({ length: 360 }, (_, index) => `课程${index}`)]) {
        const tone = native.scheduleCardTone(name, key, dark);
        const cell = composite(layout.scheduleCell(dark), dark ? '#101C19' : '#EDF4FF');
        for (const fill of [tone.top, tone.bottom]) {
          const background = composite(fill, cell);
          assert.ok(contrast(composite(tone.text, background), background) >= 4.5, `${key} ${dark}: ${JSON.stringify(tone)}`);
        }
      }
    }
  }
});

test('timetable card backgrounds and borders use the web algorithm rather than a separate hue table', () => {
  for (const { key } of palettes.SCHEDULE_PALETTES) {
    for (const dark of [false, true]) {
      for (const name of ['药物设计学', '药物化学', '药物分析', '  药物  化学  ']) {
        const card = native.scheduleCardTone(name, key, dark);
        const webTone = native.scheduleCourseTone(name, key, dark);
        for (const role of ['bottom', 'border']) assert.equal(card[role], webTone[role]);
        if (!dark || key !== 'color-glass') assert.equal(card.top, webTone.top);
      }
    }
  }
});

test('phone grid breakpoints preserve row sizes and merged-course positions in short and tall viewports', () => {
  for (const width of [320, 360, 375, 390, 391, 430, 760, 761]) {
    for (const height of [320, 540, 900]) {
      for (const count of [11, 12, 14]) {
        const metrics = layout.scheduleGridMetrics(width, height, count);
        assert.equal(metrics.axis, width <= 390 ? 36 : width <= 760 ? 38 : 44);
        assert.equal(metrics.gap, width <= 390 ? 2 : width <= 760 ? 4 : 5);
        assert.equal(metrics.header, 36);
        // Course names stay readable, and four characters fit on a line from 360 vp up.
        assert.ok(metrics.nameSize >= 9 && metrics.nameSize <= 11 && metrics.locationSize === metrics.nameSize - 1);
        const column = (Math.min(width, 720) - 2 * metrics.inset - metrics.axis - 7 * metrics.gap) / 7;
        // Leave a couple of vp spare: a one-line name that only just fits is cut to an ellipsis.
        if (width >= 360) assert.ok(4 * metrics.nameSize <= column - 6);
        assert.ok(metrics.weekRow >= (width <= 390 ? 38 : width <= 760 ? 42 : 48));
        assert.ok(metrics.dayRow >= (width <= 390 ? 48 : width <= 760 ? 52 : 58));
        for (const [row, gap] of [[metrics.weekRow, metrics.gap], [metrics.dayRow, metrics.dayGap]]) {
          const stride = row + gap;
          const gridHeight = count * stride - gap;
          for (const [start, end] of [[1, 1], [1, 4], [5, 8], [9, count], [count, count]]) {
            const top = (start - 1) * stride + 1;
            const courseHeight = (end - start + 1) * stride - gap - 2;
            assert.ok(courseHeight > 0);
            assert.ok(top + courseHeight < gridHeight);
            assert.ok(Math.abs(top + courseHeight - (end * stride - gap - 1)) < 1e-8);
          }
        }
      }
    }
  }
});

// Resolve web HSL using chroma/sector conversion, independently of the native channel function.
function color(css) {
  if (css.startsWith('#')) return css.toLowerCase();
  const [h, s0, l0, alpha = 1] = css.match(/[\d.]+/g).map(Number);
  const s = s0 / 100, l = l0 / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const rgb = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][Math.floor(h / 60)];
  return '#' + [alpha, ...rgb.map(v => v + m)].map(v => Math.round(v * 255).toString(16).padStart(2,'0')).join('');
}

test('all native palette tokens are generated from the website', () => {
  for (const palette of palettes.SCHEDULE_PALETTES) {
    const original = web.scheduleThemePalettes[palette.key];
    for (const [key, value] of Object.entries(palette)) assert.equal(value, original[key], `${palette.key}.${key}`);
  }
  assert.equal(palettes.SCHEDULE_PALETTES.length, 9);
});

test('native course fills, borders, and text match the web color algorithm in both appearances', () => {
  for (const name of ['药物设计学','药物化学','药物分析','天然药物化学实验','人工智能药学','药剂学','  药物  化学  ', ...Array.from({length:32},(_,i)=>`课程${i}`)]) {
    for (const dark of [false,true]) {
      const expected = web.getColorGlassCourseTone(name,dark);
      const actual = native.scheduleCourseTone(name,'color-glass',dark);
      const background = expected.bg.startsWith('linear-gradient') ? expected.bg.match(/hsla\([^)]+\)/g) : [expected.bg,expected.bg];
      assert.equal(actual.top, color(background[0]), `${name} top`);
      assert.equal(actual.bottom, color(background[1]), `${name} bottom`);
      assert.equal(actual.border, color(expected.border), `${name} border`);
      assert.equal(actual.text, color(expected.text), `${name} text`);
    }
  }
});
