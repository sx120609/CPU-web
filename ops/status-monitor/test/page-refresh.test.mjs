import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { REFRESH_SCRIPT } from '../src/page-refresh.mjs';
import { renderPage, CONTENT_SECURITY_POLICY } from '../src/page.mjs';
import { createHash } from 'node:crypto';
import { buildView } from '../src/view.mjs';
import { createState } from '../src/state.mjs';
import { normalizeConfig } from '../src/config.mjs';
import raw from '../eo/site-config.mjs';

function harness({ pending = false } = {}) {
  let now = 0, nextId = 0, requests = [], timers = new Map(), deferred = [];
  const listeners = {};
  const node = attrs => ({ hidden: true, textContent: '', getAttribute: key => attrs[key],
    addEventListener: (name, fn) => { listeners[name] = fn; },
    replaceWith: fresh => { nodes.status = fresh; } });
  const nodes = { status: node({ 'data-refresh': '60', 'data-updated': '更新于初始时间' }),
    stale: node({}), 'refresh-controls': node({}), 'refresh-note': node({}), 'resume-refresh': node({}) };
  const document = { hidden: false, title: '', getElementById: key => nodes[key],
    addEventListener: (name, fn) => { listeners[name] = fn; } };
  const fetch = (_url, options) => {
    requests.push({ at: now, signal: options.signal });
    if (pending) return new Promise(resolve => deferred.push(resolve));
    return Promise.resolve({ ok: true, text: async () => 'new page' });
  };
  class DOMParser { parseFromString() { return { title: 'updated',
    getElementById: () => node({ 'data-refresh': '60', 'data-updated': '更新于最新时间' }) }; } }
  function timer(fn, delay, repeat = false) { const id = ++nextId; timers.set(id, { fn, at: now + delay, delay, repeat }); return id; }
  vm.runInNewContext(REFRESH_SCRIPT, { document, window: { fetch, DOMParser, AbortController }, fetch, DOMParser, AbortController,
    location: { pathname: '/' }, Date: { now: () => now },
    setTimeout: (fn, delay) => timer(fn, delay), setInterval: (fn, delay) => timer(fn, delay, true),
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id) });
  async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  async function advance(ms) {
    const target = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, t] = next; now = t.at;
      if (t.repeat) t.at += t.delay; else timers.delete(id);
      t.fn(); await flush();
    }
    now = target; await flush();
  }
  return { document, nodes, requests, listeners, advance, flush, deferred };
}

test('page replacement does not reset five-minute budget; no requests after expiry', async () => {
  const h = harness(); await h.advance(60000);
  assert.equal(h.requests.length, 1); assert.equal(h.nodes.status.getAttribute('data-updated'), '更新于最新时间');
  await h.advance(240000); assert.equal(h.nodes['resume-refresh'].hidden, false);
  assert.match(h.nodes['refresh-note'].textContent, /已暂停.*最新时间/);
  await h.advance(600000); assert.equal(h.requests.length, 4);
});
test('hidden and later visible tabs cannot restart an expired budget', async () => {
  const h = harness(); h.document.hidden = true;
  await h.advance(360000); assert.equal(h.requests.length, 0);
  h.document.hidden = false; h.listeners.visibilitychange(); await h.flush();
  assert.equal(h.requests.length, 0); assert.equal(h.nodes['resume-refresh'].hidden, false);
});
test('only explicit resume starts a fresh five-minute budget and then pauses again', async () => {
  const h = harness(); await h.advance(300000);
  h.listeners.click(); await h.flush(); assert.equal(h.requests.length, 5);
  await h.advance(60000); assert.equal(h.requests.length, 6);
  await h.advance(300000); h.listeners.visibilitychange(); await h.flush();
  assert.equal(h.requests.length, 9); assert.equal(h.nodes['resume-refresh'].hidden, false);
});
test('expiry aborts an in-flight fetch and ignores its late response', async () => {
  const h = harness({ pending: true }); await h.advance(60000);
  h.listeners.visibilitychange(); assert.equal(h.requests.length, 1);
  await h.advance(240000); assert.equal(h.requests[0].signal.aborted, true);
  h.deferred[0]({ ok: true, text: async () => 'late' }); await h.flush();
  assert.equal(h.nodes.status.getAttribute('data-updated'), '更新于初始时间');
  assert.equal(h.nodes.stale.hidden, true);
});
test('render includes accessible pause controls, preserves CSP, and has no noscript auto reload', () => {
  const html = renderPage(buildView(createState(), normalizeConfig(raw), Date.now()));
  assert.match(html, /id="refresh-note" role="status" aria-atomic="true"/);
  assert.match(html, /id="resume-refresh" type="button" hidden>继续刷新/);
  assert.match(html, /data-updated="/); assert.doesNotMatch(html, /http-equiv="refresh"/);
  assert.match(html, /0 次采样/);
  assert.doesNotMatch(html, /近 90 天是展示范围|60 \/ 120 秒交替探测/);
  assert.ok(CONTENT_SECURITY_POLICY.includes(createHash('sha256').update(REFRESH_SCRIPT).digest('base64')));
});
