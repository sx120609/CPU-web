import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync, buildSync } = require('esbuild');

function compile(path) {
  const context = vm.createContext({ module: { exports: {} }, require: () => ({}), setTimeout, clearTimeout });
  vm.runInContext(transformSync(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/@Observed/g, ''),
    { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}

const rules = compile('../entry/src/main/ets/schedule/ScheduleOccurrences.ets');
const { NativeScheduleStore } = compile('../entry/src/main/ets/schedule/NativeScheduleStore.ets');
// The server's own rule, which writes the changes into every client's timetable.
const server = (() => {
  const shared = new URL('../../server/src/shared/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
  const out = buildSync({ stdin: { contents: "export * from './scheduleOccurrences'; export { courseEditKey } from './scheduleEdits';",
    resolveDir: shared, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node' });
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(out.outputFiles[0].text, context);
  return context.module.exports;
})();

const weeks = Array.from({ length: 4 }, (_, index) => {
  const days = Array.from({ length: 7 }, (_, day) => new Date(Date.UTC(2026, 8, 7 + index * 7 + day)).toISOString().slice(0, 10));
  return { week: index + 1, days, monday: days[0], sunday: days[6] };
});
const cells = () => {
  const list = [
    { day: 1, bigSlot: 1, courses: [{ name: '药理学', teacher: '王', location: 'A101', weeks: '1-4周', weekList: [1, 2, 3, 4], startSlot: 1, endSlot: 2 }] },
    { day: 2, bigSlot: 2, courses: [{ name: '药剂学', teacher: '李', location: 'B202', weeks: '2周', weekList: [2], startSlot: 3, endSlot: 4 }] },
  ];
  // The bridge hands each course the key the server finds it by.
  list.forEach(cell => cell.courses.forEach(course => { course.editKeys = [server.courseEditKey(cell.day, cell.bigSlot, course)]; }));
  return list;
};
const k1 = () => cells()[0].courses[0].editKeys[0];
const k2 = () => cells()[1].courses[0].editKeys[0];

test('the long-press menu follows iOS for own, moved, cancelled and somebody else\'s courses', () => {
  const ids = input => JSON.parse(JSON.stringify(rules.courseMenuActions({ partner: false, cancelled: false, moved: false, editable: true, occurrences: true,
    date: '2026-09-07', adjusted: false, agenda: true, ...input }).map(action => action.id)));
  assert.deepEqual(ids({}), ['detail', 'edit', 'adjust', 'cancel', 'agenda']);
  assert.deepEqual(ids({ moved: true }), ['detail', 'readjust', 'restore', 'agenda']);
  assert.deepEqual(ids({ cancelled: true }), ['restore', 'detail']);
  assert.deepEqual(ids({ partner: true }), ['detail']);
  // A site without single-meeting changes, a day off or make-up day, a graduate timetable.
  assert.deepEqual(ids({ occurrences: false }), ['detail', 'edit', 'agenda']);
  assert.deepEqual(ids({ adjusted: true }), ['detail', 'edit', 'agenda']);
  assert.deepEqual(ids({ editable: false, agenda: false }), ['detail']);
});

test('dates read as month, day and weekday', () => {
  assert.equal(rules.occurrenceDateText('2026-11-12'), '11月12日 周四');
  assert.equal(rules.occurrenceDateText('bad'), 'bad');
});

test('a 调整这一次 form writes only what differs', () => {
  const move = rules.occurrenceMove('k', '2026-09-07', '2026-09-09', 5, 6, 1, 2, 'A101', 'A101', '');
  assert.deepEqual({ ...move }, { key: 'k', date: '2026-09-07', toDate: '2026-09-09', startSlot: 5, endSlot: 6 });
  const same = rules.occurrenceMove('k', '2026-09-07', '2026-09-07', 1, 2, 1, 2, 'A101', 'A101', '');
  assert.equal(rules.occurrenceChangesNothing(same), true);
  assert.equal(rules.occurrenceMove('k', 'd', 'd', 1, 2, 1, 2, '线上', 'A101', '').location, '线上');
});

test('cancelled and moved meetings are written in as the server does it', () => {
  const changes = [{ key: k1(), date: '2026-09-14', cancelled: true },
    { key: k2(), date: '2026-09-15', toDate: '2026-09-17', startSlot: 9, endSlot: 10, location: 'C301' }];
  const mine = rules.applyOccurrencesToCells(cells(), changes, weeks);
  const theirs = server.applyOccurrenceChanges(cells(), changes, weeks);
  const shape = list => list.map(cell => ({ day: cell.day, bigSlot: cell.bigSlot,
    courses: cell.courses.map(course => ({ name: course.name, weekList: course.weekList, startSlot: course.startSlot,
      endSlot: course.endSlot, location: course.location, occurrenceKey: course.occurrenceKey, occurrenceFrom: course.occurrenceFrom })) }))
    .sort((a, b) => a.day - b.day || a.bigSlot - b.bigSlot);
  assert.deepEqual(JSON.parse(JSON.stringify(shape(mine))), JSON.parse(JSON.stringify(shape(theirs))));
  // 药剂学 only met in week 2: moving that meeting leaves no weekly row behind.
  assert.equal(mine.filter(cell => cell.day === 2).length, 0);
});

test('the store draws a cancelled meeting in place and knows the site keeps changes', () => {
  const store = new NativeScheduleStore();
  const requests = [];
  store.attach(request => requests.push(request), () => {});
  store.markBridgeReady();
  const changes = [{ key: k1(), date: '2026-09-14', cancelled: true }];
  const data = { currentSemester: 'fall', currentWeek: '2', semesters: [{ value: 'fall', label: '秋', current: true }],
    weeks: weeks.map(week => ({ value: String(week.week), label: '', current: week.week === 2 })),
    cells: rules.applyOccurrencesToCells(cells(), changes, weeks) };
  store.acceptResult(requests.at(-1).id, JSON.stringify({ version: 1, completeSemester: true, fetchedAt: Date.now(),
    auth: { authenticated: true }, data, calendar: { currentWeek: 2, semesterStart: '', semesterEnd: '', weeks }, occurrenceChanges: changes }));
  assert.equal(store.occurrencesEditable(), true);
  assert.equal(store.displayBlocks(1).length, 0);
  const ghosts = store.cancelledBlocks(1);
  assert.equal(ghosts.length, 1);
  assert.equal(ghosts[0].course.name, '药理学');
  assert.equal(ghosts[0].cancelled.date, '2026-09-14');
  assert.deepEqual([ghosts[0].startSlot, ghosts[0].endSlot], [1, 2]);
  assert.deepEqual(JSON.parse(JSON.stringify(rules.cancelledKeysOf(ghosts[0]))), [k1()]);
  // Merged rows keep every edit key.
  assert.deepEqual(JSON.parse(JSON.stringify(store.blocksInWeek(data.cells, 1, 3)[0].course.editKeys)), [k1()]);
});

test('the bridge saves one change per merged row and clears them on restore', async () => {
  const source = readFileSync(new URL('../bridge/editor.ts', import.meta.url), 'utf8');
  assert.match(source, /payload\.action === 'occurrence'/);
  assert.match(source, /normalizeOccurrenceChanges\(\[\.\.\.kept, \.\.\.added\]\)/);
  const moved = rules.movedKeys([{ key: 'a', date: 'd', toDate: 'e', startSlot: 1, endSlot: 2 },
    { key: 'b', date: 'd', toDate: 'e', startSlot: 1, endSlot: 2 }, { key: 'c', date: 'd', cancelled: true }], 'a', 'd');
  assert.deepEqual(JSON.parse(JSON.stringify(moved)), ['a', 'b']);
});
