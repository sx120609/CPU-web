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
});

function submitHandler(file, name, globals) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1];
  const parsed = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true);
  const method = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(method);
  const context = vm.createContext(globals);
  vm.runInContext(transformSync(`${method.getText(parsed)}; globalThis.submit = ${name};`, { loader: 'ts' }).code, context);
  return context.submit;
}

for (const [file, name] of [
  ['../../web/src/views/Login.vue', 'onSubmit'],
  ['../../web/src/views/Login.vue', 'onDevSubmit'],
  ['../../web/src/views/jwxt/Index.vue', 'onSubmit'],
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
