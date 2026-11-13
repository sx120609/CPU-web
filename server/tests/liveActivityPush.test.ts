import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolBroadcastEvents, broadcastPayload, windowChannelKey, clockBroadcastEvents } from '../src/services/liveActivityPush';
import { timingVersion, endChannelKey, startChannelKey, clockChannelKey, clockMark, clockMarks, clockStepMinutes } from '../src/services/liveActivitySchedule';
const periods = [{ id: 1, name: '1', start: '08:00', end: '08:45' }, { id: 2, name: '2', start: '08:55', end: '09:40' }, { id: 3, name: '3', start: '09:40', end: '10:25' }];
test('each final period has its own fixed channel and end; coincident boundaries deduplicate', () => {
  // The windows that end at a period's end; those that end at its start are checked below.
  const events = schoolBroadcastEvents({ periods }, '2026-09-22').filter(e => !e.windowID.includes(':start:'));
  for (const p of periods) {
    const group = events.filter(e => e.windowID.endsWith(`:${p.id}`));
    assert.equal(group.filter(e => e.event === 'end').length, 1);
    assert.equal(group.at(-1)!.event, 'end');
    assert.equal(new Set(group.map(e => e.fireAt.getTime())).size, group.length);
    for (const e of group) assert.equal(e.expiresAt.getTime() - e.fireAt.getTime(), e.event === 'end' ? 8 * 3600000 : 60000);
  }
  assert.equal(events.filter(e => e.windowID.endsWith(':3')).length, 5);
  assert.equal(endChannelKey('sandbox', timingVersion(periods), 2), endChannelKey('sandbox', timingVersion(periods), 2));
});
test('a late end still goes out, but never into the next day', () => {
  const evening = [{ id: 1, name: '1', start: '20:00', end: '21:00' }];
  const finalEnds = (list: typeof evening) => schoolBroadcastEvents({ periods: list }, '2026-09-22')
    .filter(e => e.event === 'end' && !e.windowID.includes(':start:'));
  const [end] = finalEnds(evening);
  assert.equal(end.expiresAt.toISOString(), new Date('2026-09-23T00:00:00+08:00').toISOString());
  const late = [{ id: 1, name: '1', start: '23:00', end: '23:59' }];
  const [last] = finalEnds(late);
  assert.equal(last.expiresAt.getTime() - last.fireAt.getTime(), 60000, 'at least the ordinary minute');
});
test('holidays, weekends and dates outside term still receive boundaries for held mappings', () => {
  const term = { periods, adjustments: [{ kind: 'off', date: '2026-09-27' }], semesterStartMonday: '2026-09-01', weekCount: 1 };
  assert.equal(schoolBroadcastEvents(term, '2026-09-27').length, schoolBroadcastEvents(term, '2026-09-22').length);
});
test('broadcasts carry common decodable schema, original event time and immediate dismissal', () => {
  const payload = broadcastPayload('2026-09-22', 1790038800, true, 'v3').aps;
  assert.equal(payload.timestamp, 1790038800);
  assert.equal(payload['dismissal-date'], payload.timestamp);
  assert.equal(payload['content-state'].protocolVersion, 2);
  assert.equal(payload['content-state'].phase, 'idle');
  assert.equal(payload['content-state'].courseName, '');
  assert.ok(!('attributes' in payload));
});
test('timing version changes for times but not names', () => {
  assert.equal(timingVersion(periods), timingVersion(periods.map(p => ({ ...p, name: 'renamed' }))));
  assert.notEqual(timingVersion(periods), timingVersion([{ ...periods[0], end: '08:40' }, ...periods.slice(1)]));
});
test('上课时收起: each period has a channel that only ends, at the moment that period starts', () => {
  const version = timingVersion(periods);
  const starts = schoolBroadcastEvents({ periods }, '2026-09-22').filter(e => e.windowID.includes(':start:'));
  assert.equal(starts.length, periods.length);
  for (const p of periods) {
    const [event, ...rest] = starts.filter(e => e.windowID === `${version}:start:${p.id}`);
    assert.equal(rest.length, 0, 'nothing is said on the channel before the class starts');
    assert.equal(event.event, 'end');
    assert.equal(event.fireAt.toISOString(), new Date(`2026-09-22T${p.start}:00+08:00`).toISOString());
    const aps = JSON.parse(event.payload).aps;
    assert.equal(aps.event, 'end');
    assert.equal(aps['dismissal-date'], event.fireAt.getTime() / 1000);
    // A delayed end still clears the screen, as a class end does.
    assert.equal(event.expiresAt.getTime() - event.fireAt.getTime(), 8 * 3600000);
    assert.equal(windowChannelKey('production', event.windowID), startChannelKey('production', version, p.id));
  }
  // Periods 2 and 3 meet at 09:40: the end of one and the start of the other stay separate events on separate channels.
  assert.notEqual(startChannelKey('production', version, 3), endChannelKey('production', version, 2));
  assert.equal(new Set(schoolBroadcastEvents({ periods }, '2026-09-22').map(e => e.windowID + e.eventID)).size,
    schoolBroadcastEvents({ periods }, '2026-09-22').length);
  assert.equal(windowChannelKey('sandbox', `${version}:2`), endChannelKey('sandbox', version, 2));
});
test('日程: every mark of the day ends its own channel, and an end time maps to the mark at or after it', () => {
  const events = clockBroadcastEvents('2026-09-22', 5);
  assert.equal(events.length, 288);
  assert.ok(events.every(e => e.event === 'end' && JSON.parse(e.payload).aps.event === 'end'));
  assert.equal(events[0].fireAt.toISOString(), new Date('2026-09-22T00:00:00+08:00').toISOString());
  assert.equal(events.at(-1)!.fireAt.toISOString(), new Date('2026-09-22T23:55:00+08:00').toISOString());
  assert.equal(new Set(events.map(e => e.eventID)).size, 288);
  const at = (clock: string) => Date.parse(`2026-09-22T${clock}+08:00`) / 1000;
  const eight = events.find(e => e.fireAt.getTime() / 1000 === at('08:05:00'))!;
  assert.equal(windowChannelKey('production', eight.windowID), 'production:main-campus:clock-0805');
  assert.equal(clockChannelKey('sandbox', 485), 'sandbox:main-campus:clock-0805');
  // Late by an hour at most, and never into the next day.
  assert.equal(eight.expiresAt.getTime() - eight.fireAt.getTime(), 3600000);
  assert.equal(events.at(-1)!.expiresAt.toISOString(), new Date('2026-09-23T00:00:00+08:00').toISOString());
  assert.equal(clockMark(at('08:05:00'), 5), 485, 'on a mark: that mark');
  assert.equal(clockMark(at('08:07:00'), 5), 490, 'between marks: the next');
  assert.equal(clockMark(at('08:05:30'), 5), 490, 'seconds round up to the next minute first');
  assert.equal(clockMark(at('23:58:00'), 5), 0, 'past the last mark: midnight');
  assert.equal(clockMark(at('08:07:00'), 0), undefined, 'off: no mark');
  assert.deepEqual(clockMarks(0), []);
  assert.equal(clockBroadcastEvents('2026-09-22', 0).length, 0);
  const saved = process.env.LIVE_ACTIVITY_CLOCK_STEP_MINUTES;
  try {
    delete process.env.LIVE_ACTIVITY_CLOCK_STEP_MINUTES; assert.equal(clockStepMinutes(), 5);
    process.env.LIVE_ACTIVITY_CLOCK_STEP_MINUTES = '0'; assert.equal(clockStepMinutes(), 0);
    process.env.LIVE_ACTIVITY_CLOCK_STEP_MINUTES = '7'; assert.equal(clockStepMinutes(), 0, 'a step that does not divide the day evenly is off');
    process.env.LIVE_ACTIVITY_CLOCK_STEP_MINUTES = '15'; assert.equal(clockStepMinutes(), 15);
  } finally { if (saved === undefined) delete process.env.LIVE_ACTIVITY_CLOCK_STEP_MINUTES; else process.env.LIVE_ACTIVITY_CLOCK_STEP_MINUTES = saved; }
});
