import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoursePlan, resolveTimeline, normalizeLead } from '../src/services/liveActivityTimeline';
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
