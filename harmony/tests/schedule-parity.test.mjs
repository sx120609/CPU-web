// The timetable features brought over from the iOS client: display priority and lanes, the six
// styles' colours, "now", days off and make-up days, the month view's data and shared timetables.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { transformSync } = require('esbuild');

function compileTree(path, cache = new Map()) {
  const url = new URL(path, import.meta.url);
  if (cache.has(url.href)) return cache.get(url.href);
  const source = readFileSync(url, 'utf8').replace('@Observed', '');
  const context = vm.createContext({ module: { exports: {} }, setTimeout, clearTimeout,
    require: id => compileTree(new URL(`${id}.ets`, url).href, cache) });
  vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
  cache.set(url.href, context.module.exports);
  return context.module.exports;
}
// Values built inside the vm context have another realm's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));
const schedule = name => compileTree(`../entry/src/main/ets/schedule/${name}.ets`);
const placement = schedule('SchedulePlacement');
const style = schedule('ScheduleStyle');
const month = schedule('ScheduleMonth');
const sharing = schedule('ScheduleSharing');
const { NativeScheduleStore } = schedule('NativeScheduleStore');
const palettes = schedule('SchedulePalettes').SCHEDULE_PALETTES.map(item => item.key);

const block = (name, startSlot, endSlot, day = 1) => ({ day, bigSlot: Math.ceil(startSlot / 2), startSlot, endSlot, course: { name, weeks: '', weekList: [] } });
const shape = pieces => plain(pieces.map(piece => [piece.course.name, piece.startSlot, piece.endSlot, piece.lane, piece.lanes]));

test('courses of equal priority sit side by side and only an overlap cluster shares the width', () => {
  const pieces = placement.placeScheduleBlocks([block('甲', 1, 4), block('乙', 3, 4), block('丙', 5, 6), block('丁', 4, 5)], {});
  // 丁 chains 丙 to the first two, so all four share one cluster of three lanes; 丙 reuses the first lane.
  assert.deepEqual(shape(pieces), [['甲', 1, 4, 0, 3], ['乙', 3, 4, 1, 3], ['丁', 4, 5, 2, 3], ['丙', 5, 6, 0, 3]]);
  const apart = placement.placeScheduleBlocks([block('甲', 1, 2), block('乙', 3, 4), block('丙', 3, 4)], {});
  assert.deepEqual(shape(apart), [['甲', 1, 2, 0, 1], ['乙', 3, 4, 0, 2], ['丙', 3, 4, 1, 2]]);
  assert.deepEqual(plain(placement.overlappingCourseNames(block('甲', 1, 4), [block('甲', 1, 4), block('乙', 3, 4), block('丙', 5, 6)])), ['乙']);
});

test('a course set to show first covers the periods it shares and the other keeps what is left', () => {
  const long = block('长课', 3, 6);
  const pieces = placement.placeScheduleBlocks([long, block('优先', 5, 6)], { '优先': 1 });
  assert.deepEqual(shape(pieces), [['长课', 3, 4, 0, 1], ['优先', 5, 6, 0, 1]]);
  // Nothing is removed from the timetable: the piece still opens the whole course.
  assert.deepEqual([pieces[0].whole.startSlot, pieces[0].whole.endSlot], [3, 6]);
  assert.notEqual(pieces[0].id, pieces[1].id);
  const middle = placement.placeScheduleBlocks([block('长课', 1, 6), block('优先', 3, 4)], { '优先': 2, '长课': 1 });
  assert.deepEqual(shape(middle), [['长课', 1, 2, 0, 1], ['优先', 3, 4, 0, 1], ['长课', 5, 6, 0, 1]]);
  const hidden = placement.placeScheduleBlocks([block('短课', 3, 4), block('优先', 1, 6)], { '优先': 1 });
  assert.deepEqual(shape(hidden), [['优先', 1, 6, 0, 1]]);
  assert.equal(placement.schedulePriorityKey('  药理  学 '), '药理 学');
  assert.equal(placement.schedulePriorityValue('药理  学', { '药理 学': 3 }), 3);
  assert.equal(placement.schedulePriorityValue('别的', { '药理 学': 3 }), 0);
  assert.equal(placement.schedulePriorityTop({ a: 2, b: 7 }), 8);
  assert.equal(placement.schedulePriorityTop({}), 1);
});

test('unknown styles fall back to classic and every style describes itself', () => {
  assert.deepEqual(plain(style.SCHEDULE_STYLES), ['classic', 'minimal', 'grid', 'table', 'paper', 'board']);
  assert.equal(style.normalizeScheduleStyle('paper'), 'paper');
  assert.equal(style.normalizeScheduleStyle('neon'), 'classic');
  for (const id of style.SCHEDULE_STYLES) {
    assert.ok(style.scheduleStyleTitle(id).length === 2 && style.scheduleStyleSubtitle(id).length > 4, id);
    assert.ok(['rows', 'cells', 'table', 'sessions'].includes(style.scheduleStyleLayout(id).grid), id);
  }
  assert.deepEqual(plain(style.SCHEDULE_STYLES.map(id => style.scheduleStyleColumnGap(id))), [0, 4, 4, 0, 0, 0]);
  assert.deepEqual(plain(style.SCHEDULE_STYLES.filter(id => !style.scheduleStyleFramesPanel(id))), ['table', 'board']);
});

function composite(color, background) {
  if (color.length === 7) return color;
  const alpha = parseInt(color.slice(1, 3), 16) / 255;
  return '#' + [3, 5, 7].map((at, index) => Math.round(parseInt(color.slice(at, at + 2), 16) * alpha
    + parseInt(background.slice(1 + index * 2, 3 + index * 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

test('theme text and course text stay readable in every palette, style and appearance', () => {
  for (const palette of palettes) {
    for (const dark of [false, true]) {
      const text = style.scheduleThemeText(palette, dark);
      const canvases = dark ? ['#15181C', '#0E1012'] : ['#EDF4FF', '#F8FAFC', '#FFFFFF'];
      for (const canvas of canvases) {
        const panel = composite(style.scheduleStylePanelSurface(false, dark, 0), canvas);
        const today = composite(style.scheduleThemeTint(palette, dark ? 0.15 : 0.08), panel);
        for (const surface of [canvas, panel, today]) {
          assert.ok(style.scheduleContrast(text, surface) >= 4.45, `${palette} ${dark} theme text on ${surface}`);
        }
      }
      assert.ok(style.scheduleContrast('#FFFFFF', style.scheduleThemeFill(palette)) >= 4.45, `${palette} fill`);
      for (let index = 0; index < 40; index++) {
        const color = style.scheduleStyleCourseColor(`课程${index}`, palette);
        const page = dark ? '#15181C' : '#FFFFFF';
        const fill = composite(style.scheduleCourseFill(color, dark), composite(style.scheduleStylePanelSurface(false, dark, 0), page));
        assert.ok(style.scheduleContrast(style.scheduleCourseAccent(color, dark), fill) >= 4.5,
          `${palette} ${dark} course ${index}: ${style.scheduleCourseAccent(color, dark)} on ${fill}`);
      }
    }
  }
  for (const id of ['paper', 'board']) {
    for (const dark of [false, true]) {
      const canvas = style.scheduleStyleCanvas(id, dark);
      assert.ok(style.scheduleContrast(style.scheduleStyleInk(id, dark), canvas) >= 7, `${id} ink`);
      assert.ok(style.scheduleContrast(style.scheduleStyleAccent(id, dark, '#000000'), canvas) >= 4.5, `${id} accent`);
    }
  }
  // A course keeps its colour family on every client: the hue is the shared name hash.
  assert.equal(style.scheduleStyleCourseColor('药理学', 'color-glass').hue, style.scheduleStyleCourseColor(' 药理学 ', 'color-glass').hue);
  assert.equal(style.scheduleStyleCourseColor('甲', 'blue').hue, style.scheduleStyleCourseColor('乙', 'blue').hue);
});

test('"now" rests on a period, in a break, or nowhere outside the day', () => {
  const starts = ['08:00', '08:55', '10:00'];
  const ends = ['08:45', '09:40', '10:45'];
  assert.equal(style.scheduleNowOffset(7 * 60, starts, ends, 40, 4), -1);
  assert.equal(style.scheduleNowOffset(8 * 60, starts, ends, 40, 4), 0);
  assert.equal(style.scheduleNowOffset(8 * 60 + 50, starts, ends, 40, 4), 42);
  assert.equal(style.scheduleNowOffset(10 * 60 + 45, starts, ends, 40, 4), 128);
  assert.equal(style.scheduleNowOffset(11 * 60, starts, ends, 40, 4), -1);
  assert.equal(style.scheduleClockMinutes('08:05'), 485);
  assert.equal(style.scheduleClockMinutes('上午'), -1);
  assert.equal(style.scheduleMinutesNow(Date.UTC(2026, 9, 7, 2, 20)), 10 * 60 + 20);
  assert.equal(style.scheduleTodayDate(Date.UTC(2026, 9, 6, 16, 30)), '2026-10-07');
  assert.deepEqual(['08:00', '12:00', '18:30', ''].map(style.scheduleSession), ['上午', '下午', '晚上', '课程']);
  assert.deepEqual([1, 10, 12, 20, 21].map(style.scheduleNumeral), ['一', '十', '十二', '二十', '二十一']);
  assert.equal(style.scheduleCleanLocation(' @教学楼A101 '), '教学楼A101');
  assert.equal(style.scheduleSlotText(9, 9), '第 9 节');
  assert.equal(style.scheduleSlotText(5, 6), '第 5–6 节');
});

test('a course is finished, in progress with the minutes left, or counted down within the hour', () => {
  const today = { now: 10 * 60 + 20, completedBefore: 10 * 60 + 20 };
  assert.equal(style.scheduleCourseStatusLabel(today, '08:00', '09:45'), '已结束');
  assert.equal(style.scheduleCourseStatusLabel(today, '10:00', '11:45'), '正在上 · 还剩 85 分');
  assert.equal(style.scheduleCourseStatusLabel(today, '11:00', '11:45'), '40 分钟后');
  assert.equal(style.scheduleCourseStatusLabel(today, '13:30', '14:15'), '');
  assert.equal(style.scheduleCoursePhase({ now: -1, completedBefore: 24 * 60 }, '19:00', '19:45'), 'completed');
  assert.equal(style.scheduleCoursePhase({ now: -1, completedBefore: -1 }, '08:00', '08:45'), 'upcoming');
});

// ---- Store: days off, make-up days, weekends, priorities and the month selection ----

const weekDays = start => Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(2026, 8, start + index)).toISOString().slice(0, 10));
function loadedStore(adjustments = []) {
  const store = new NativeScheduleStore();
  store.attach(request => { if (request.id) store.acceptResult(request.id, JSON.stringify({
    version: 1, completeSemester: true, fetchedAt: Date.now(), auth: { authenticated: true },
    data: { currentSemester: 'fall', currentWeek: '2', semesters: [{ value: 'fall', label: '秋', current: true }],
      weeks: [1, 2, 3].map(week => ({ value: String(week), label: `第${week}周`, current: week === 2 })),
      cells: [
        { day: 1, bigSlot: 1, courses: [{ name: '周一课', weeks: '', weekList: [1, 2, 3], startSlot: 1, endSlot: 2 }] },
        { day: 4, bigSlot: 2, courses: [{ name: '周四课', weeks: '', weekList: [2], startSlot: 3, endSlot: 4 }] },
        { day: 6, bigSlot: 1, courses: [{ name: '周六课', weeks: '', weekList: [3], startSlot: 1, endSlot: 2 }] }] },
    calendar: { currentWeek: 2, semesterStart: '2026-09-07', semesterEnd: '2026-09-27', adjustments,
      weeks: [1, 2, 3].map(week => ({ week, days: weekDays(7 * week), monday: weekDays(7 * week)[0], sunday: weekDays(7 * week)[6] })) },
  })); }, () => {});
  store.markBridgeReady();
  return store;
}
const names = blocks => plain(blocks.map(item => item.course.name));

test('a day off shows nothing and a make-up day shows the courses of the day it takes over', () => {
  const store = loadedStore([{ date: '2026-09-14', kind: 'off', note: '校运动会' }, { date: '2026-09-19', kind: 'swap', source: '2026-09-17' },
    { date: '2026-09-20', kind: 'swap' }, { date: '2026-09-15', kind: 'holiday-eve' }]);
  assert.equal(store.rawDate(1), '2026-09-14');
  assert.deepEqual(names(store.blocksForDay(1)), ['周一课']);
  assert.deepEqual(names(store.displayBlocks(1)), []);
  assert.deepEqual(names(store.displayBlocks(6)), ['周四课']);
  assert.deepEqual(names(store.displayBlocks(7)), []);
  assert.equal(store.adjustment(2), undefined);
  // A new course on the make-up day belongs to the weekday being made up.
  assert.deepEqual(plain(store.effectiveSlot(6)), { week: 2, day: 4 });
  assert.deepEqual(plain(store.effectiveSlot(3)), { week: 2, day: 3 });
  assert.deepEqual(names(store.blocksOnDate('2026-09-07')), ['周一课']);
  assert.deepEqual(names(store.blocksOnDate('2026-09-14')), []);
  assert.deepEqual(names(store.blocksOnDate('2026-09-19')), ['周四课']);
  assert.deepEqual(names(store.blocksOnDate('2026-12-01')), []);
  assert.deepEqual(plain(store.dateSlot('2026-09-26')), { week: 3, day: 6 });
  assert.equal(store.dateSlot('2026-12-01'), undefined);
});

test('with weekends hidden, a weekend day that has classes or is adjusted still shows', () => {
  const store = loadedStore([{ date: '2026-09-20', kind: 'off' }]);
  assert.deepEqual(plain(store.visibleDays()), [1, 2, 3, 4, 5, 6, 7]);
  store.showWeekend = false;
  assert.deepEqual(plain(store.visibleDays()), [1, 2, 3, 4, 5, 7]);
  store.selectWeek('3');
  assert.deepEqual(plain(store.visibleDays()), [1, 2, 3, 4, 5, 6]);
  store.selectWeek('1');
  assert.deepEqual(plain(store.visibleDays()), [1, 2, 3, 4, 5]);
  assert.equal(store.previewWeek('3').showWeekend, false);
});

test('display priorities are kept per semester, survive a restart and are dropped with the account', () => {
  const store = loadedStore();
  const saved = []; let notified = 0;
  store.attach(() => {}, () => notified++);
  store.attachPriorityPersistence(raw => saved.push(raw));
  store.setPriorities('fall', { '周一课': 2, '零': 0, '小数': 1.5, '': 4 });
  assert.deepEqual(plain(store.displayPriorities()), { '周一课': 2 });
  assert.equal(saved.at(-1), '{"fall":{"周一课":2}}');
  const revision = store.priorityRevision;
  store.setPriorities('fall', { '周一课': 2 });
  assert.equal(store.priorityRevision, revision); assert.equal(notified, 1); assert.equal(saved.length, 1);
  store.setPriorities('spring', { '别的学期': 1 });
  assert.deepEqual(plain(store.displayPriorities()), { '周一课': 2 });
  const restored = new NativeScheduleStore();
  restored.restorePriorities(saved.at(-1)); restored.restorePriorities('not json');
  restored.selectedSemester = 'spring';
  assert.deepEqual(plain(restored.displayPriorities()), { '别的学期': 1 });
  store.setPriorities('fall', {});
  assert.equal(saved.at(-1), '{"spring":{"别的学期":1}}');
  store.handleAuthChanged('user-2:undergraduate');
  assert.equal(saved.at(-1), '');
  const shared = new NativeScheduleStore(); shared.readOnly = true;
  shared.setPriorities('fall', { a: 1 });
  assert.deepEqual(plain(shared.displayPriorities()), {});
  assert.equal(shared.canEdit(), false);
});

test('the month view remembers its selection and opens a day in its own teaching week', () => {
  const store = loadedStore();
  store.selectDay(4); store.setViewMode('month');
  assert.equal(store.viewMode, 'month');
  // The run date is outside the fixture term, so the day selected in the week on screen is used.
  assert.equal(store.selectedDate, '2026-09-17'); assert.equal(store.monthAnchor, '2026-09-17');
  store.moveMonth(1); assert.equal(store.monthAnchor, '2026-10-01');
  store.moveMonth(-2); assert.equal(store.monthAnchor, '2026-08-01');
  store.selectDate('2026-09-26'); assert.equal(store.monthAnchor, '2026-09-26');
  assert.equal(store.openDate('2026-12-01'), false);
  assert.equal(store.openDate('2026-09-26'), true);
  assert.deepEqual([store.viewMode, store.selectedWeek, store.selectedDay], ['day', '3', 6]);
  assert.equal(store.completeSnapshot().data.currentSemester, 'fall');
  store.setViewMode('agenda'); assert.equal(store.viewMode, 'week');
});

test('a month fills whole weeks from Monday and carries weeks, adjustments and courses', () => {
  const days = month.buildScheduleMonth('2026-10-07',
    date => ({ subtitle: date === '2026-10-01' ? '国庆节' : '', isFestival: date === '2026-10-01', isStatutoryHoliday: date === '2026-10-01' }),
    date => date === '2026-10-05' ? 5 : 0, date => date === '2026-10-12' ? 'off' : '',
    date => date === '2026-10-07' ? [block('药剂学', 5, 6, 3)] : []);
  assert.equal(days.length, 35);
  assert.deepEqual([days[0].date, days[0].inMonth, days[0].weekday], ['2026-09-28', false, 1]);
  assert.deepEqual([days[34].date, days[34].inMonth, days[34].weekday], ['2026-11-01', false, 7]);
  const day = date => days.find(item => item.date === date);
  assert.deepEqual([day('2026-10-01').subtitle, day('2026-10-01').isStatutoryHoliday, day('2026-10-05').week], ['国庆节', true, 5]);
  assert.equal(day('2026-10-12').adjustmentKind, 'off');
  assert.equal(day('2026-10-07').courses[0].course.name, '药剂学');
  assert.equal(month.scheduleMonthRows(days).length, 5);
  assert.equal(month.buildScheduleMonth('2027-02-10', () => ({ subtitle: '', isFestival: false, isStatutoryHoliday: false }), () => 0, () => '', () => []).length, 28);
  assert.equal(month.buildScheduleMonth('bad', () => ({}), () => 0, () => '', () => []).length, 0);
  assert.equal(month.scheduleMonthTitle('2026-10-07'), '2026 年 10 月');
  assert.equal(month.schedulePaperMonthTitle('2026-10-07'), '二〇二六年 · 十月');
  assert.equal(month.scheduleSelectedDateTitle('2026-10-07'), '10 月 7 日 · 周三');
  assert.equal(month.scheduleShortCourseName('生物药剂学与药物动力学'), '生物药…');
  assert.equal(month.scheduleShortCourseName('药理学'), '药理学');
  // A one-period course reads 第 9 节, not 第 9-9 节.
  assert.equal(month.scheduleMonthSlotLabel(9, 9), '第 9 节');
  assert.equal(month.scheduleMonthSlotLabel(5, 6), '第 5-6 节');
  assert.equal(month.scheduleAdjustmentText({ date: '2026-10-12', kind: 'off' }), '放假，不上课');
  assert.equal(month.scheduleAdjustmentText({ date: '2026-10-12', kind: 'off', note: ' 校运动会 ' }), '校运动会');
  assert.equal(month.scheduleAdjustmentText({ date: '2026-10-17', kind: 'swap', source: '2026-10-15' }), '上 10.15 的课');
  assert.equal(month.scheduleAdjustmentText({ date: '2026-10-17', kind: 'swap' }), '补班，课程待确认');
});

// ---- Shared timetables ----

test('a share code is read out of whatever was typed or pasted', () => {
  assert.equal(sharing.normalizedShareCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(sharing.normalizedShareCode('https://cputime.cn/schedule/share/abcd2345?from=app#top'), 'ABCD2345');
  assert.equal(sharing.normalizedShareCode('我的课表分享码：ABCD2345'), '');
  assert.equal(sharing.normalizedShareCode('ABCD234'), '');
  // 0 and 1 are not in the alphabet the server draws codes from.
  assert.equal(sharing.normalizedShareCode('ABCD2340'), '');
  assert.equal(sharing.normalizedShareCode('ABCD2341'), '');
});

test('a week listed from Sunday, or with days missing, is read Monday first', () => {
  const monday = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
  assert.deepEqual(plain(sharing.mondayFirstDays(monday)), monday);
  assert.deepEqual(plain(sharing.mondayFirstDays(['2026-09-06', ...monday.slice(0, 6)])), monday);
  assert.deepEqual(plain(sharing.mondayFirstDays(['', '', '2026-09-09'])), monday);
  assert.deepEqual(plain(sharing.mondayFirstDays(['2026-02-30', 'x'])), []);
});

const shareDocument = () => ({
  code: 'abcd2345', owner: ' 阿青 ', semester: '2026-2027-1', courseCount: 2, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-06T12:30:00.000Z',
  schedule: { cells: [
    { day: 1, bigSlot: 1, courses: [{ name: ' 药理学 ', teacher: '王老师', weeks: '1-2周', weekList: [2, 1, 2, 99, 0], startSlot: 1, endSlot: 2,
      sourceKey: 'jwxt|secret', customId: 'custom-1', nativeId: 'source:1' }, { name: '   ' }] },
    { day: 9, bigSlot: 1, courses: [{ name: '星期九' }] }, { day: 2, bigSlot: 40, courses: [{ name: '第四十大节' }] },
    { day: 3, bigSlot: 2, courses: [{ name: '倒着的节次', weekList: [], startSlot: 30, endSlot: 3 }] }] },
  calendar: { semesterStart: '2026-09-07', semesterEnd: '2026-09-20',
    weeks: [{ week: 2, days: ['2026-09-13', '2026-09-14'] }, { week: 1, days: ['2026-09-07'] }, { week: 0, days: ['2026-08-31'] }, { week: 3, days: [] }],
    periods: [{ id: 1, name: '第1节', start: '08:00', end: '08:45' }, { number: 2, startTime: '08:55', endTime: '09:40' }, { id: 99, start: '1', end: '2' }],
    adjustments: [{ date: '2026-09-12', kind: 'off', note: '运动会' }, { date: '2026-09-13', kind: 'party' }, { date: 'soon', kind: 'off' }] },
});

test('a downloaded share is clamped to what a grid can draw and leaves edit identities behind', () => {
  const shared = sharing.readSharedSchedule(shareDocument(), 1000);
  assert.deepEqual(plain(shared.meta), { code: 'ABCD2345', owner: '阿青', semester: '2026-2027-1', courseCount: 2,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-06T12:30:00.000Z' });
  assert.deepEqual(plain(shared.cells), [
    { day: 1, bigSlot: 1, courses: [{ name: '药理学', weeks: '1-2周', weekList: [1, 2], teacher: '王老师', startSlot: 1, endSlot: 2 }] },
    { day: 3, bigSlot: 2, courses: [{ name: '倒着的节次', weeks: '', weekList: [], startSlot: 20, endSlot: 20 }] }]);
  assert.deepEqual(plain(shared.calendar.weeks.map(week => [week.week, week.monday, week.sunday])),
    [[1, '2026-09-07', '2026-09-13'], [2, '2026-09-14', '2026-09-20']]);
  assert.deepEqual(plain(shared.calendar.periods), [{ id: 1, name: '第1节', start: '08:00', end: '08:45' }, { id: 2, name: '第2节', start: '08:55', end: '09:40' }]);
  assert.deepEqual(plain(shared.calendar.adjustments), [{ date: '2026-09-12', kind: 'off', note: '运动会' }]);
  assert.equal(sharing.sharedScheduleName(shared), '阿青');
  assert.equal(sharing.sharedScheduleName({ ...shared, remark: ' 室友 ' }), '室友');
  assert.equal(sharing.sharedScheduleName({ ...shared, meta: { ...shared.meta, owner: '同学' } }), '共享课表');
  const empty = shareDocument(); empty.schedule.cells = [{ day: 1, bigSlot: 1, courses: [{ name: '' }] }];
  assert.throws(() => sharing.readSharedSchedule(empty, 0), /没有课程/);
  const uncalendared = shareDocument(); uncalendared.calendar.weeks = [];
  assert.throws(() => sharing.readSharedSchedule(uncalendared, 0), /没有校历/);
  const huge = shareDocument();
  huge.schedule.cells = [{ day: 1, bigSlot: 1, courses: Array.from({ length: 700 }, (_, index) => ({ name: `课${index}` })) }];
  assert.equal(sharing.readSharedSchedule(huge, 0).cells[0].courses.length, sharing.SHARED_SCHEDULE_MAX_COURSES);
});

test('a share opens read-only on the publisher\'s calendar, in the week today falls in', () => {
  const shared = sharing.readSharedSchedule(shareDocument(), 1000);
  assert.equal(sharing.sharedScheduleWeek(shared, '2026-09-01'), 1);
  assert.equal(sharing.sharedScheduleWeek(shared, '2026-09-16'), 2);
  assert.equal(sharing.sharedScheduleWeek(shared, '2026-12-01'), 2);
  assert.equal(sharing.shareDateKey(Date.UTC(2026, 8, 15, 16, 30)), '2026-09-16');
  const snapshot = sharing.sharedScheduleSnapshot(shared, Date.UTC(2026, 8, 16, 4));
  assert.deepEqual([snapshot.completeSemester, snapshot.source, snapshot.data.currentSemester, snapshot.data.currentWeek, snapshot.calendar.currentWeek],
    [true, 'shared', 'share:ABCD2345', '2', 2]);
  const store = new NativeScheduleStore();
  store.readOnly = true;
  let persisted = 0; store.attachPersistence(() => persisted++);
  store.attach(request => { if (request.id) store.acceptResult(request.id, JSON.stringify(snapshot)); }, () => {});
  store.markBridgeReady();
  assert.deepEqual([store.status, store.selectedWeek, store.source, store.canEdit(), store.slotCount()], ['loaded', '2', 'shared', false, 2]);
  assert.deepEqual(plain(store.semesterOptions()), [{ value: 'share:ABCD2345', label: '阿青', current: true }]);
  store.selectWeek('1');
  assert.deepEqual(names(store.displayBlocks(1)), ['药理学']);
  assert.deepEqual(names(store.displayBlocks(6)), []);
  // Somebody else's timetable never reaches the cache that the cards and the cold start read.
  assert.equal(persisted, 0);
});

test('publishing sends only what a reader needs, in the shape the Web share page reads', () => {
  const store = loadedStore([{ date: '2026-09-14', kind: 'off', note: '校运动会' }]);
  const snapshot = store.completeSnapshot();
  snapshot.data.cells[0].courses[0] = { ...snapshot.data.cells[0].courses[0], sourceKey: 'jwxt|1', customId: 'custom-1', nativeId: 'n', teacher: '王老师' };
  const body = plain(sharing.sharePublishBody(snapshot, store.periods));
  assert.deepEqual(Object.keys(body).sort(), ['calendar', 'schedule', 'semester']);
  assert.equal(body.semester, 'fall');
  assert.deepEqual(body.schedule.cells[0], { day: 1, bigSlot: 1, courses: [{ name: '周一课', weeks: '', weekList: [1, 2, 3], teacher: '王老师', startSlot: 1, endSlot: 2 }] });
  assert.deepEqual([body.schedule.scope, body.schedule.semesters, body.schedule.currentWeek, body.calendar.currentWeek], ['semester', [], '1', 1]);
  assert.deepEqual(body.schedule.weeks[1], { value: '2', label: '第 2 周', current: false });
  assert.deepEqual(body.calendar.periods[0], { id: 1, name: '第1节', start: '08:00', end: '08:45' });
  assert.deepEqual(body.calendar.adjustments, [{ date: '2026-09-14', kind: 'off', note: '校运动会' }]);
  assert.equal(body.calendar.weeks.length, 3);
  // What was published reads back as the same timetable.
  const back = sharing.readSharedSchedule({ code: 'ABCD2345', semester: 'fall', ...body }, 0);
  assert.deepEqual(names(back.cells.flatMap(cell => cell.courses.map(course => ({ course })))), ['周一课', '周四课', '周六课']);
  assert.throws(() => sharing.sharePublishBody(undefined, []), /整学期课表还没有加载完/);
  assert.throws(() => sharing.sharePublishBody({ ...snapshot, completeSemester: false }, []), /整学期课表还没有加载完/);
  assert.throws(() => sharing.sharePublishBody({ ...snapshot, calendar: { ...snapshot.calendar, weeks: [] } }, []), /校历/);
  assert.throws(() => sharing.sharePublishBody({ ...snapshot, data: { ...snapshot.data, cells: [] } }, []), /没有课程/);
});

test('the saved library keeps remarks across updates, marks withdrawn shares and starts over for another account', () => {
  const shared = sharing.readSharedSchedule(shareDocument(), 1000);
  let library = sharing.libraryAdopt(sharing.emptySharedLibrary(), 'user-1');
  library = sharing.librarySave(library, shared, '  室友  ');
  library = sharing.librarySave(library, shared, '室友');
  assert.equal(library.schedules.length, 1);
  const newer = { ...shared, meta: { ...shared.meta, updatedAt: '2026-10-07T00:00:00.000Z' }, fetchedAt: 2000 };
  library = sharing.libraryRefresh(library, newer);
  assert.deepEqual([library.schedules[0].remark, library.schedules[0].meta.updatedAt, library.schedules[0].fetchedAt], ['室友', '2026-10-07T00:00:00.000Z', 2000]);
  library = sharing.libraryRename(library, 'ABCD2345', '同组同学');
  library = sharing.libraryMarkRevoked(library, 'ABCD2345');
  assert.deepEqual([library.schedules[0].remark, library.schedules[0].revoked], ['同组同学', true]);
  const restored = sharing.parseSharedLibrary(JSON.stringify(library));
  assert.deepEqual(plain(restored), plain(library));
  assert.deepEqual(plain(sharing.parseSharedLibrary('{"account":"a","schedules":[{"meta":{}}]}')), { account: 'a', schedules: [] });
  assert.deepEqual(plain(sharing.parseSharedLibrary('nonsense')), { account: '', schedules: [] });
  // Signing out, or a Web build that sends no account, changes nothing.
  assert.equal(sharing.libraryAdopt(library, ''), library);
  assert.equal(sharing.libraryAdopt(library, 'user-1'), library);
  assert.deepEqual(plain(sharing.libraryAdopt(library, 'user-2')), { account: 'user-2', schedules: [] });
  assert.equal(sharing.libraryRemove(library, 'ABCD2345').schedules.length, 0);
  assert.match(sharing.shareInvitation('ABCD2345', 'https://cputime.cn/'), /分享码：ABCD2345[\s\S]*https:\/\/cputime\.cn\/schedule\/share\/ABCD2345$/);
  assert.equal(sharing.shareTimeLabel('2026-10-06T12:30:00.000Z'), '10 月 6 日 20:30');
  assert.equal(sharing.shareTimeLabel(''), '');
});
