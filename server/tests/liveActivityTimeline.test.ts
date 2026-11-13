import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoursePlan, parseNotes, resolveTimeline, normalizeLead } from '../src/services/liveActivityTimeline';
import { clockMark } from '../src/services/liveActivitySchedule';
import { normalizeSchedulePeriods } from '../src/services/scheduleTermConfig';
const periods = [{ id: 1, name: '1', start: '08:00', end: '08:45' }, { id: 2, name: '2', start: '08:55', end: '09:40' }, { id: 3, name: '3', start: '09:55', end: '10:40' }, { id: 4, name: '4', start: '10:50', end: '11:35' }];
const start = Date.parse('2026-09-22T08:00:00+08:00') / 1000;
const input = (leadMinutes = 15) => ({ protocolVersion: 2, planRevision: 1, coverageStart: '2026-09-22', coverageEndExclusive: '2026-12-01', leadMinutes, busyIntervals: [],
  items: [{ occurrenceId: 'a', supersedes: [], dateKey: '2026-09-22', startPeriod: 1, endPeriod: 2 }, { occurrenceId: 'b', supersedes: [], dateKey: '2026-09-22', startPeriod: 3, endPeriod: 4 }] });
test('all lead settings use previous final end; phases are left closed/right open', () => {
  for (const lead of [15, 30, 60]) {
    const courses = parseCoursePlan(input(lead), periods, start - 7200);
    assert.equal(courses[0].plannedStart, start - lead * 60);
    assert.equal(courses[1].plannedStart, Math.max(courses[0].end, courses[1].start - lead * 60));
    for (const mode of ['whole', 'segmented'] as const) {
      assert.equal(resolveTimeline(courses[0].segments, mode, start - 1).phase, 'upcoming');
      assert.equal(resolveTimeline(courses[0].segments, mode, start).phase, 'inClass');
      assert.equal(resolveTimeline(courses[0].segments, mode, start + 2700).phase, mode === 'whole' ? 'inClass' : 'break');
      assert.equal(resolveTimeline(courses[0].segments, mode, start + 3300).index, 1);
      assert.equal(resolveTimeline(courses[0].segments, mode, start + 6000).phase, 'finished');
    }
  }
});
test('rejects conflicts, duplicate identities, invalid dates and non-preset settings atomically', () => {
  for (const bad of [0, 16, 61, '15']) assert.throws(() => parseCoursePlan(input(bad as number), periods, start));
  const overlap = input(); overlap.items[1].startPeriod = 2;
  assert.throws(() => parseCoursePlan(overlap, periods, start), /冲突/);
  const duplicate = input(); duplicate.items[1].occurrenceId = 'a';
  assert.throws(() => parseCoursePlan(duplicate, periods, start), /身份/);
  const date = input(); date.items[0].dateKey = '2026-02-30';
  assert.throws(() => parseCoursePlan(date, periods, start), /日期/);
  assert.throws(() => normalizeSchedulePeriods([periods[1], periods[0]]), /有序/);
  assert.deepEqual([undefined, -1, 0, 16, 31, 61].map(normalizeLead), [15, 15, 15, 30, 60, 15]);
});
test('custom-time busy intervals delay subsequent courses without generating jobs', () => {
  const data: any = input(60); data.items.shift();
  data.busyIntervals = [{ startAt: start, endAt: start + 6400 }];
  const courses = parseCoursePlan(data, periods, start - 7200);
  assert.equal(courses.length, 1); assert.equal(courses[0].plannedStart, start + 6400);
});
test('late accepted plan has bounded catch-up validity and no private course text', () => {
  const data: any = input(); data.items[0].name = 'private';
  const result = parseCoursePlan(data, periods, start + 1000);
  assert.equal(result[0].expiresAt, start + 1300);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.throws(() => parseCoursePlan({ ...data, items: Array(10001).fill(data.items[0]) }, periods, start));
});
test('上课时收起: shown from the reminder to the start of class, and a class with no gap before it is left out', () => {
  const now = start - 7200;
  const plain = parseCoursePlan(input(15), periods, now);
  const courses = parseCoursePlan({ ...input(15), beforeClassOnly: true }, periods, now);
  assert.deepEqual(courses.map(c => c.occurrenceId), ['a', 'b']);
  for (const [index, c] of courses.entries()) {
    assert.equal(c.visibleEnd, c.start);
    assert.equal(c.expiresAt, c.start, 'a start is never sent once class has begun');
    assert.equal(c.plannedStart, plain[index].plannedStart, 'the reminder still waits for the class before it');
    assert.equal(c.end, plain[index].end);
  }
  assert.ok(plain.every(c => c.visibleEnd === undefined));
  // Periods 2 and 3 back to back for two different classes: nothing to show before the second.
  const tight = [...periods.slice(0, 2), { id: 3, name: '3', start: '09:40', end: '10:25' }];
  const items = [{ occurrenceId: 'a', supersedes: [], dateKey: '2026-09-22', startPeriod: 1, endPeriod: 2 },
    { occurrenceId: 'b', supersedes: [], dateKey: '2026-09-22', startPeriod: 3, endPeriod: 3 }];
  assert.deepEqual(parseCoursePlan({ ...input(15), items, beforeClassOnly: true }, tight, now).map(c => c.occurrenceId), ['a']);
  assert.deepEqual(parseCoursePlan({ ...input(15), items }, tight, now).map(c => c.occurrenceId), ['a', 'b']);
  assert.throws(() => parseCoursePlan({ ...input(15), beforeClassOnly: 'yes' }, periods, now), /上课时收起/);
});
test('日程: shown from the reminder to the end, ended by the clock mark at or after it, apart from classes', () => {
  const now = start - 7200;
  const at = (clock: string) => Date.parse(`2026-09-22T${clock}:00+08:00`) / 1000;
  const mark = (seconds: number) => clockMark(seconds, 5);
  const notes = [
    { occurrenceId: 'meeting', startAt: at('09:00'), endAt: at('10:07') },
    { occurrenceId: 'deadline', startAt: at('12:30'), endAt: at('12:30') },
    { occurrenceId: 'camp', startAt: at('13:00'), endAt: at('22:00') },
  ];
  const parsed = parseNotes({ ...input(30), notes }, mark, now);
  const [meeting, deadline, camp] = parsed;
  // It overlaps class a (08:00–09:40): a 日程 neither waits for a class nor clashes with one.
  assert.equal(meeting.plannedStart, at('08:30'));
  assert.equal(meeting.clock, 10 * 60 + 10, 'ends on the mark after 10:07');
  assert.equal(meeting.visibleEnd, undefined);
  assert.deepEqual(meeting.segments, [{ period: 0, startAt: at('09:00'), endAt: at('10:07') }]);
  assert.equal(meeting.dateKey, '2026-09-22');
  // No end time: on screen until it starts.
  assert.equal(deadline.clock, 12 * 60 + 30);
  assert.equal(deadline.expiresAt, deadline.start);
  // Past the eight hours an activity may last: until it starts.
  assert.equal(camp.visibleEnd, camp.start);
  assert.equal(camp.clock, 13 * 60);
  assert.deepEqual(parseCoursePlan({ ...input(30), notes }, periods, now).map(c => c.occurrenceId), ['a', 'b'], 'classes are planned as before');
  assert.deepEqual(parseNotes(input(30), mark, now), [], 'older clients send none');
  assert.deepEqual(parseNotes({ ...input(30), notes }, () => undefined, now), [], 'clock channels off: left out');
  assert.throws(() => parseNotes({ ...input(30), notes: [{ occurrenceId: 'a', startAt: at('09:00'), endAt: at('10:00') }] }, mark, now), /身份/);
  assert.throws(() => parseNotes({ ...input(30), notes: [notes[0], notes[0]] }, mark, now), /身份/);
  assert.throws(() => parseNotes({ ...input(30), notes: [{ occurrenceId: 'x', startAt: at('10:00'), endAt: at('09:00') }] }, mark, now), /时间/);
  // Outside the term the plan covers: left out, and the rest of the plan stands.
  assert.deepEqual(parseNotes({ ...input(30), notes: [{ occurrenceId: 'x', startAt: at('09:00') - 86400, endAt: at('09:00') }, notes[0]] }, mark, now)
    .map(note => note.occurrenceId), ['meeting']);
  assert.throws(() => parseNotes({ ...input(30), notes: [{ occurrenceId: 'x', startAt: 'soon', endAt: at('09:00') }] }, mark, now), /时间/);
  assert.throws(() => parseNotes({ ...input(30), notes: 'all' }, mark, now), /500/);
});
