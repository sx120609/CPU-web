// The bundled 日程 bridge: the live site installs CPUTimeNativeAgenda only for CPUTimeNative/ user
// agents, so the HarmonyOS app brings its own over the same /api/next-sync records.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(`${root}web/package.json`);
const { build } = require('esbuild');

async function load() {
  const out = await build({
    stdin: { contents: "import { installHarmonyAgenda } from './harmony/bridge/agenda'; globalThis.installHarmonyAgenda = installHarmonyAgenda;",
      resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'iife', platform: 'neutral', target: 'es2020',
    alias: { '@': `${root}web/src` },
    plugins: [{ name: 'stubs', setup(builder) {
      builder.onResolve({ filter: /^\.\/adapters$|^vue$|^@\/stores\/(auth|jwxt|site)$|^@\/api\/(jwxt|site|request)$|^\.\/clientInfo$/ },
        () => ({ path: 'stub', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents:
        'export const useAuthStore = () => globalThis.auth; export const useJwxtStore = () => null; export const useSiteStore = () => null;'
        + ' export const watch = () => () => {}; export const jwxtApi = {}; export const isNativeScheduleShell = () => true;'
        + ' export const isIosNextNativeShell = () => true; export const siteApi = {}; export const setSchoolChoice = () => {};'
        + ' export const liveApp = () => null;' }));
    } }],
  });
  new Function(out.outputFiles[0].text)();
}

function server() {
  const records = new Map();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}`);
    const body = init.body ? JSON.parse(init.body) : null;
    let data;
    if ((init.method || 'GET') === 'GET') data = { records: [...records.values()], cursor: 'c1', more: false };
    else {
      for (const record of body.records) records.set(record.id, record);
      data = { applied: body.records.map(({ collection, id }) => ({ collection, id })), newer: [], rejected: [] };
    }
    return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
  };
  return { records, calls };
}

test('lists, saves, ticks and removes 日程 through /api/next-sync for the signed-in user', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  globalThis.document = { cookie: '' };
  globalThis.window = globalThis;
  let changed = 0;
  globalThis.CPUTimeNative = { agendaChanged: () => { changed += 1; } };
  globalThis.auth = { isLoggedIn: true, ready: true, user: { id: 7 }, academicIdentity: 'undergraduate', token: '__cpu_cookie_session__' };
  const api = server();
  await load();
  globalThis.installHarmonyAgenda();

  const empty = await window.CPUTimeNativeAgenda({ action: 'list' });
  assert.equal(empty.authenticated, true);
  assert.deepEqual(empty.items, []);

  const saved = await window.CPUTimeNativeAgenda({ action: 'save', data: { title: '交药理学作业', date: '2026-11-12', start: '', end: '' } });
  assert.equal(saved.saved.title, '交药理学作业');
  assert.equal(saved.items.length, 1);
  assert.ok(api.records.has(saved.saved.id), 'the new item reached the server');
  assert.ok(api.calls.some((call) => call.startsWith('POST /api/next-sync')));

  const ticked = await window.CPUTimeNativeAgenda({ action: 'toggle', id: saved.saved.id, date: '2026-11-12', done: true });
  assert.equal(ticked.items[0].done, true);
  assert.equal(api.records.get(saved.saved.id).data.done, true);

  const removed = await window.CPUTimeNativeAgenda({ action: 'remove', id: saved.saved.id });
  assert.deepEqual(removed.items, []);
  assert.equal(api.records.get(saved.saved.id).deleted, true);
  assert.ok(changed >= 1, 'the app hears that the list changed');
  // The site's own agenda page reads the same local copy.
  assert.ok(store.has('cpu-agenda-v1:7'));

  assert.ok((await window.CPUTimeNativeAgenda({ action: 'parse', text: '明天下午三点组会' })).parsed);

  globalThis.auth = { isLoggedIn: false, ready: true, user: null };
  const guest = await window.CPUTimeNativeAgenda({ action: 'list' });
  assert.equal(guest.authenticated, false);
});

test('the Harmony bridge entry installs it', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(`${root}harmony/bridge/entry.ts`, 'utf8'), /installHarmonyAgenda\(\);/);
  assert.match(readFileSync(`${root}harmony/entry/src/main/resources/rawfile/NativeWebCompatibility.js`, 'utf8'), /CPUTimeNativeAgenda/);
});
