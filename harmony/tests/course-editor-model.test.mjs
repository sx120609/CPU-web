import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
const source = readFileSync(new URL('../entry/src/main/ets/schedule/NativeCourseEditor.ets', import.meta.url), 'utf8')
  .split('@Component')[0].replace('@Observed', '');
// The note filter of the real store, so the fake store below answers as the app does.
const storeContext = vm.createContext({ module: { exports: {} }, setTimeout, clearTimeout });
vm.runInContext(transformSync(readFileSync(new URL('../entry/src/main/ets/schedule/NativeScheduleStore.ets', import.meta.url), 'utf8')
  .replace('@Observed', ''), { loader: 'ts', format: 'cjs' }).code, storeContext);
const { scheduleCourseNote } = storeContext.module.exports;
function harness() {
  const timers = new Map(); const requests = []; let saved = 0;
  class Clock extends Date { static now() { return 42; } }
  const context = vm.createContext({ module: { exports: {} }, Date: Clock,
    setTimeout: callback => { const key=timers.size+1; timers.set(key,callback); return key; }, clearTimeout:key=>timers.delete(key) });
  vm.runInContext(transformSync(source,{loader:'ts',format:'cjs'}).code,context);
  const model = new context.module.exports.NativeCourseEditorModel();
  const priorities=[];
  model.attach((id,request)=>requests.push({id,request}),()=>saved++,(semester,priority)=>priorities.push({semester,priority}));
  const store={selectedSemester:'fall',selectedWeek:'2',selectedDay:2,result:{cells:[]},weekOptions:()=>[1,2,3].map(value=>({value:String(value)})),
    slots:()=>Array.from({length:12},(_,i)=>i+1),slotStart:slot=>`${String(slot+7).padStart(2,'0')}:00`,slotEnd:slot=>`${String(slot+7).padStart(2,'0')}:45`,
    displayPriorities:()=>({}),courseNote:course=>scheduleCourseNote(course?.sourceNote,course?.slotNote)};
  return {model,store,requests,timers,priorities,exports:context.module.exports,get saved(){return saved;}};
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

test('editor exposes the configured final period and submits a twelfth-period course unchanged', () => {
  const h = harness(); h.model.open(h.store);
  h.model.accept(h.requests.at(-1).id, JSON.stringify({ session: 'current' }));
  assert.equal(h.model.slots.at(-1), 12);
  const draft = h.model.arrangements[0];
  [...draft.slots].forEach(slot => h.model.toggleSlot(draft.id, slot));
  h.model.name = '第十二节课程'; h.model.toggleSlot(draft.id, 12);
  h.model.submit('save');
  assert.equal(h.requests.at(-1).request.form.startSlot, 12);
  assert.equal(h.requests.at(-1).request.form.endSlot, 12);
});

test('a tapped empty period opens a new course there, for this week only', () => {
  const h = harness(); h.model.open(h.store, undefined, 4, 7);
  const draft = h.model.arrangements[0];
  assert.deepEqual([draft.day, [...draft.slots], draft.weekMode, [...h.model.weekList(draft)]], [4, [7, 8], 'current', [2]]);
  h.model.cancel(); h.model.open(h.store, undefined, 6, 12);
  assert.deepEqual([...h.model.arrangements[0].slots], [12]);
});

test('several meeting times and periods that are not consecutive are sent as arrangements', () => {
  const h = harness(); h.model.open(h.store, undefined, 1, 1);
  h.model.accept(h.requests.at(-1).id, JSON.stringify({ session: 'current', priority: {} }));
  h.model.name = '实验课';
  const first = h.model.arrangements[0];
  h.model.toggleSlot(first.id, 5); h.model.toggleSlot(first.id, 6); h.model.toggleSlot(first.id, 9);
  assert.equal(h.model.slotSummary(h.model.arrangements[0].slots), '第 1–2、5–6、9 节 · 08:00–09:45、12:00–13:45、16:00–16:45');
  h.model.addArrangement();
  const second = h.model.arrangements[1];
  assert.deepEqual([second.day, [...second.slots], second.weekMode], [1, [], 'current']);
  h.model.submit('save');
  assert.match(h.model.error, /上课时间 2：请选择至少一节/); assert.equal(h.requests.length, 1);
  h.model.setDay(second.id, 3); h.model.toggleSlot(second.id, 3); h.model.setWeekMode(second.id, 'custom');
  h.model.setWeeks(second.id, []); h.model.submit('save');
  assert.match(h.model.error, /上课时间 2：请选择至少一个周次/);
  h.model.toggleWeek(second.id, 3); h.model.toggleWeek(second.id, 1); h.model.setWeekMode(first.id, 'all');
  h.model.preferred = true; h.model.submit('save');
  const form = h.requests.at(-1).request.form;
  assert.deepEqual(JSON.parse(JSON.stringify(form.arrangements)), [
    { day: 1, slots: [1, 2, 5, 6, 9], weekList: [1, 2, 3] }, { day: 3, slots: [3], weekList: [1, 3] }]);
  assert.deepEqual([form.day, form.startSlot, form.endSlot, [...form.weekList], form.preferred], [1, 1, 2, [1, 2, 3], true]);
  h.model.removeArrangement(second.id); assert.equal(h.model.arrangements.length, 1);
  h.model.removeArrangement(first.id); assert.equal(h.model.arrangements.length, 1);
});

// Values built inside the vm context have another realm's prototypes.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
test('conflicts name the other courses that share a period and a week, never the course being edited', () => {
  const h = harness();
  const cells = [
    { day: 2, bigSlot: 1, courses: [{ name: '药理学', weekList: [1, 2, 3], startSlot: 1, endSlot: 2, nativeId: 'a' }] },
    { day: 2, bigSlot: 2, courses: [{ name: '单周课', weekList: [1, 3], startSlot: 3, endSlot: 4 }, { name: '全周课', weekList: [], startSlot: 3, endSlot: 3 }] },
    { day: 3, bigSlot: 1, courses: [{ name: '别的天', weekList: [2], startSlot: 1, endSlot: 2 }] }];
  const conflicts = h.exports.courseArrangementConflicts;
  same([...conflicts(2, [2, 3], [2], cells)], ['药理学', '全周课']);
  same([...conflicts(2, [3], [1], cells)], ['单周课', '全周课']);
  same([...conflicts(2, [5], [1], cells)], []);
  const original = { day: 2, bigSlot: 1, startSlot: 1, endSlot: 2, course: cells[0].courses[0] };
  same([...conflicts(2, [1, 2], [], cells, original)], []);
  h.store.result = { cells }; h.store.displayPriorities = () => ({ '药理学': 2 });
  h.model.open(h.store, original);
  assert.equal(h.model.preferred, true); assert.equal(h.model.arrangements[0].weekMode, 'all');
  h.model.toggleSlot(h.model.arrangements[0].id, 3);
  same([...h.model.overlappingNames()], ['单周课', '全周课']);
  h.model.accept(h.requests.at(-1).id, JSON.stringify({ session: 's', priority: { '全周课': 3 } }));
  assert.equal(h.model.preferred, false);
  same(JSON.parse(JSON.stringify(h.priorities)), [{ semester: 'fall', priority: { '全周课': 3 } }]);
  same(h.exports.courseSlotRuns([9, 1, 2, 6, 5, 2]).map(run => [...run]), [[1, 2], [5, 6], [9, 9]]);
});

test('the note field holds what the person wrote, never the period label the timetable shows', () => {
  const h = harness();
  const open = course => { h.model.open(h.store, { day: 1, startSlot: 6, endSlot: 7, course: { name: '课程', weekList: [2], ...course } });
    h.model.accept(h.requests.at(-1).id, JSON.stringify({ session: 'current' })); };
  // A merged block: `slotNote` is the label drawn on the card, `sourceNote` what the course arrived with.
  open({ slotNote: '06-07节', sourceNote: '带实验报告' });
  assert.equal(h.model.note, '带实验报告');
  h.model.submit('save');
  assert.equal(h.requests.at(-1).request.form.note, '带实验报告');
  // Saving a course that never had a note sends none, so the bridge writes its own period label again.
  open({ slotNote: '06-07节', sourceNote: '06-07节' });
  assert.equal(h.model.note, '');
  h.model.submit('save');
  assert.equal(h.requests.at(-1).request.form.note, '');
  open({ slotNote: '06-07节', sourceNote: '第 6-7 节' });
  assert.equal(h.model.note, '');
  open({ slotNote: '06-07节' });
  assert.equal(h.model.note, '');
});
