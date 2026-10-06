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
  vm.runInContext(transformSync(source.replace('@Observed', ''), { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}
// 编译一个 .ets 模块，相对路径的 import 也按真实源码编译，系统模块从 mocks 取。
function compileTree(path, mocks, globals = {}, cache = new Map()) {
  const url = new URL(path, import.meta.url);
  if (cache.has(url.href)) return cache.get(url.href);
  const exports = compile(url.href, { ...globals, require: id => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('.')) return compileTree(new URL(`${id}.ets`, url).href, mocks, globals, cache);
    throw Error('unexpected import ' + id);
  } });
  cache.set(url.href, exports);
  return exports;
}
// 测试里用 Node 自带的 ICU 农历代替 @ohos.i18n。
const lunarFormat = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' });
function intlLunar(date) {
  const [year, month, day] = date.split('-').map(Number);
  const parts = lunarFormat.formatToParts(new Date(Date.UTC(year, month - 1, day, 4)));
  const part = type => parts.find(item => item.type === type).value;
  const related = Number(part('relatedYear'));
  return { month: parseInt(part('month'), 10), day: Number(part('day')), isLeapMonth: /bis/.test(part('month')),
    cyclicalYear: ((related - 4) % 60 + 60) % 60 + 1 };
}
function memoryFs() {
  const files = new Map();
  const missing = path => { if (!files.has(path)) throw Error('ENOENT ' + path); };
  return { files, OpenMode: { CREATE: 1, READ_WRITE: 2, TRUNC: 4 },
    statSync: path => { missing(path); return { size: Buffer.byteLength(files.get(path)) }; },
    readTextSync: path => { missing(path); return files.get(path); },
    openSync: path => ({ fd: path }), writeSync: (fd, raw) => files.set(fd, raw), closeSync: () => {},
    renameSync: (from, to) => { missing(from); files.set(to, files.get(from)); files.delete(from); },
    unlinkSync: path => { missing(path); files.delete(path); } };
}

const exporter = compile('../entry/src/main/ets/schedule/ScheduleExport.ets');
const course = { startSlot: 1, endSlot: 2, course: { name: '药学;讲座,及实验\\演示\n' + '课程'.repeat(35), teacher: '老师', location: 'B311' } };
const sampleStore = () => ({
  selectedWeek: '2', selectedSemester: '2026-2027-1',
  calendar: { weeks: [{ week: 2, days: ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13'] }] },
  blocksForDay: day => day === 1 ? [course] : [], dayDate: () => '09-07',
  slotStart: slot => slot === 1 ? '08:00' : '', slotEnd: slot => slot === 2 ? '09:40' : ''
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

test('text and calendar exports use configured twelfth-period times', () => {
  const store = { ...sampleStore(), blocksForDay: day => day === 1 ? [{ ...course, startSlot: 12, endSlot: 12 }] : [],
    slotStart: slot => slot === 12 ? '21:10' : '', slotEnd: slot => slot === 12 ? '21:55' : '' };
  assert.match(exporter.scheduleText(store), /21:10–21:55/);
  const ics = exporter.scheduleCalendar(store);
  assert.match(ics, /DTSTART:20260907T131000Z/);
  assert.match(ics, /DTEND:20260907T135500Z/);
});

function widgetHarness() {
  const values = new Map(); const updates = []; const refreshes = [];
  let now = Date.now(); let fetcher;
  class Clock extends Date { static now() { return now; } }
  const prefs = { get: async (key,fallback) => values.has(key) ? values.get(key) : fallback,
    put: async (key,value) => { values.set(key,value); }, delete: async key => { values.delete(key); }, flush: async () => {} };
  const fs = memoryFs();
  const mocks = {
    '@ohos.data.preferences': { getPreferences: async () => prefs },
    '@ohos.file.fs': fs,
    '@ohos.i18n': { getCalendar: () => { throw Error('widget tests stub the lunar resolver'); } },
    './SystemLunarCalendar': { systemLunarDate: intlLunar },
    '@ohos.net.http': { RequestMethod:{GET:0}, HttpDataType:{STRING:0}, createHttp: () => ({request: (...args) => fetcher(...args), destroy() {} }) },
    '@kit.FormKit': { formBindingData:{createFormBindingData: x => x}, formProvider:{updateForm: async (id,binding) => updates.push(binding),
      setFormNextRefreshTime: async (id,minutes) => refreshes.push(minutes)} },
  };
  const service = compileTree('../entry/src/main/ets/common/ScheduleWidgetService.ets', mocks, { Date:Clock });
  const payload = { title:'我的课表', currentWeek:2, today:{label:'今天',date:'2026-09-08',courses:[{name:'账号甲课程',startTime:'08:00',endTime:'09:40',location:'A101'}]} };
  fetcher = async () => ({ responseCode:200, result:JSON.stringify({code:0,data:payload}) });
  return { service, values, updates, refreshes, fs, setFetch: fn => fetcher=fn, advance: ms => now+=ms, setNow: value => now=value, payload };
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
test('after the last class the header stays on today and the next course day is labelled and dimmed',async()=>{
  const h=await calendarHarness();
  await h.service.refreshScheduleForm({},'card',3,'schedule_upcoming');
  const value=h.updates.at(-1);
  assert.equal(value.layout,'upcoming'); assert.match(value.leftTitle,/9\.8/);
  assert.equal(value.mode,'ahead'); assert.equal(value.dayNote,'明天的课');
  assert.deepEqual([value.leadLabel,value.trailLabel],['第一节','接下来']);
  assert.ok(JSON.parse(value.primaryCourses).every(course=>course.ended===false));
  await h.service.refreshScheduleForm({},'card',4,'schedule_today');
  assert.equal(h.updates.at(-1).mode,'ahead'); assert.equal(JSON.parse(h.updates.at(-1).primaryCourses).length,2);
});
test('upcoming labels follow whether a class is in progress',async()=>{
  const h=await calendarHarness();
  for(const [hour,minute,labels] of [[7,30,['下一节','之后']],[8,30,['当前','接下来']],[9,0,['当前','接下来']],[9,30,['当前','接下来']]]){
    h.setNow(new Date(2026,8,8,hour,minute).getTime());
    await h.service.refreshScheduleForm({},'card',3,'schedule_upcoming');
    const value=h.updates.at(-1);
    assert.equal(value.mode,'today'); assert.equal(value.dayNote,'');
    assert.deepEqual([value.leadLabel,value.trailLabel],labels);
  }
});
test('today card greys finished classes while later classes remain',async()=>{
  const h=await calendarHarness(); h.setNow(new Date(2026,8,8,10,30).getTime());
  await h.service.refreshScheduleForm({},'card',4,'schedule_today');
  const rows=JSON.parse(h.updates.at(-1).primaryCourses);
  assert.equal(h.updates.at(-1).mode,'today');
  // 八节课放七行：先省掉最早下课的一节，另一节已下课的灰显留着。
  assert.deepEqual(rows.map(row=>row.ended),[true,false,false,false,false,false,false]);
  assert.equal(rows[0].start,'09:00');
  h.payload.today.courses=h.payload.today.courses.slice(0,3);
  await h.service.refreshScheduleForm({},'card',4,'schedule_today');
  assert.deepEqual(JSON.parse(h.updates.at(-1).primaryCourses).map(row=>row.ended),[true,true,false]);
});

function sparseHarness(courseDate) {
  const h = widgetHarness(); h.setNow(new Date(2026,8,26,20).getTime());
  const days = Array.from({length:22},(_,offset)=>{
    const date = new Date(2026,8,26+offset); const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    return { date:key, label:'周', courses: key===courseDate ? [{name:'药理学',startTime:'08:00',endTime:'09:40'}] : [] };
  });
  h.payload.strictDate=true; h.payload.today=days[0]; h.payload.days=days; h.payload.weekDays=days.slice(0,7);
  return h;
}
test('the next course day is searched 21 days ahead and falls back to the rest state',async()=>{
  const h=sparseHarness('2026-10-08');
  await h.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('A')}));
  await h.service.refreshScheduleForm({},'card',3,'schedule_upcoming');
  assert.equal(h.updates.at(-1).dayNote,'10/8 的课'); assert.match(h.updates.at(-1).leftTitle,/9\.26/);
  await h.service.refreshScheduleForm({},'card',4,'schedule_two_day');
  assert.equal(h.updates.at(-1).rightNote,'10/8 的课'); assert.match(h.updates.at(-1).rightTitle,/10\.8/);
  assert.equal(h.updates.at(-1).restTitle,'今日无课');
  const none=sparseHarness('2026-10-18');
  await none.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('A')}));
  await none.service.refreshScheduleForm({},'card',3,'schedule_upcoming');
  const rest=none.updates.at(-1);
  assert.equal(rest.mode,'rest'); assert.equal(rest.primaryCourses,'[]');
  // 没有发布的放假安排时按节日离线推算：国庆 10.1 - 10.3。
  assert.equal(rest.restTitle,'今日无课'); assert.equal(rest.lockLine,'距国庆节还有 5 天'); assert.equal(rest.badge,'');
  assert.equal(rest.restDetail,'距国庆节还有 5 天 · 10.1 - 10.3 · 休 3 天'); assert.equal(rest.lunar,'十六');
  await none.service.refreshScheduleForm({},'card',4,'schedule_two_day');
  assert.match(none.updates.at(-1).rightTitle,/9\.27/); assert.equal(none.updates.at(-1).rightNote,'');
});
test('published holidays drive the header badge, greeting and countdown',async()=>{
  const h=sparseHarness('');
  h.payload.holidays=[...Array.from({length:7},(_,i)=>({date:`2026-10-0${i+1}`,name:'国庆节'})),{date:'2027-01-01',name:'元旦'}];
  await h.service.saveScheduleWidgetConfiguration({},JSON.stringify({endpoint:endpoint('A')}));
  await h.service.refreshScheduleForm({},'card',3,'schedule_upcoming');
  let value=h.updates.at(-1);
  assert.equal(value.badge,''); assert.equal(value.restTitle,'今日无课');
  assert.equal(value.restDetail,'距国庆节还有 5 天 · 10.1 - 10.7 · 休 7 天'); assert.equal(value.lockLine,'距国庆节还有 5 天');
  h.setNow(new Date(2026,9,2,9).getTime());
  await h.service.refreshScheduleForm({},'card',3,'schedule_upcoming'); value=h.updates.at(-1);
  assert.equal(value.badge,'国庆节'); assert.equal(value.restTitle,'国庆快乐');
  assert.equal(value.restDetail,'假期 10.1 - 10.7 · 休 7 天'); assert.equal(value.lockLine,'国庆快乐');
  h.setNow(new Date(2027,0,1,9).getTime());
  await h.service.refreshScheduleForm({},'card',3,'schedule_upcoming'); value=h.updates.at(-1);
  assert.equal(value.restTitle,'元旦快乐'); assert.equal(value.restDetail,'');
  assert.doesNotMatch(JSON.stringify(h.updates),/周末快乐/);
});
test('cards schedule the next refresh at class boundaries, midnight or 30 minutes',async()=>{
  const h=await calendarHarness();
  for(const [hour,minute,expected] of [[7,0,30],[7,58,5],[8,50,11],[23,50,11]]){
    h.setNow(new Date(2026,8,8,hour,minute).getTime());
    await h.service.refreshScheduleForm({},'card',2,'schedule_upcoming');
    assert.equal(h.refreshes.at(-1),expected);
  }
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

test('multicolor picks the same course colours as the iOS widget and repeated courses keep theirs', async () => {
  const h = await calendarHarness(); h.setNow(new Date(2026,8,8,7).getTime());
  // 与 iOS 渲染图一致：药剂学蓝、药物分析金、免疫学红、人工智能药学青、药理学粉。
  const names = ['药剂学', '药物分析', '免疫学', '人工智能药学', '药理学', '药剂学'];
  h.payload.today.courses = names.map((name, index) => ({name, startTime:`${8 + index}:00`, endTime:`${9 + index}:00`}));
  await h.service.refreshScheduleForm({}, 'card', 4, 'schedule_today');
  const rows = JSON.parse(h.updates.at(-1).primaryCourses);
  assert.deepEqual(rows.map(row => row.colorIndex), [1, 4, 0, 3, 5, 1]);
  assert.deepEqual(rows.map(row => row.accent), ['#4A78F2', '#E0A224', '#E85B4B', '#17A69A', '#EC70A1', '#4A78F2']);
  assert.equal(rows[0].tint, '#EAF0FF');
  assert.equal(h.updates.at(-1).accent, '#0F8F7F');
});
test('two-day right column carries its own lunar date and the lock cards name the shown day', async () => {
  const h = await calendarHarness();
  await h.service.refreshScheduleForm({}, 'card', 4, 'schedule_two_day');
  let value = h.updates.at(-1);
  assert.equal(value.lunar, '廿七'); assert.equal(value.rightLunar, '廿八'); assert.equal(value.rightBadge, '');
  await h.service.refreshScheduleForm({}, 'card', 1, 'schedule_lock_rectangular');
  value = h.updates.at(-1);
  assert.equal(value.lockTitle, '明天 9.9 周三'); assert.equal(value.lockDay, '明天');
  h.setNow(new Date(2026,8,8,7).getTime());
  await h.service.refreshScheduleForm({}, 'card', 1, 'schedule_lock_inline');
  value = h.updates.at(-1);
  assert.equal(value.lockTitle, '9.8 周二'); assert.equal(value.lockDay, '周二');
});
