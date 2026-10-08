import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConfig } from '../src/config.mjs';
import raw from '../eo/site-config.mjs';
import { createHandler } from '../eo/handler.mjs';
import { runTick, loadCheckpoint, cleanupHistory, STATE_KEY, PENDING_KEY } from '../eo/engine.mjs';
import { acquireWriter, releaseWriter, WRITER_KEY } from '../eo/storage.mjs';
import { authorized } from '../eo/auth.mjs';

const clone = value => structuredClone(value);
class MemoryBlob {
  data = new Map();
  failKey = null;
  async get(key, options) {
    assert.equal(options.consistency, 'strong');
    return clone(this.data.get(key) ?? null);
  }
  async setJSON(key, value, options) {
    if (this.failKey === key) { this.failKey = null; throw new Error('simulated storage failure'); }
    if (options?.onlyIfNew && this.data.has(key)) throw Object.assign(new Error('exists'), { code: 'PRECONDITION_FAILED' });
    this.data.set(key, clone(value));
  }
  async delete(key) { this.data.delete(key); }
  async list({prefix, limit, consistency}) {
    assert.equal(consistency, 'strong');
    return { blobs: [...this.data.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit).map(key => ({key})) };
  }
}
const up = { outcome: 'up', elapsedMs: 25, reason: '', certificates: [{host:'cputime.cn',expiresAt:Date.UTC(2027,0,1)}], version: 'abc123' };
const down = { ...up, outcome: 'down', reason: 'HTTP 502', certificates: [] };
const start = Date.UTC(2026,9,8,8);
const config = normalizeConfig(raw);
function fixture(overrides = {}) {
  let clock = start;
  const store = new MemoryBlob();
  const options = { store, config: clone(config), now: () => clock, probe: async () => clone(up), sleep: async () => {}, connectivity: {isOnline:async()=>true}, ...overrides };
  return {store, options, advance: ms => clock += ms, tick: () => runTick(options)};
}

test('all ten checks use the approved 4s timeout, retaining 3s retry and 60s interval', async () => {
  const f = fixture(); const seen = [];
  f.options.probe = async check => { seen.push(check.id); assert.equal(check.timeoutMs,4000); assert.equal(check.retryDelayMs,3000); assert.equal(check.intervalSeconds,60); return clone(up); };
  assert.equal((await f.tick()).checks,10);
  assert.deepEqual(seen, config.checks.map(c=>c.id));
  const saved=await loadCheckpoint(f.store);
  assert.equal(saved.state.release.value,'abc123');
  assert.equal(Object.keys(saved.state.checks).length,10);
  assert.ok(saved.state.certificates['cputime.cn']);
});

test('retry preserves two consecutive failures, one incident, then immediate recovery', async () => {
  const f=fixture({probe:async()=>clone(down)}); let count=0;
  f.options.probe=async()=>{count++;return clone(down)};
  await f.tick(); assert.equal(count,20);
  assert.equal((await loadCheckpoint(f.store)).state.incidents.length,0);
  f.advance(60000); await f.tick();
  assert.equal((await loadCheckpoint(f.store)).state.incidents.length,10);
  f.advance(60000); f.options.probe=async()=>clone(up); await f.tick();
  const state=(await loadCheckpoint(f.store)).state;
  assert.equal(state.checks.web.status,'up'); assert.ok(state.incidents.every(i=>i.resolvedAt));
});

test('same-minute duplicate does not probe or count a sample twice', async () => {
  const f=fixture(); await f.tick();
  f.options.probe=async()=>{throw new Error('must not probe')};
  assert.equal((await f.tick()).code,'already_recorded');
  const state=(await loadCheckpoint(f.store)).state;
  assert.equal(Object.values(state.checks.web.days)[0].up,1);
});

test('a concurrent invocation is rejected while the writer is probing', async () => {
  const f=fixture(); let finish, entered;
  const blocked=new Promise(resolve=>finish=resolve);const ready=new Promise(resolve=>entered=resolve);
  f.options.probe=async()=>{entered();await blocked;return clone(up)};
  const first=f.tick(); await ready;
  assert.equal((await f.tick()).status,409);
  finish(); assert.equal((await first).status,200);
});

test('storage failure leaves a recoverable journal and never double-counts on retry', async () => {
  const f=fixture(); f.store.failKey=STATE_KEY;
  await assert.rejects(f.tick(),/simulated/);
  assert.ok(f.store.data.has(PENDING_KEY)); assert.ok(!f.store.data.has(WRITER_KEY));
  f.options.probe=async()=>{throw new Error('must replay, not probe')};
  assert.equal((await f.tick()).code,'already_recorded');
  assert.equal(Object.values((await loadCheckpoint(f.store)).state.checks.web.days)[0].up,1);
  assert.ok(!f.store.data.has(PENDING_KEY));
});

test('monitor connectivity failure creates unknown samples without outage incidents', async () => {
  const f=fixture({probe:async()=>clone(down),connectivity:{isOnline:async()=>false}});
  await f.tick(); f.advance(60000); await f.tick();
  const state=(await loadCheckpoint(f.store)).state;
  assert.equal(state.incidents.length,0); assert.deepEqual(state.checks.web.days,{});
  assert.equal(state.checks.web.status,'unknown');
});

test('abandoned writers recover after five minutes; active writers cannot be stolen', async () => {
  const store=new MemoryBlob(); const original=await acquireWriter(store,()=>start);
  assert.equal(await acquireWriter(store,()=>start+120000),null);
  const replacement=await acquireWriter(store,()=>start+300001);
  assert.ok(replacement); assert.notEqual(replacement.owner,original.owner);
  await releaseWriter(store,original); assert.equal(store.data.get(WRITER_KEY).owner,replacement.owner);
  await releaseWriter(store,replacement); assert.ok(!store.data.has(WRITER_KEY));
});

test('an orphan recovery marker fails closed instead of starting competing writers', async () => {
  const store=new MemoryBlob(); await acquireWriter(store,()=>start);
  store.data.set('control/recovery.json',{owner:'interrupted-recovery'});
  assert.equal(await acquireWriter(store,()=>start+600000),null);
});

test('retention deletes only a bounded chunk older than the 90 calendar-day window', async () => {
  const f=fixture(); await f.tick(); const cp=await loadCheckpoint(f.store);
  cp.retentionDay='2026-01-01';
  for(let n=0;n<30;n++)f.store.data.set(`samples/2026-01-01/${n}.json`,{});
  f.store.data.set('samples/2026-10-08/keep.json',{});
  await cleanupHistory(f.store,cp,config,start);
  assert.equal([...f.store.data.keys()].filter(k=>k.startsWith('samples/2026-01-01/')).length,5);
  assert.ok(f.store.data.has('samples/2026-10-08/keep.json'));
  assert.equal(cp.retentionDay,'2026-01-01');
  await cleanupHistory(f.store,cp,config,start); assert.equal(cp.retentionDay,'2026-01-02');
});

test('failed notifications remain in the durable outbox, acknowledged deliveries are removed',async()=>{
  const f=fixture({probe:async()=>clone(down)});
  f.options.config.notify=[{name:'test',events:['down','recovered'],format:'generic',url:'https://example.invalid'}];
  f.options.send=async()=>[{ok:false}];
  await f.tick();f.advance(60000);await f.tick();
  assert.equal((await loadCheckpoint(f.store)).outbox.length,10);
  f.options.send=async(_channel,events)=>{assert.equal(events.length,10);return [{ok:true}]};
  f.advance(60000);await f.tick();assert.equal((await loadCheckpoint(f.store)).outbox.length,0);
});

test('missing/placeholder tokens fail closed before constructing storage; GET cannot probe',async()=>{
  for(const secret of [undefined,'short','CHANGE_ME_'.repeat(10)])assert.equal(authorized(new Request('https://example.invalid'),secret),false);
  const handler=createHandler({config,getStore:()=>{throw new Error('must not create store')},secret:'x'.repeat(48)});
  assert.equal((await handler(new Request('https://example.invalid',{method:'POST'}),'tick')).status,401);
  assert.equal((await handler(new Request('https://example.invalid'),'tick')).status,405);
});

test('public routes show real state without exposing probe config, secrets or internal journal',async()=>{
  const f=fixture();await f.tick();
  const handler=createHandler({config,getStore:()=>f.store,now:()=>start,secret:'secret-never-public'.repeat(3)});
  const response=await handler(new Request('https://status.example/api/status'),'status');
  const body=await response.text();assert.equal(response.status,200);
  assert.equal(JSON.parse(body).groups.flatMap(g=>g.checks).length,10);
  assert.doesNotMatch(body,/api\/ready|api\/boards|Authorization|secret-never-public|retentionDay|outbox/);
  const html=await handler(new Request('https://status.example/'),'page');
  assert.match(await html.text(),/所有服务运行正常/);
  assert.equal((await handler(new Request('https://status.example/healthz'),'health')).status,200);
  const head=await handler(new Request('https://status.example/api/status',{method:'HEAD'}),'status');
  assert.equal(head.status,200); assert.equal(await head.text(),'');
  const stale=createHandler({config,getStore:()=>f.store,now:()=>start+600001});
  assert.equal((await stale(new Request('https://status.example/healthz'),'health')).status,503);
  assert.match(await (await stale(new Request('https://status.example/'),'page')).text(),/暂无监测数据/);
});

test('storage outages return 503 instead of an empty healthy status page',async()=>{
  const handler=createHandler({config,getStore:()=>({get:async()=>{throw new Error('private storage secret')}})});
  const response=await handler(new Request('https://status.example/'),'page');
  assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private|secret/);
});

test('upgrade replays an interrupted nine-check batch without losing history',async()=>{
  const f=fixture();
  f.options.config.checks=f.options.config.checks.filter(c=>c.id!=='jwxt-agent');
  f.store.failKey=STATE_KEY;
  await assert.rejects(f.tick(),/simulated/);
  f.options.config=clone(config);
  assert.equal((await f.tick()).code,'already_recorded');
  let cp=await loadCheckpoint(f.store);
  assert.equal(Object.values(cp.state.checks.web.days)[0].up,1);
  assert.equal(cp.state.checks['jwxt-agent'],undefined);
  f.advance(60000);await f.tick();
  cp=await loadCheckpoint(f.store);
  assert.equal(Object.values(cp.state.checks.web.days)[0].up,2);
  assert.equal(Object.values(cp.state.checks['jwxt-agent'].days)[0].up,1);
});

test('actual execution region is persisted and exposed without using visitor geography',async()=>{
  const f=fixture({region:'ap-guangzhou'});await f.tick();
  assert.equal((await loadCheckpoint(f.store)).lastExecution.region,'ap-guangzhou');
  const handler=createHandler({config,getStore:()=>f.store,now:()=>start});
  const response=await handler(new Request('https://status.example/api/status'),'status');
  assert.equal((await response.json()).monitor.region,'ap-guangzhou');
});

test('mainland-only deployment refuses to probe outside Guangzhou before opening storage',async()=>{
  for(const region of [null,'ap-singapore']){
    const secret='test-only-secret-'.repeat(4);
    const handler=createHandler({config,secret,region,requiredRegion:'ap-guangzhou',getStore:()=>{throw new Error('must not use storage');}});
    const response=await handler(new Request('https://status.example/api/internal/tick',{method:'POST',headers:{Authorization:`Bearer ${secret}`}}),'tick');
    assert.equal(response.status,503);assert.equal((await response.json()).code,'wrong_execution_region');
  }
});
