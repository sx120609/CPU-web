import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const bundle=readFileSync(new URL('../entry/src/main/resources/rawfile/NativeWebCompatibility.js',import.meta.url),'utf8');
function page() {
  let edits={hidden:[],custom:[]}; let fail=false; const writes=[];
  const auth={ready:true,isLoggedIn:true,user:{id:1},academicIdentity:'undergraduate',token:'__cpu_cookie_session__',$subscribe(){}};
  const jwxt={isLoggedIn:true,token:'__cpu_jwxt_cookie_session__',$subscribe(){}};
  const window={CPUTimeNative:{ready(){}},CPUTimeNativeScheduleFetch(){}};
  const ctx=vm.createContext({window,URL,AbortController,setTimeout,clearTimeout,
    navigator:{userAgent:'CPUWebHarmonyApp/19 CPUWebHarmonyAppVersion/2.1.0'},
    document:{cookie:'__Host-cpu-csrf=test-csrf',getElementById:()=>({__vue_app__:{config:{globalProperties:{$pinia:{_s:new Map([['auth',auth],['jwxt',jwxt]])}}}}})},
    fetch:async(url,options)=>{
      assert.match(String(url),/^\/api\/jwxt\/schedule-edits/);
      if(options.method==='PUT') {
        writes.push({body:JSON.parse(options.body),headers:options.headers,credentials:options.credentials});
        if(fail) return {ok:false,json:async()=>({code:500,message:'save failed'})};
        edits=JSON.parse(options.body).edits;
      }
      return {ok:true,json:async()=>({code:0,data:{edits}})};
    }
  });
  vm.runInContext(bundle,ctx);
  return {run:window.CPUHarmonyEditor,auth,writes,get edits(){return edits;},setEdits:value=>edits=value,fail:()=>fail=true};
}
const form={name:'新增课程',teacher:'教师',location:'B311',note:'',day:2,startSlot:3,endSlot:4,weekList:[2,4]};
test('native editor adds a course using the real protocol, cookies and CSRF header',async()=>{
  const p=page(); const opened=await p.run({action:'open',semester:'2026-2027-1'});
  const saved=await p.run({action:'save',session:opened.session,form,cells:[]});
  assert.equal(saved.saved,true); assert.equal(p.writes.length,1);
  assert.equal(p.writes[0].headers['X-CSRF-Token'],'test-csrf'); assert.equal(p.writes[0].credentials,'same-origin');
  assert.equal(p.edits.custom[0].course.name,form.name); assert.deepEqual(p.edits.custom[0].course.weekList,[2,4]);
});
test('native editor hides an official course and can restore the hidden entry',async()=>{
  const p=page(); let opened=await p.run({action:'open',semester:'fall'});
  const original={day:2,bigSlot:2,startSlot:3,endSlot:4,course:{name:'原课程',weekList:[2,4],weeks:'2,4',startSlot:3,endSlot:4}};
  const result=await p.run({action:'delete',session:opened.session,original,cells:[{day:2,bigSlot:2,courses:[original.course]}]});
  assert.equal(result.saved,true); assert.equal(p.edits.hidden.length,1);
  opened=await p.run({action:'open',semester:'fall'});
  assert.equal(opened.hidden[0].label,'原课程');
  await p.run({action:'restoreHidden',session:opened.session,key:opened.hidden[0].key,cells:[]});
  assert.equal(p.edits.hidden.length,0);
});
test('native editor preserves unrelated changes and refuses a changed baseline',async()=>{
  const p=page();const opened=await p.run({action:'open',semester:'fall'});
  p.setEdits({hidden:['changed-by-other-client'],custom:[]});
  const result=await p.run({action:'save',session:opened.session,form,cells:[]});
  assert.match(result.error,/其他页面修改/);assert.equal(p.writes.length,0);assert.equal(p.edits.hidden[0],'changed-by-other-client');
});
test('native editor cannot save into another account or unsupported graduate identity',async()=>{
  const p=page();const opened=await p.run({action:'open',semester:'fall'});p.auth.user={id:2};
  assert.match((await p.run({action:'save',session:opened.session,form,cells:[]})).error,/失效/);
  assert.equal(p.writes.length,0);p.auth.academicIdentity='graduate';
  assert.match((await p.run({action:'open',semester:'fall'})).error,/研究生/);
});
test('native editor rejects invalid slots and preserves failures for retry',async()=>{
  const p=page();const opened=await p.run({action:'open',semester:'fall'});
  assert.match((await p.run({action:'save',session:opened.session,form:{...form,endSlot:12},cells:[]})).error,/节次/);
  assert.equal(p.writes.length,0);p.fail();
  const failed=await p.run({action:'save',session:opened.session,form,cells:[]});
  assert.equal(failed.saved,undefined);assert.equal(failed.error,'save failed');
});
