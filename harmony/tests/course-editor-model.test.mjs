import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
const source = readFileSync(new URL('../entry/src/main/ets/schedule/NativeCourseEditor.ets', import.meta.url), 'utf8')
  .split('@Component')[0].replace('@Observed', '');
function harness() {
  const timers = new Map(); const requests = []; let saved = 0;
  class Clock extends Date { static now() { return 42; } }
  const context = vm.createContext({ module: { exports: {} }, Date: Clock,
    setTimeout: callback => { const key=timers.size+1; timers.set(key,callback); return key; }, clearTimeout:key=>timers.delete(key) });
  vm.runInContext(transformSync(source,{loader:'ts',format:'cjs'}).code,context);
  const model = new context.module.exports.NativeCourseEditorModel();
  model.attach((id,request)=>requests.push({id,request}),()=>saved++);
  const store={selectedSemester:'fall',selectedWeek:'2',selectedDay:2,result:{cells:[]},weekOptions:()=>[1,2,3].map(value=>({value:String(value)}))};
  return {model,store,requests,timers,get saved(){return saved;}};
}
test('reopening within one millisecond rejects the previous editor reply',()=>{
  const h=harness(); h.model.open(h.store); const first=h.requests.at(-1).id;
  h.model.cancel(); h.model.open(h.store); const second=h.requests.at(-1).id;
  assert.notEqual(first,second);
  h.model.accept(first,JSON.stringify({session:'old-account'})); assert.equal(h.model.session,'');
  h.model.accept(second,JSON.stringify({session:'current'})); assert.equal(h.model.session,'current');
});
test('cancelling clears course identity and ignores delayed completion',()=>{
  const h=harness(); h.model.open(h.store,{day:1,startSlot:1,endSlot:2,course:{name:'Private course',location:'A',teacher:'B',weekList:[2]}});
  const id=h.requests.at(-1).id; h.model.cancel(); h.model.accept(id,JSON.stringify({saved:true}));
  assert.equal(h.model.name,''); assert.equal(h.model.teacher,''); assert.equal(h.model.original,undefined);
  assert.equal(h.model.visible,false); assert.equal(h.saved,0);
});
test('invalid fields never submit, timeout permits retry without accepting an old success',()=>{
  const h=harness(); h.model.open(h.store); h.model.accept(h.requests.at(-1).id,JSON.stringify({session:'current'}));
  h.model.submit('save'); assert.equal(h.requests.length,1); assert.match(h.model.error,/课程名称/);
  h.model.name='课程'; h.model.submit('save'); const id=h.requests.at(-1).id;
  assert.equal(h.model.busy,true); [...h.timers.values()].forEach(callback=>callback());
  assert.equal(h.model.busy,false); assert.match(h.model.error,/超时/);
  h.model.accept(id,JSON.stringify({saved:true})); assert.equal(h.saved,0);
});
