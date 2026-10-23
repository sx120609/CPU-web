import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/views/services/campus3d/app.js', import.meta.url), 'utf8');
const code = app.slice(app.indexOf('const LOCK_EL ='), app.indexOf("on(document, 'pointerlockchange'"));
function harness(request) {
  const state = { focus: 0, hud: 0, toasts: [], requests: [], exits: 0 };
  const root = { pointerLockElement: null };
  const canvas = {
    getRootNode: () => root,
    focus: () => state.focus++,
    requestPointerLock: (...args) => { state.requests.push(args); return request(canvas, root, ...args); },
  };
  const ctx = vm.createContext({
    renderer: { domElement: canvas }, mode: 'walk', DISPOSED: false,
    WALK: { noLock: false, locked: false, keys: new Set(['KeyW']), zoomOn: true },
    document: { exitPointerLock: () => { state.exits++; root.pointerLockElement = null; } },
    performance: { now: () => 1000 }, walkAudioWake() {}, walkHud: () => state.hud++,
    toast: message => state.toasts.push(message),
    $: () => ({ classList: { toggle() {} }, hidden: true }),
  });
  vm.runInContext(code, ctx);
  return { ctx, state, canvas, root, lock: () => vm.runInContext('walkLock()', ctx), error: () => vm.runInContext('walkLockError()', ctx), change: () => vm.runInContext('walkLockChange()', ctx), unlock: () => vm.runInContext('walkUnlock()', ctx) };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('raw input rejection retries ordinary pointer lock before falling back', async () => {
  const h = harness((canvas, root, options) => {
    if (options) return Promise.reject(new Error('raw input unsupported'));
    root.pointerLockElement = canvas;
    return Promise.resolve();
  });
  await h.lock(); h.change();
  assert.equal(h.state.requests.length, 2);
  assert.equal(h.ctx.WALK.noLock, false);
  assert.equal(h.ctx.WALK.locked, true);
  assert.equal(h.state.focus, 0);
});

test('synchronous denial and rejected promises enable drag controls instead of trapping the pause dialog', async () => {
  for (const deny of [() => { throw new Error('denied'); }, () => Promise.reject(new Error('denied'))]) {
    const h = harness(deny);
    await h.lock(); h.error();
    assert.equal(h.ctx.WALK.noLock, true);
    assert.equal(h.ctx.WALK.keys.size, 0);
    assert.equal(h.ctx.WALK.zoomOn, false);
    assert.equal(h.state.focus, 1);
    assert.equal(h.state.hud, 1);
    assert.equal(h.state.toasts.length, 1);
    assert.match(h.state.toasts[0], /拖动看四周/);
  }
});

test('an error event during the raw-input attempt does not bypass a successful normal retry', async () => {
  const raw = deferred();
  const h = harness((canvas, root, options) => {
    if (options) return raw.promise;
    root.pointerLockElement = canvas;
    return Promise.resolve();
  });
  const pending = h.lock(); h.error();
  assert.equal(h.ctx.WALK.noLock, false);
  raw.reject(new Error('unsupported')); await pending;
  assert.equal(h.ctx.WALK.noLock, false);
  assert.equal(h.state.requests.length, 2);
});

test('legacy void-returning APIs can fall back through pointerlockerror', async () => {
  const h = harness(() => undefined);
  await h.lock(); h.error();
  assert.equal(h.ctx.WALK.noLock, true);
  assert.equal(h.state.toasts.length, 1);
});

test('Esc release keeps the supported-pointer-lock pause behavior', async () => {
  const h = harness((canvas, root) => { root.pointerLockElement = canvas; return Promise.resolve(); });
  await h.lock(); h.change();
  h.root.pointerLockElement = null; h.change();
  assert.equal(h.ctx.WALK.locked, false);
  assert.equal(h.ctx.WALK.noLock, false);
  assert.equal(h.ctx.WALK.unlockT, 1000);
});

test('leaving exploration invalidates an outstanding request and prevents a later retry', async () => {
  const raw = deferred(), h = harness(() => raw.promise);
  const pending = h.lock(); h.ctx.mode = 'orbit'; h.unlock();
  raw.reject(new Error('late failure')); await pending;
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.state.focus, 0);
  assert.equal(h.state.hud, 0);
});

test('a late success releases capture after disposal, without changing the destroyed UI', async () => {
  const raw = deferred(), h = harness(() => raw.promise);
  const pending = h.lock(); h.ctx.DISPOSED = true; h.unlock();
  h.root.pointerLockElement = h.canvas; raw.resolve(); await pending;
  assert.equal(h.root.pointerLockElement, null);
  assert.equal(h.state.hud, 0);
  assert.equal(h.state.exits, 1);
});

test('an older request cannot release the lock of a newly entered exploration session', async () => {
  const raw = deferred(); let count = 0;
  const h = harness((canvas, root) => {
    if (++count === 1) return raw.promise;
    root.pointerLockElement = canvas; return Promise.resolve();
  });
  const old = h.lock(); h.unlock(); await h.lock(); raw.resolve(); await old;
  assert.equal(h.root.pointerLockElement, h.canvas);
  assert.equal(h.state.exits, 0);
});

test('opening settings invalidates pending requests without enabling fallback or stealing focus',async()=>{
  const raw=deferred(),h=harness(()=>raw.promise);
  const pending=h.lock();h.ctx.WALK.menu=true;h.unlock();
  raw.reject(new Error('late denial'));await pending;h.error();
  assert.equal(h.state.requests.length,1);assert.equal(h.state.focus,0);
  assert.equal(h.ctx.WALK.noLock,false);
});

test('a late pointer-lock success is released while the settings dialog is open',async()=>{
  const raw=deferred(),h=harness(()=>raw.promise);
  const pending=h.lock();h.ctx.WALK.menu=true;h.unlock();
  h.root.pointerLockElement=h.canvas;raw.resolve();await pending;
  assert.equal(h.root.pointerLockElement,null);assert.equal(h.state.exits,1);
});
