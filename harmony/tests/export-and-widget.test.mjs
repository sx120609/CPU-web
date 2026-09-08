import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
function compile(path, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const context = vm.createContext({ module: { exports: {} }, ...globals });
  vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}

const exporter = compile('../entry/src/main/ets/schedule/ScheduleExport.ets');
const course = { startSlot: 1, endSlot: 2, course: { name: '药学;讲座,及实验\\演示\n' + '课程'.repeat(35), teacher: '老师', location: 'B311' } };
const sampleStore = () => ({
  selectedWeek: '2', selectedSemester: '2026-2027-1',
  calendar: { weeks: [{ week: 2, days: ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13'] }] },
  blocksForDay: day => day === 1 ? [course] : [], dayDate: () => '09-07'
});
test('calendar export uses real dates, China timezone, escaped and byte-folded text', () => {
  const ics = exporter.scheduleCalendar(sampleStore());
  assert.match(ics, /DTSTART:20260907T000000Z/);
  assert.match(ics, /DTEND:20260907T014000Z/);
  assert.match(ics.replace(/\r\n /g,''), /SUMMARY:药学\\;讲座\\,及实验\\\\演示\\n/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});
test('calendar export refuses missing dates and invalid slots', () => {
  assert.throws(() => exporter.scheduleCalendar({ ...sampleStore(), calendar: undefined }), /明确日期/);
  assert.throws(() => exporter.scheduleCalendar({ ...sampleStore(), blocksForDay: () => [{ ...course, endSlot: 99 }] }), /节次/);
});
test('text share is the selected week and contains no subscription or login secrets', () => {
  const text = exporter.scheduleText(sampleStore());
  assert.match(text, /第 2 周/); assert.match(text, /08:00–09:40/); assert.match(text, /B311/);
  assert.doesNotMatch(text, /token|Cookie|https:/i);
});

function widgetHarness() {
  const values = new Map(); const updates = [];
  let now = Date.now(); let fetcher;
  class Clock extends Date { static now() { return now; } }
  const prefs = { get: async (key,fallback) => values.has(key) ? values.get(key) : fallback,
    put: async (key,value) => { values.set(key,value); }, delete: async key => { values.delete(key); }, flush: async () => {} };
  const mocks = {
    '@ohos.data.preferences': { getPreferences: async () => prefs },
    '@ohos.net.http': { RequestMethod:{GET:0}, HttpDataType:{STRING:0}, createHttp: () => ({request: (...args) => fetcher(...args), destroy() {} }) },
    '@kit.FormKit': { formBindingData:{createFormBindingData: x => x}, formProvider:{updateForm: async (id,binding) => updates.push(binding)} },
  };
  const service = compile('../entry/src/main/ets/common/ScheduleWidgetService.ets', { Date:Clock, require: id => {
    if (!(id in mocks)) throw Error('unexpected import '+id); return mocks[id];
  } });
  const payload = { title:'我的课表', currentWeek:2, today:{label:'今天',date:'2026-09-08',courses:[{name:'账号甲课程',startTime:'08:00',endTime:'09:40',location:'A101'}]} };
  fetcher = async () => ({ responseCode:200, result:JSON.stringify({code:0,data:payload}) });
  return { service, values, updates, setFetch: fn => fetcher=fn, advance: ms => now+=ms, setNow: value => now=value, payload };
}
const endpoint = account => `https://cputime.cn/api/jwxt/schedule-widget/${account}`;

test('concurrent gallery registrations preserve every card size and layout', async () => {
  const h = widgetHarness();
  const cards = [2, 3, 4, 2, 3, 3, 4, 4];
  await Promise.all(cards.map((dimension, index) => h.service.registerScheduleForm({}, String(index), dimension, 'schedule')));
  const records = JSON.parse(h.values.get('forms'));
  assert.equal(records.length, cards.length);
  for (let index = 0; index < cards.length; index++) {
    assert.equal(records.find(record => record.id === String(index)).dimension, cards[index]);
  }
  await Promise.all([h.service.removeScheduleForm({}, '0'), h.service.registerScheduleForm({}, '8', 3, 'schedule_today')]);
  const updated = JSON.parse(h.values.get('forms'));
  assert.equal(updated.length, cards.length);
  assert.equal(updated.some(record => record.id === '0'), false);
  assert.equal(updated.find(record => record.id === '8').formName, 'schedule_today');
});
test('widget endpoint changes erase prior-account offline data', async () => {
  const h=widgetHarness(); await h.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('A')}));
  await h.service.refreshScheduleForm({},'card',2); assert.ok(h.values.has('cached_payload'));
  await h.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('B')}));
  h.setFetch(async()=>{throw Error('network');}); await h.service.refreshScheduleForm({},'card',2);
  assert.equal(h.values.has('cached_payload'),false); assert.equal(h.updates.at(-1).state,'failed');
});
test('widget network failure can use only fresh cache belonging to its endpoint', async () => {
  const h=widgetHarness(); await h.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('A')}));
  await h.service.refreshScheduleForm({},'card',2); h.setFetch(async()=>{throw Error('network');});
  await h.service.refreshScheduleForm({},'card',2); assert.notEqual(h.updates.at(-1).state,'failed');
  h.advance(13*60*60*1000); await h.service.refreshScheduleForm({},'card',2); assert.equal(h.updates.at(-1).state,'failed');
});
test('widget auth rejection erases offline payload instead of redisplaying it later', async () => {
  const h=widgetHarness(); await h.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('A')}));
  await h.service.refreshScheduleForm({},'card',2);
  h.setFetch(async()=>({responseCode:401,result:JSON.stringify({code:401})}));
  await h.service.refreshScheduleForm({},'card',2); assert.equal(h.updates.at(-1).state,'unauthorized');
  assert.equal(h.values.has('cached_payload'),false);
});

test('an HTTP auth rejection with an HTML body still clears cached private courses',async()=>{
  const h=widgetHarness(); await h.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('A')}));
  await h.service.refreshScheduleForm({},'card',2);
  h.setFetch(async()=>({responseCode:403,result:'<html>Forbidden</html>'}));
  await h.service.refreshScheduleForm({},'card',2);
  assert.equal(h.updates.at(-1).state,'unauthorized'); assert.equal(h.values.has('cached_payload'),false);
});
test('clearing account while widget fetch is pending rejects its late result', async () => {
  const h=widgetHarness(); await h.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('A')}));
  let finish; let started;
  const ready = new Promise(resolve=>started=resolve);
  h.setFetch(()=>new Promise(resolve=>{finish=resolve;started();}));
  const task = h.service.refreshScheduleForm({},'card',2); await ready;
  await h.service.clearScheduleWidgetAccount({});
  finish({responseCode:200,result:JSON.stringify({code:0,data:h.payload})}); await task;
  assert.equal(h.values.has('cached_payload'),false); assert.equal(h.updates.length,0);
});

function localDate(offset = 0) {
  const day = new Date(2026, 8, 8 + offset, 20, 0);
  return { now: day.getTime(), date: `2026-09-${String(8 + offset).padStart(2, '0')}` };
}
async function calendarHarness() {
  const h = widgetHarness(); h.setNow(localDate().now);
  const course = index => ({ name:`课程${index}`, startTime:`${String(8 + index).padStart(2,'0')}:00`,endTime:`${String(9 + index).padStart(2,'0')}:00`,location:'实验楼' });
  h.payload.strictDate=true;
  h.payload.today={date:localDate().date,label:'周二',courses:Array.from({length:8},(_,i)=>course(i))};
  h.payload.weekDays=[h.payload.today,{date:localDate(1).date,label:'周三',courses:[course(0),course(1)]}];
  h.payload.days=h.payload.weekDays;
  await h.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('A')}));
  return h;
}
test('tomorrow upcoming cards never mark morning courses completed tonight',async()=>{
  const h=await calendarHarness();
  await h.service.refreshScheduleForm({},'card',3,'schedule_upcoming');
  const value=h.updates.at(-1);
  assert.equal(value.layout,'upcoming'); assert.match(value.leftTitle,/9\.9/);
  assert.ok(JSON.parse(value.primaryCourses).every(course=>course.ended===false));
});
test('today large card displays seven rows while medium displays two and legacy large stays two-day',async()=>{
  const h=await calendarHarness(); h.setNow(new Date(2026,8,8,7).getTime());
  for(const [dimension,name,count,layout] of [[4,'schedule_today',7,'today'],[3,'schedule_today',2,'today'],[4,'schedule',5,'two-day'],[4,'schedule_two_day',5,'two-day']]){
    await h.service.refreshScheduleForm({},'card',dimension,name);
    assert.equal(h.updates.at(-1).layout,layout);
    assert.equal(JSON.parse(h.updates.at(-1).primaryCourses).length,count);
    assert.equal(h.updates.at(-1).primaryRemaining,8-count);
  }
});
test('widget windows sort real time before truncation without mutating the server payload',async()=>{
  const h=await calendarHarness(); h.setNow(new Date(2026,8,8,7).getTime());
  h.payload.today.courses.reverse(); const original=JSON.stringify(h.payload.today.courses);
  await h.service.refreshScheduleForm({},'card',3,'schedule_today');
  assert.deepEqual(JSON.parse(h.updates.at(-1).primaryCourses).map(row=>row.start),['08:00','09:00']);
  assert.equal(JSON.stringify(h.payload.today.courses),original);
});
test('form declarations expose all iOS desktop layout and size combinations',()=>{
  const {forms}=JSON.parse(readFileSync(new URL('../entry/src/main/resources/base/profile/form_config.json',import.meta.url),'utf8'));
  for(const [name,sizes] of [['schedule_upcoming',['2*2','2*4']],['schedule_today',['2*4','4*4']],['schedule_two_day',['4*4']]]){
    assert.deepEqual(forms.find(form=>form.name===name).supportDimensions,sizes);
  }
});

test('multicolor distinguishes the lecture and lab while repeated courses retain their color', async () => {
  const h = await calendarHarness(); h.setNow(new Date(2026,8,8,7).getTime());
  h.payload.today.courses = ['天然药物化学实验', '天然药物化学', '天然药物化学实验']
    .map((name, index) => ({name, startTime:`${8 + index}:00`, endTime:`${9 + index}:00`}));
  await h.service.refreshScheduleForm({}, 'card', 4, 'schedule_today');
  const rows = JSON.parse(h.updates.at(-1).primaryCourses);
  assert.notEqual(rows[0].accent, rows[1].accent);
  assert.equal(rows[0].accent, rows[2].accent);
  assert.notEqual(rows[0].tint, rows[1].tint);
});
