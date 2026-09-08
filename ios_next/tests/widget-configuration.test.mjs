import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const swift = (await readFile(new URL('../CpuTime/CpuTime/HybridWebView.swift', import.meta.url), 'utf8'))
  .replace(/\r\n/g, '\n');
const script = swift.split('let script = """\n        const cookie')[1].split('"""')[0];
const run = new (Object.getPrototypeOf(async function () {}).constructor)('document', 'fetch', 'theme', 'const cookie' + script);

test('widget configuration uses same-origin cookies, CSRF and selected theme', async () => {
  let request;
  const payload = await run({ cookie: '__Host-cpu-csrf=a%2Fb; cpu-csrf=legacy' }, async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => ({ code: 0, data: { endpoint: 'https://cputime.cn/api/widget?token=test' } }) };
  }, 'violet');
  assert.equal(request.url, '/api/jwxt/schedule-widget-tokens');
  assert.equal(request.credentials, 'same-origin');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['X-CSRF-Token'], 'a/b');
  assert.equal(request.headers['X-CPU-Auth-Mode'], 'cookie');
  assert.deepEqual(JSON.parse(payload), { endpoint: 'https://cputime.cn/api/widget?token=test', theme: 'violet' });
});

test('widget configuration rejects expired auth and server errors', async () => {
  for (const [ok, code] of [[false, 401], [true, 500]]) {
    await assert.rejects(run({ cookie: '' }, async () => ({ ok, json: async () => ({ code, message: '请重新登录' }) }), 'green'), /请重新登录/);
  }
});
