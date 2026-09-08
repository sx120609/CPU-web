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
writeFileSync(new URL('../entry/src/main/ets/schedule/SchedulePalettes.ets', import.meta.url),
  '// Generated from web/src/components/jwxt/scheduleTheme.ts; run build-native-theme.mjs.\n' +
  `export interface SchedulePalette {\n${fields.map(key => `  ${key}: string;`).join('\n')}\n}\n` +
  `export const SCHEDULE_PALETTES: SchedulePalette[] = ${JSON.stringify(palettes, null, 2)};\n`);
