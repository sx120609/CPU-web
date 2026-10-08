import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedProbe } from '../eo/shared-probe.mjs';
import { normalizeConfig } from '../src/config.mjs';
import raw from '../eo/site-config.mjs';

test('ten independent verdicts use seven primary requests; asset files still checked', async () => {
  const calls = [];
  const shared = createSharedProbe({ request: async (url, options) => {
    calls.push(url);
    await new Promise(resolve => setTimeout(resolve, 5));
    let body = JSON.stringify({code:0,data:{ok:true,ready:true,qqbot:{connected:true},jwxtAgents:{total:3,online:2}}});
    if (url.endsWith('/')) body = '<div id="app">药苑之声</div><script src="/main.js"></script><link rel="stylesheet" href="/main.css">';
    return {status:200,body,url,certificates:[],headers:{'content-type':url.endsWith('.css')?'text/css':'text/javascript'}};
  }});
  const config = normalizeConfig(raw);
  const results = await Promise.all(config.checks.map(shared.probe));
  assert.equal(results.length,10);
  assert.ok(results.every(r=>r.outcome==='up'));
  assert.equal(results[config.checks.findIndex(c=>c.id==='jwxt-agent')].detail,'在线 2/3 台');
  assert.equal(calls.filter(u=>u==='https://cputime.cn/').length,1);
  assert.equal(calls.filter(u=>u==='https://cputime.cn/api/ready').length,1);
  assert.ok(calls.includes('https://cputime.cn/main.js'));
  assert.ok(calls.includes('https://cputime.cn/main.css'));
  assert.deepEqual(shared.stats,{requests:9,shared:3});
});

test('settled failures and content failures are never cached for retries', async () => {
  let calls=0;
  const shared=createSharedProbe({request:async()=>{ calls++; if(calls===1)throw new Error('offline'); return {status:503,body:'',headers:{},certificates:[]}; }});
  const options={timeoutMs:4000};
  const first=await Promise.allSettled([shared.request('https://example.test/',options),shared.request('https://example.test/',options)]);
  assert.ok(first.every(r=>r.status==='rejected')); assert.equal(calls,1);
  await shared.request('https://example.test/',options); assert.equal(calls,2);
  await shared.request('https://example.test/',options); assert.equal(calls,3);
});

test('different headers and request modes do not share a response',async()=>{
  const shared=createSharedProbe({request:async()=>({status:200})});
  await Promise.all([shared.request('https://example.test/',{}),shared.request('https://example.test/',{headersOnly:true}),shared.request('https://example.test/',{headers:{Accept:'application/json'}})]);
  assert.deepEqual(shared.stats,{requests:3,shared:0});
});
