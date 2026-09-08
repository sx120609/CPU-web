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
  return { service, values, updates, setFetch: fn => fetcher=fn, advance: ms => now+=ms, payload };
}
const endpoint = account => `https://cputime.cn/api/jwxt/schedule-widget/${account}`;
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
