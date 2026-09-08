import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
const source = readFileSync(new URL('../../web/src/utils/imageViewer.ts', import.meta.url), 'utf8');

function harness(accepted = true) {
  const native = []; const web = [];
  class Viewer {
    constructor(options) { web.push(options); }
    on() {} init() {} close() {}
  }
  const context = vm.createContext({ module: { exports: {} }, URL, document: {},
    window: { location: { href: 'https://cputime.cn/home', origin: 'https://cputime.cn' },
      CPUHarmony: { previewImages: payload => { native.push(JSON.parse(payload)); return accepted; } } },
    require: () => Viewer,
  });
  vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
  return { api: context.module.exports, native, web };
}
const images = [{ src: '/uploads/one.jpg', title: '第一张', width: 200, height: 100 },
  { src: 'https://img.cputime.cn/two.jpg', title: '第二张', width: 100, height: 200 }];

test('Harmony gallery passes absolute images and the selected index to the native viewer', async () => {
  const h = harness(); assert.equal(h.api.openImageGallery(images, 1), true);
  await new Promise(setImmediate);
  assert.equal(h.native.length, 1); assert.equal(h.web.length, 0);
  assert.equal(h.native[0].images[0].url, 'https://cputime.cn/uploads/one.jpg');
  assert.equal(h.native[0].index, 1); assert.equal(h.native[0].images[1].title, '第二张');
});

test('native rejection and custom download callbacks retain the web viewer', async () => {
  const rejected = harness(false); rejected.api.openImageGallery(images);
  const custom = harness(); custom.api.openImageGallery(images, 0, { onDownload() {} });
  await new Promise(setImmediate);
  assert.equal(rejected.web.length, 1); assert.equal(custom.web.length, 1);
  assert.equal(custom.native.length, 0);
});
