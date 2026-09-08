import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

function startup() {
  const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
  const methods = source.slice(source.indexOf('  private beginStartupWait('), source.indexOf('  private configureScheduleWidget('));
  const timers = new Map(); let id = 0;
  const ctx = vm.createContext({ module: { exports: {} },
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
  });
  vm.runInContext(transformSync(`export class Startup { ${methods} }`, { loader: 'ts', format: 'cjs' }).code, ctx);
  const state = new ctx.module.exports.Startup();
  Object.assign(state, { startupFinished: false, startupTimer: -1, failed: false, loading: true });
  return { state, timers };
}

test('redirects keep one startup wait and later page loads cannot reopen the startup screen', () => {
  const { state, timers } = startup();
  state.beginStartupWait(); state.beginStartupWait(); assert.equal(timers.size, 1);
  state.finishStartup(); assert.equal(state.startupFinished, true); assert.equal(timers.size, 0);
  state.loading = true; state.beginStartupWait();
  assert.equal(state.startupFinished, true); assert.equal(timers.size, 0);
});

test('startup timeout offers failure recovery, and a late successful page cancels that failure', () => {
  const { state, timers } = startup();
  state.beginStartupWait(); [...timers.values()][0]();
  assert.equal(state.failed, true); assert.equal(state.loading, false);
  state.finishStartup(); assert.equal(state.failed, false); assert.equal(state.startupFinished, true);
});

test('early startup policy only suppresses duplicate chrome on trusted main documents', () => {
  const source = readFileSync(new URL('../entry/src/main/ets/common/NativeStartupPolicy.ets', import.meta.url), 'utf8');
  const ctx = vm.createContext({ module: { exports: {} } });
  vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, ctx);
  const script = ctx.module.exports.NATIVE_STARTUP_POLICY;
  const styles = []; const win = {}; win.top = win;
  const doc = { documentElement: { dataset: {} }, head: { appendChild: s => styles.push(s) },
    getElementById: () => styles[0], createElement: () => ({}) };
  const page = { window: win, location: { origin: 'https://cputime.cn' }, document: doc };
  vm.runInNewContext(script, page); vm.runInNewContext(script, page);
  assert.equal(styles.length, 1); assert.match(styles[0].textContent, /#boot-screen/);
  vm.runInNewContext(script, { window: win, location: { origin: 'https://example.com' } });
  vm.runInNewContext(script, { window: { top: win }, location: { origin: 'https://cputime.cn' } });
});
