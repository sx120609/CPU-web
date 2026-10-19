import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
const source = readFileSync(new URL('../../web/src/components/jwxt/scheduleTheme.ts', import.meta.url), 'utf8');
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
const fields = ['key', 'label', 'accent', 'accentStrong', 'accentPale', 'accentBorder', 'courseBg', 'courseBorder', 'courseText'];
const palettes = Object.values(context.module.exports.scheduleThemePalettes).map(palette =>
  Object.fromEntries(fields.map(key => [key, palette[key]])));
const rows = palettes.map(palette => `    SchedulePalette(${fields.map(key => JSON.stringify(palette[key])).join(', ')}),`);
writeFileSync(new URL('../app/src/main/java/cn/lizmt/cpuweb/schedule/SchedulePalettes.kt', import.meta.url),
  '// Generated from web/src/components/jwxt/scheduleTheme.ts; run android-next/scripts/build-native-theme.mjs.\n' +
  'package cn.lizmt.cpuweb.schedule\n\n' +
  `data class SchedulePalette(\n${fields.map(key => `    val ${key}: String,`).join('\n')}\n)\n\n` +
  `val SCHEDULE_PALETTES: List<SchedulePalette> = listOf(\n${rows.join('\n')}\n)\n`);
