import assert from 'node:assert/strict';
import test from 'node:test';
import { createState, applySample } from '../src/state.mjs';
import { normalizeConfig } from '../src/config.mjs';
import raw from '../eo/site-config.mjs';
import { appendHistory, seedHistory } from '../eo/history.mjs';
import { buildView } from '../src/view.mjs';
import { renderPage } from '../src/page.mjs';
import { dayKey } from '../src/time.mjs';
import { compactHistory } from '../src/history-view.mjs';
const config = normalizeConfig(raw);
const HOUR = 3600000;
const start = Date.UTC(2026, 9, 8, 8, 27);
function record(state, at, outcome = 'up', cache = true) {
  const sample = { outcome, elapsedMs: 100 };
  const batch = { slot: Math.floor(at/60000), completedAt: at, samples: config.checks.map(check => ({ id:check.id, at, sample })) };
  for (const check of config.checks) applySample(state, check, sample, { now:at, timezone:config.timezone });
  if (cache) appendHistory(state,batch);
  return batch;
}
test('new monitor shows only its real time range, retains version, and does not pad the axis', () => {
  const state=createState();record(state,start);state.release={value:'a'.repeat(40)};
  const view=buildView(state,config,start+60000); const web=view.groups[0].checks[0];
  assert.equal(view.historyAxis.granularity,'minute');assert.equal(web.history.length,1);
  assert.equal(view.historyAxis.start,'16:26');assert.equal(view.historyAxis.end,'16:27');
  assert.equal(web.history.filter(x=>x.total).length,1);assert.equal(web.days.length,90);
  assert.equal(compactHistory(web.history).length,1);
  assert.equal(compactHistory(web.history).reduce((n,b)=>n+b.total,0),1);
  const html=renderPage(view);
  assert.match(html,/主站当前版本 aaaaaaa/); assert.match(html,/<p class="note">主站当前版本 aaaaaaa。<\/p>/);
  assert.doesNotMatch(html,/90 天前|45 天前|后台按|展示范围|nth-child\(-n\+45\)/);
});
test('hourly gaps stay unknown and per-hour totals match sample-weighted availability', () => {
  const state=createState();record(state,start);record(state,start+2*HOUR,'down');
  const view=buildView(state,config,start+2*HOUR+60000);const web=view.groups[0].checks[0];
  assert.equal(web.history.length,61);assert.deepEqual(web.history.filter(x=>x.total).map(x=>x.level),['up','down']);
  assert.equal(web.history.filter(x=>x.level==='none').length,59);
  assert.equal(web.uptime,0.5);assert.equal(web.history.reduce((n,b)=>n+b.total,0),2);
  assert.doesNotMatch(renderPage(view),/0 次探测失败/);
});
test('legacy daily counts never turn into invented hourly samples', () => {
  const state=createState();record(state,start,'up',false);record(state,start+60000);
  const view=buildView(state,config,start+120000);
  assert.equal(view.historyAxis.granularity,'day');assert.equal(view.groups[0].checks[0].history.at(-1).total,2);
});
test('history expands across real dates, keeps gaps, and caps display at retained 90 days', () => {
  const state=createState();record(state,start-2*24*HOUR,'up',false);record(state,start);
  let view=buildView(state,config,start+60000);assert.equal(view.historyAxis.granularity,'day');
  assert.deepEqual(view.groups[0].checks[0].history.slice(-3).map(x=>x.total),[1,0,1]);
  record(state,start-100*24*HOUR,'up',false);view=buildView(state,config,start+60000);
  assert.equal(view.groups[0].checks[0].history.length,3);
});
test('cross-midnight hour buckets keep dates and failure counts consistent', () => {
  const state=createState();const midnight=Date.UTC(2026,9,8,16);
  record(state,midnight-60000);record(state,midnight+60000,'down');
  const view=buildView(state,config,midnight+120000);const bars=view.groups[0].checks[0].history;
  assert.equal(view.historyAxis.granularity,'minute');assert.equal(bars.length,2);
  assert.match(bars.find(b=>b.total&&b.failed===0).label,/10月8日 23:58–10月9日 00:00/);assert.equal(bars.find(b=>b.failed).failed,1);
});

test('60/120 second cadence does not manufacture alternating empty slots', () => {
  const state=createState();
  for(const minute of [0,1,3,4,6,7])record(state,start+minute*60000);
  const view=buildView(state,config,start+8*60000),bars=view.groups[0].checks[0].history;
  assert.equal(bars.length,5);assert.ok(bars.every(bar=>bar.total>0));
  assert.equal(bars.reduce((n,b)=>n+b.total,0),6);
  assert.equal(view.historyAxis.end,'16:34');
});

test('mobile aggregation keeps every sample and failure, including an odd last bucket', () => {
  const state=createState();
  for(let n=0;n<61;n++)record(state,start+n*2*60000,n===60?'down':'up');
  const bars=buildView(state,config,start+121*60000).groups[0].checks[0].history;
  const mobile=compactHistory(bars);
  assert.equal(bars.length,61);assert.equal(mobile.length,31);
  assert.equal(mobile.reduce((n,b)=>n+b.total,0),61);
  assert.equal(mobile.reduce((n,b)=>n+b.failed,0),1);
  assert.equal(mobile.at(-1).level,'down');
});
test('one bounded bootstrap uses real raw samples, then skips all additional history reads',async()=>{
  const state=createState();const batch=record(state,start,'up',false);
  const cp={state,lastSlot:batch.slot};let gets=0,lists=0;
  const store={list:async({prefix,limit})=>{lists++;assert.equal(limit,65);return{blobs:prefix.includes(dayKey(start,config.timezone))?[{key:`${prefix}${batch.slot}.json`}]:[]};},get:async()=>{gets++;return batch;}};
  await seedHistory(store,cp,config,start+60000);await seedHistory(store,cp,config,start+120000);
  assert.equal(gets,1);assert.equal(lists,2);assert.equal(buildView(state,config,start+120000).historyAxis.granularity,'minute');
});
test('oversized or unavailable raw history falls back without scanning or breaking detection',async()=>{
  for (const broken of [false,true]) {
    const state=createState();record(state,start,'up',false);let gets=0;
    const store={list:async()=>{if(broken)throw Error('unavailable');return{blobs:Array.from({length:65},(_,n)=>({key:`samples/2026-10-08/${n}.json`}))};},get:async()=>{gets++;}};
    await seedHistory(store,{state,lastSlot:999999999},config,start);
    assert.equal(gets,0);assert.equal(buildView(state,config,start).historyAxis.granularity,'day');
    assert.equal(state.checks.web.days['2026-10-08'].up,1);
  }
});
