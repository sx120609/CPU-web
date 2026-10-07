import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const bundle=readFileSync(new URL('../entry/src/main/resources/rawfile/NativeWebCompatibility.js',import.meta.url),'utf8');
function page() {
  let edits={hidden:[],custom:[]}; let fail=false; const writes=[]; const shareRequests=[]; let shareReply={status:200,body:{code:0,data:{}}};
  const auth={ready:true,isLoggedIn:true,user:{id:1},academicIdentity:'undergraduate',token:'__cpu_cookie_session__',$subscribe(){}};
  const jwxt={isLoggedIn:true,token:'__cpu_jwxt_cookie_session__',$subscribe(){}};
  const window={CPUTimeNative:{ready(){}},CPUTimeNativeScheduleFetch(){}};
  const ctx=vm.createContext({window,URL,AbortController,setTimeout,clearTimeout,
    navigator:{userAgent:'CPUWebHarmonyApp/19 CPUWebHarmonyAppVersion/2.1.0'},
    document:{cookie:'__Host-cpu-csrf=test-csrf',getElementById:()=>({__vue_app__:{config:{globalProperties:{$pinia:{_s:new Map([['auth',auth],['jwxt',jwxt]])}}}}})},
    fetch:async(url,options)=>{
      if(String(url).startsWith('/api/schedule-shares')) {
        shareRequests.push({url:String(url),options,body:options.body?JSON.parse(options.body):undefined});
        return {ok:shareReply.status<400,status:shareReply.status,json:async()=>shareReply.body};
      }
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
  return {run:window.CPUHarmonyEditor,shares:window.CPUHarmonyShares,shareRequests,setShareReply:value=>shareReply=value,
    auth,writes,get edits(){return edits;},setEdits:value=>edits=value,fail:()=>fail=true};
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
  assert.match((await p.run({action:'save',session:opened.session,form:{...form,endSlot:13},cells:[]})).error,/节次/);
  assert.match((await p.run({action:'save',session:opened.session,form:{...form,arrangements:[{day:8,slots:[1],weekList:[1]}]},cells:[]})).error,/星期/);
  assert.match((await p.run({action:'save',session:opened.session,form:{...form,arrangements:[{day:1,slots:[],weekList:[1]}]},cells:[]})).error,/节次/);
  assert.match((await p.run({action:'save',session:opened.session,form:{...form,arrangements:[{day:1,slots:[1],weekList:[]}]},cells:[]})).error,/教学周/);
  assert.equal(p.writes.length,0);p.fail();
  const failed=await p.run({action:'save',session:opened.session,form,cells:[]});
  assert.equal(failed.saved,undefined);assert.equal(failed.error,'save failed');
});

test('native editor saves the twelfth period the Web timetable defines',async()=>{
  const p=page();const opened=await p.run({action:'open',semester:'fall'});
  assert.equal((await p.run({action:'save',session:opened.session,form:{...form,startSlot:12,endSlot:12},cells:[]})).saved,true);
  assert.deepEqual([p.edits.custom[0].course.startSlot,p.edits.custom[0].course.endSlot],[12,12]);
});
test('hiding or editing a block leaves the rows of the same course in other weeks alone',async()=>{
  // JWXT lists one course in the same periods as two rows: weeks 1-5 and weeks 7-16.
  const row=(weeks,weekList)=>({name:'物理化学',teacher:'张三',location:'C201',weeks,weekList,startSlot:3,endSlot:4});
  const early=row('1-5周',[1,2,3,4,5]);const cells=[{day:2,bigSlot:2,courses:[early,row('7-16周',[7,8,9,10,11,12,13,14,15,16])]}];
  const original={day:2,bigSlot:2,startSlot:3,endSlot:4,course:early};
  let p=page();let opened=await p.run({action:'open',semester:'fall'});
  await p.run({action:'delete',session:opened.session,original,cells});
  assert.deepEqual(p.edits.hidden,['jwxt|2|2|3|4|物理化学|张三|C201|1-5周']);
  p=page();opened=await p.run({action:'open',semester:'fall'});
  await p.run({action:'save',session:opened.session,original,cells,
    form:{name:'物理化学',teacher:'张三',location:'C305',note:'',arrangements:[{day:2,slots:[3,4],weekList:[1,2,3,4,5]}]}});
  assert.deepEqual(p.edits.hidden,['jwxt|2|2|3|4|物理化学|张三|C201|1-5周']);
  assert.deepEqual(p.edits.custom.map(item=>item.course.weekList),[[1,2,3,4,5]]);
});
test('several meeting times are saved as one existing-format item per run of periods',async()=>{
  const p=page();const opened=await p.run({action:'open',semester:'fall'});
  const original={day:2,bigSlot:2,startSlot:3,endSlot:4,course:{name:'原课程',teacher:'教师',weekList:[2,4],weeks:'2,4',startSlot:3,endSlot:4}};
  const saved=await p.run({action:'save',session:opened.session,original,cells:[{day:2,bigSlot:2,courses:[original.course]}],
    form:{...form,name:'原课程',arrangements:[{day:2,slots:[1,2,5,9],weekList:[2,4]},{day:4,slots:[7,8],weekList:[1,2,3]}]}});
  assert.equal(saved.saved,true);
  assert.deepEqual(p.edits.custom.map(item=>[item.day,item.bigSlot,item.course.startSlot,item.course.endSlot,item.course.weekList.join()]),
    [[2,1,1,2,'2,4'],[2,3,5,5,'2,4'],[2,5,9,9,'2,4'],[4,4,7,8,'1,2,3']]);
  // Only the first block stays tied to the official course it replaces.
  assert.equal(p.edits.hidden.length,1);
  assert.deepEqual(p.edits.custom.map(item=>Boolean(item.sourceKey)),[true,false,false,false]);
  assert.equal(new Set(p.edits.custom.map(item=>item.id)).size,4);
  assert.equal(p.writes[0].body.edits.priority,undefined);
});
// Values built inside the vm context have another realm's prototypes.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
test('display priority is read without a session, set in front of the others, kept by unrelated saves and cleared',async()=>{
  const p=page();
  p.setEdits({hidden:[],custom:[],priority:{'  药理  学 ':2,'无效':0,'药剂学':5}});
  same((await p.run({action:'priority',semester:'fall'})).priority,{'药剂学':5,'药理 学':2});
  let opened=await p.run({action:'open',semester:'fall'});
  same(opened.priority,{'药剂学':5,'药理 学':2});
  let saved=await p.run({action:'save',session:opened.session,form:{...form,name:' 药理  学',preferred:true},cells:[]});
  same(saved.priority,{'药剂学':5,'药理 学':6});
  same(p.writes.at(-1).body.edits.priority,{'药剂学':5,'药理 学':6});
  // A course already in front keeps its value; a save without the switch keeps the stored map.
  opened=await p.run({action:'open',semester:'fall'});
  saved=await p.run({action:'save',session:opened.session,form:{...form,name:'药理 学',preferred:true},cells:[]});
  same(saved.priority,{'药剂学':5,'药理 学':6});
  opened=await p.run({action:'open',semester:'fall'});
  await p.run({action:'save',session:opened.session,form:{...form,name:'别的课',preferred:undefined},cells:[]});
  same(p.writes.at(-1).body.edits.priority,{'药剂学':5,'药理 学':6});
  opened=await p.run({action:'open',semester:'fall'});
  await p.run({action:'save',session:opened.session,form:{...form,name:'药剂学',preferred:false},cells:[]});
  same(p.writes.at(-1).body.edits.priority,{'药理 学':6});
  opened=await p.run({action:'open',semester:'fall'});
  await p.run({action:'save',session:opened.session,form:{...form,name:'药理 学',preferred:false},cells:[]});
  same(p.writes.at(-1).body.edits.priority,{});
  // A priority changed elsewhere invalidates the session like any other edit.
  opened=await p.run({action:'open',semester:'fall'});
  p.setEdits({...p.edits,priority:{'别处改的':1}});
  assert.match((await p.run({action:'save',session:opened.session,form,cells:[]})).error,/其他页面修改/);
});
test('share codes go through the signed-in session with the site nickname and never the HTTP cache',async()=>{
  const p=page();p.auth.user={id:1,nickname:' 阿青 '};
  p.setShareReply({status:200,body:{code:0,data:{code:'ABCD2345',created:true}}});
  const published=await p.shares({action:'publish',body:{semester:'fall',schedule:{},calendar:{}}});
  assert.deepEqual(JSON.parse(JSON.stringify(published)),{ok:true,status:200,data:{code:'ABCD2345',created:true}});
  const request=p.shareRequests.at(-1);
  assert.equal(request.url,'/api/schedule-shares');assert.equal(request.options.method,'POST');
  assert.equal(request.body.ownerName,'阿青');assert.equal(request.options.cache,'no-store');
  assert.equal(request.options.headers['X-CSRF-Token'],'test-csrf');assert.equal(request.options.credentials,'same-origin');
  await p.shares({action:'meta',code:' abcd2345 '});
  assert.equal(p.shareRequests.at(-1).url,'/api/schedule-shares/ABCD2345/meta');
  assert.equal(p.shareRequests.at(-1).options.headers['X-CSRF-Token'],undefined);
  await p.shares({action:'revoke',code:'abcd2345'});
  assert.deepEqual([p.shareRequests.at(-1).url,p.shareRequests.at(-1).options.method],['/api/schedule-shares/ABCD2345','DELETE']);
  p.setShareReply({status:404,body:{code:404,message:'分享课表不存在或已撤销'}});
  assert.deepEqual(JSON.parse(JSON.stringify(await p.shares({action:'get',code:'ZZZZ2222'}))),{ok:false,status:404,error:'分享课表不存在或已撤销'});
  assert.equal((await p.shares({action:'delete-everything'})).status,400);
  p.auth.isLoggedIn=false;const before=p.shareRequests.length;
  assert.equal((await p.shares({action:'mine'})).status,401);assert.equal(p.shareRequests.length,before);
});
