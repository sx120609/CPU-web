import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';

const app = readFileSync(new URL('../src/views/services/campus3d/app.js', import.meta.url), 'utf8');
const code = app.slice(app.indexOf('const PRESENCE_API ='), app.indexOf('// ---- aiming and inspecting buildings'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const session = id => ({ sid: id, key: `key-${id}`, name: `name-${id}` });
const peer = id => [id, `peer-${id}`, 0, 0, 0, 0, 0, 1, 0];
function harness(overrides = {}) {
  const state = { joins: 0, leaves: [], uiAfterDispose: 0, now: 1000, nodesRemoved: 0 };
  const presence = {
    join: async () => session(`s${++state.joins}`), sync: async () => ({ n: 1, p: [] }),
    leave: credentials => { state.leaves.push(credentials); return Promise.resolve(); }, ...overrides,
  };
  class Tag extends THREE.Object3D { constructor(element) { super(); this.element = element; } }
  const scene = new THREE.Scene(), elements = new Map();
  const ctx = vm.createContext({
    opts: { presence }, THREE, CSS2DObject: Tag, scene, mode: 'walk', DISPOSED: false,
    performance: { now: () => state.now },
    document: { createElement: () => ({ style: {}, remove: () => state.nodesRemoved++ }) },
    camera: { position: new THREE.Vector3() }, DRIVE: { on: false }, RIDE: { on: false }, WALK: { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0 },
    _c2: new THREE.Color(), angDiff: (a,b) => Math.atan2(Math.sin(a-b),Math.cos(a-b)), clamp: (v,a,b) => Math.max(a,Math.min(b,v)), toast() {},
    // Geometry production is independent of lifetime ownership. Use small real
    // Three geometries, then execute the actual avatar construction and disposal.
    carGeometry: () => ({ body: new THREE.BoxGeometry(), trim: new THREE.BoxGeometry(), wheel: new THREE.BoxGeometry() }),
    $: selector => {
      if (ctx.DISPOSED) state.uiAfterDispose++;
      if (!elements.has(selector)) elements.set(selector, { setAttribute() {} });
      return elements.get(selector);
    },
  });
  vm.runInContext(code, ctx);
  const api = vm.runInContext('({ NET, netStart, netStop, updateNet, netReceive, netDrop, netGeo, netClear, netDisposeAssets: typeof netDisposeAssets === "function" ? netDisposeAssets : null })',ctx);
  return { ctx, state, api, scene };
}

test('joining then leaving before the response releases the orphan session', async () => {
  const join = deferred(), h = harness({ join: () => join.promise });
  h.api.netStart(); h.ctx.mode = 'orbit'; h.api.netStop();
  join.resolve(session('old')); await tick();
  assert.equal(h.api.NET.on, false);
  assert.equal(h.api.NET.busy, false);
  assert.equal(h.state.leaves[0]?.sid, 'old');
});

test('a stale join cannot adopt the next exploration or clear its pending state', async () => {
  const a = deferred(), b = deferred(); let calls = 0;
  const h = harness({ join: () => (++calls === 1 ? a.promise : b.promise) });
  h.api.netStart(); h.api.netStop(); h.api.netStart();
  a.resolve(session('old')); await tick();
  assert.equal(calls, 2);
  assert.equal(h.api.NET.busy, true);
  assert.equal(h.api.NET.on, false);
  b.resolve(session('new')); await tick();
  assert.equal(h.api.NET.sid, 'new');
  assert.equal(h.api.NET.busy, false);
  assert.equal(h.state.leaves[0]?.sid, 'old');
});

test('late failed join does not postpone a new healthy session', async () => {
  const old = deferred(); let calls = 0;
  const h = harness({ join: () => ++calls === 1 ? old.promise : Promise.resolve(session('new')) });
  h.api.netStart(); h.api.netStop(); h.api.netStart(); await tick();
  old.reject(new Error('late failure')); await tick();
  assert.equal(h.api.NET.sid, 'new');
  assert.equal(h.api.NET.retry, 0);
});

test('late sync cannot inject ghosts or clear the next session in-flight flag', async () => {
  const a = deferred(), b = deferred(); let calls = 0;
  const h = harness({ sync: () => ++calls === 1 ? a.promise : b.promise });
  h.api.netStart(); await tick(); h.api.updateNet(0.3);
  h.api.netStop(); h.api.netStart(); await tick(); h.api.updateNet(0.3);
  a.resolve({ n: 9, p: [peer('old')] }); await tick();
  assert.equal(calls, 2);
  assert.equal(h.api.NET.inflight, true);
  assert.equal(h.api.NET.others.size, 0);
  b.resolve({ n: 2, p: [peer('new')] }); await tick();
  assert.deepEqual([...h.api.NET.others.keys()], ['new']);
  assert.equal(h.api.NET.count, 2);
  h.api.netStop();
});

test('late sync rejection does not count as a failure of the new session', async () => {
  const sync = deferred(), h = harness({ sync: () => sync.promise });
  h.api.netStart(); await tick(); h.api.updateNet(0.3);
  h.api.netStop(); h.api.netStart(); await tick();
  sync.reject(new Error('old socket closed')); await tick();
  assert.equal(h.api.NET.fail, 0);
  assert.equal(h.api.NET.on, true);
});

test('four sync failures release the session and allow the timed reconnect', async () => {
  const h = harness({ sync: () => Promise.reject(new Error('offline')) });
  h.api.netStart(); await tick();
  for (let i=0; i<4; i++) { h.api.updateNet(0.3); await tick(); }
  assert.equal(h.api.NET.on, false);
  assert.equal(h.api.NET.sid, null);
  assert.equal(h.state.leaves.length, 1);
  h.api.updateNet(0.3); await tick(); assert.equal(h.state.joins, 1);
  h.state.now += 6001; h.api.updateNet(0.3); await tick(); assert.equal(h.state.joins, 2);
  assert.equal(h.api.NET.on, true);
});

test('synchronous API errors are contained without stopping the render loop', async () => {
  const h = harness({ sync: () => { throw new Error('adapter failed'); } });
  h.api.netStart(); await tick();
  assert.doesNotThrow(() => h.api.updateNet(0.3)); await tick();
  assert.equal(h.api.NET.inflight, false);
  assert.equal(h.api.NET.fail, 1);
});

test('unmount during join cannot resurrect networking or touch destroyed UI', async () => {
  const join = deferred(), h = harness({ join: () => join.promise });
  h.api.netStart(); h.ctx.DISPOSED = true; h.api.netStop();
  join.resolve(session('late')); await tick(); h.api.updateNet(1);
  assert.equal(h.api.NET.on, false);
  assert.equal(h.state.leaves[0]?.sid, 'late');
  assert.equal(h.state.uiAfterDispose, 0);
});

test('dropping an avatar frees its own materials, but keeps shared assets alive for other players', async () => {
  const h = harness(); h.api.netStart(); await tick(); h.api.netReceive({ n:3, p:[peer('a'),peer('b')] });
  const a = h.api.NET.others.get('a'), b = h.api.NET.others.get('b'), shared = h.api.netGeo();
  let ownedDisposals=0, sharedDisposals=0;
  for(const m of [a.shirt,a.carMat,a.frameMat]) m.addEventListener('dispose',()=>ownedDisposals++);
  for(const m of [b.shirt,b.carMat,b.frameMat,shared.unit,shared.skin,shared.car.body]) m.addEventListener('dispose',()=>sharedDisposals++);
  h.api.netDrop('a'); h.api.netDrop('a');
  assert.equal(ownedDisposals,3); assert.equal(sharedDisposals,0);
  assert.equal(h.api.NET.others.size,1); assert.equal(h.scene.children.length,1);
});

test('full teardown frees cached network geometry and materials exactly once', async () => {
  const h = harness(); h.api.netStart(); await tick(); h.api.netReceive({ n:2, p:[peer('a')] });
  const shared = h.api.netGeo(), resources = new Set([...Object.values(shared),...Object.values(shared.car)].filter(v=>typeof v?.dispose === 'function'));
  let disposed=0; for(const r of resources) r.addEventListener('dispose',()=>disposed++);
  h.ctx.DISPOSED = true; h.api.netStop();
  assert.equal(typeof h.api.netDisposeAssets,'function');
  h.api.netDisposeAssets(); h.api.netDisposeAssets();
  assert.equal(disposed,resources.size);
  assert.equal(h.scene.children.length,0);
  assert.equal(h.state.uiAfterDispose,0);
});
