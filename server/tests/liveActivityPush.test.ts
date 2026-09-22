import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolBroadcastEvents, broadcastPayload } from '../src/services/liveActivityPush';
import { timingVersion, endChannelKey } from '../src/services/liveActivitySchedule';
const periods = [{ id: 1, name: '1', start: '08:00', end: '08:45' }, { id: 2, name: '2', start: '08:55', end: '09:40' }, { id: 3, name: '3', start: '09:40', end: '10:25' }];
test('each final period has its own fixed channel and end; coincident boundaries deduplicate', () => {
  const events = schoolBroadcastEvents({ periods }, '2026-09-22');
  for (const p of periods) {
    const group = events.filter(e => e.windowID.endsWith(`:${p.id}`));
    assert.equal(group.filter(e => e.event === 'end').length, 1);
    assert.equal(group.at(-1)!.event, 'end');
    assert.equal(new Set(group.map(e => e.fireAt.getTime())).size, group.length);
    for (const e of group) assert.equal(e.expiresAt.getTime() - e.fireAt.getTime(), 60000);
  }
  assert.equal(events.filter(e => e.windowID.endsWith(':3')).length, 5);
  assert.equal(endChannelKey('sandbox', timingVersion(periods), 2), endChannelKey('sandbox', timingVersion(periods), 2));
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
