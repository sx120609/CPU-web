import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// An in-memory sandbox with the same shape as the ArkWeb data the emulator shows.
function sandbox(files) {
  const tree = new Map(Object.entries(files));
  const children = path => [...new Set([...tree.keys()]
    .filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1).split('/')[0]))];
  const isDirectory = path => [...tree.keys()].some(key => key.startsWith(path + '/'));
  const fs = {
    listFileSync(path) {
      if (!isDirectory(path)) throw new Error('ENOENT ' + path);
      return children(path);
    },
    lstatSync(path) {
      if (tree.has(path)) return { isDirectory: () => false, isFile: () => true, size: tree.get(path) };
      if (isDirectory(path)) return { isDirectory: () => true, isFile: () => false, size: 0 };
      throw new Error('ENOENT ' + path);
    },
    unlinkSync(path) { if (!tree.delete(path)) throw new Error('ENOENT ' + path); },
    rmdirSync(path) { for (const key of [...tree.keys()]) if (key.startsWith(path + '/')) tree.delete(key); },
  };
  const context = vm.createContext({ module: { exports: {} }, require: () => fs, JSON, Array, Math });
  vm.runInContext(transformSync(read('../entry/src/main/ets/common/StorageCleaner.ets'), { loader: 'ts', format: 'cjs' }).code, context);
  return { cleaner: context.module.exports, tree };
}

const BASE = '/data/storage/el2/base';
const directories = {
  cacheDir: BASE + '/cache',
  tempDirs: [BASE + '/temp', BASE + '/haps/entry/temp', BASE + '/haps/entry/cache'],
  dataDirs: [BASE, '/data/storage/el2/database'],
};
const files = () => ({
  [BASE + '/cache/web/Cache/Cache_Data/f_000001']: 4000,
  [BASE + '/cache/web/Code Cache/js/index']: 1000,
  [BASE + '/cache/web/Local Storage/leveldb/000003.log']: 700,
  [BASE + '/cache/web/Service Worker/CacheStorage/abc/1']: 9000,
  [BASE + '/cache/web/IndexedDB/origin/1.ldb']: 300,
  [BASE + '/cache/rawheap/dump.bin']: 50,
  [BASE + '/temp/share.png']: 200,
  [BASE + '/haps/entry/cache/image_file_cache/a.jpg']: 600,
  [BASE + '/haps/entry/files/native-schedule-cache.json']: 80,
  [BASE + '/files/schedule-background-1.jpg']: 900,
  '/data/storage/el2/database/entry/rdb/widget.db': 40,
});

test('network counts only the HTTP caches that removeCache clears', () => {
  const { cleaner } = sandbox(files());
  const usage = JSON.parse(cleaner.storageUsageJson(directories));
  assert.deepEqual(usage.categories, [{ id: 'network', bytes: 5000 }, { id: 'temp', bytes: 850 }]);
  assert.equal(usage.totalBytes, 4000 + 1000 + 700 + 9000 + 300 + 50 + 200 + 600 + 80 + 900 + 40);
});

test('clearing temporary files never touches the Web data, the timetable cache or user files', () => {
  const { cleaner, tree } = sandbox(files());
  cleaner.clearTemporaryFiles(directories);
  const left = [...tree.keys()].sort();
  assert.deepEqual(left, [
    '/data/storage/el2/database/entry/rdb/widget.db',
    BASE + '/cache/web/Cache/Cache_Data/f_000001',
    BASE + '/cache/web/Code Cache/js/index',
    BASE + '/cache/web/IndexedDB/origin/1.ldb',
    BASE + '/cache/web/Local Storage/leveldb/000003.log',
    BASE + '/cache/web/Service Worker/CacheStorage/abc/1',
    BASE + '/files/schedule-background-1.jpg',
    BASE + '/haps/entry/files/native-schedule-cache.json',
  ].sort());
  assert.deepEqual(JSON.parse(cleaner.storageUsageJson(directories)).categories[1], { id: 'temp', bytes: 0 });
});

test('missing directories count as empty and odd arguments select nothing', () => {
  const { cleaner } = sandbox({ [BASE + '/files/a']: 1 });
  assert.equal(cleaner.directorySize(BASE + '/cache/web/Cache'), 0);
  assert.deepEqual(JSON.parse(cleaner.storageUsageJson(directories)).categories, [{ id: 'network', bytes: 0 }, { id: 'temp', bytes: 0 }]);
  assert.deepEqual([...cleaner.parseStorageCategories('["network","temp"]')], ['network', 'temp']);
  assert.deepEqual([...cleaner.parseStorageCategories('["network",3,null]')], ['network']);
  for (const raw of ['cookies', '{"network":true}', '', undefined]) assert.deepEqual([...cleaner.parseStorageCategories(raw)], [], String(raw));
});

test('the Web page reaches the storage bridge through the registered proxy methods', () => {
  const index = read('../entry/src/main/ets/pages/Index.ets');
  const bridge = read('../entry/src/main/ets/common/HarmonyBridge.ets');
  const methods = index.slice(index.indexOf('private bridgeMethods()'), index.indexOf('private shouldOpenExternal('));
  assert.match(methods, /'getStorageUsage'/);
  assert.match(methods, /'clearStorage'/);
  assert.match(index, /setWebCacheClearer\(\(\) => this\.controller\.removeCache\(true\)\)/);
  const proxy = bridge.slice(bridge.indexOf('export class HarmonyJavaScriptProxy'));
  assert.match(proxy, /getStorageUsage\(\): Promise<string>/);
  assert.match(proxy, /clearStorage\(categories: string\): Promise<string>/);
  // The Web directory holds the login and offline data; only removeCache may shrink it.
  assert.doesNotMatch(read('../entry/src/main/ets/common/StorageCleaner.ets'), /removeAllCookies|deleteAllData|clearDirectory\([^)]*WEB_DIRECTORY \+/);
});
