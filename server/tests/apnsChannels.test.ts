import test from 'node:test';
import assert from 'node:assert/strict';
import { endChannelKey, timingVersion } from '../src/services/liveActivitySchedule';
import { schoolDate } from '../src/services/apnsChannels';
test('channel audience isolates environment, immutable timing and final period without a date', () => {
  const key = endChannelKey('production', 'v3', 2);
  assert.equal(key, 'production:main-campus:v3:end-period-2');
  assert.notEqual(key, endChannelKey('sandbox', 'v3', 2));
  assert.notEqual(key, endChannelKey('production', 'v4', 2));
  assert.notEqual(key, endChannelKey('production', 'v3', 4));
  assert.equal(schoolDate(Date.parse('2026-09-22T16:00:00Z')), '2026-09-23');
});
