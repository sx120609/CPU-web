import test, { before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http2 from "node:http2";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScheduleTermConfigValue } from "../src/services/scheduleTermConfig";

const unexpected = async () => { throw new Error("Personal data must not be read or written"); };
const db = {
  $transaction: async (fn: any) => fn(db),
  $queryRaw: async () => [],
  siteSetting: { findMany: unexpected, upsert: async () => ({}) },
  liveActivityDevice: { findMany: unexpected },
  liveActivityPlan: { findMany: unexpected, upsert: unexpected },
  liveActivityRegistration: { findMany: unexpected },
  scheduleTermConfig: { findMany: async () => [] },
  schedulePeriodConfig: { findUnique: async () => null },
  liveActivityBroadcastEvent: { updateMany: unexpected, upsert: unexpected, findMany: unexpected, findUnique: unexpected, deleteMany: unexpected },
};
let service: typeof import("../src/services/liveActivityPush");
before(async () => {
  (globalThis as any).prisma = db;
  service = await import("../src/services/liveActivityPush");
});
const term: ScheduleTermConfigValue = {
  semester: "2026-1", semesterStartMonday: "2026-09-14", weekCount: 16,
  timezone: "Asia/Shanghai", version: 1, note: "", adjustments: [],
  periods: [
    { id: 1, name: "1", start: "08:00", end: "08:45" },
    { id: 2, name: "2", start: "08:55", end: "09:40" },
    { id: 3, name: "3", start: "14:00", end: "14:45" },
    { id: 4, name: "4", start: "19:00", end: "19:45" },
  ],
};
function mockConfig(t: any, configured = true) {
  const values = { keyPath: configured ? "/test.p8" : "", keyID: "KEY", teamID: "TEAM", bundleID: "cn.cputime.mobile", tickSeconds: "5", channels: JSON.stringify({ "production:cpu-morning": "prod-am", "sandbox:cpu-morning": "dev-am" }) };
  t.mock.method(db.siteSetting, "findMany", async () => Object.entries(values).map(([key, value]) => ({ key: `apns.${key}`, value, updatedAt: new Date() })));
}

test("configuration selects environment without reading devices, tokens or personal plans", async t => {
  mockConfig(t);
  const config = await service.liveActivityBroadcastConfig("sandbox", "cn.cputime.mobile");
  assert.equal(config.windows[0].channelID, "dev-am");
  assert.equal(config.windows[1].channelID, null);
  assert.equal(config.minimumIOSVersion, 18);
  await assert.rejects(service.liveActivityBroadcastConfig("production", "other.app"), /Bundle ID/);
  await assert.rejects(service.liveActivityBroadcastConfig("invalid", "cn.cputime.mobile"), /环境/);
});

test("disabled APNs does not hand out stale channel subscriptions", async t => {
  mockConfig(t, false);
  const config = await service.liveActivityBroadcastConfig("production", "cn.cputime.mobile");
  assert.ok(config.windows.every(w => w.channelID === null));
});

test("school broadcasts cover lead/start/end boundaries and end each window separately", () => {
  const events = service.schoolBroadcastEvents(term, "2026-09-16");
  assert.equal(events.length, 12);
  const morning = events.filter(e => e.windowID === "morning");
  assert.equal(morning[0].fireAt.toISOString(), "2026-09-15T23:45:00.000Z");
  assert.equal(morning.at(-1)?.fireAt.toISOString(), "2026-09-16T01:40:00.000Z");
  assert.equal(events.filter(e => e.event === "end").length, 3);
  assert.equal(morning.filter(e => e.event === "end").length, 1);
  for (const event of events) {
    const aps = JSON.parse(event.payload).aps;
    assert.equal(aps["content-state"].courseName, "");
    assert.equal(aps["content-state"].broadcastTimestamp, aps.timestamp - 978307200, "Swift Date uses the Apple epoch");
    assert.equal(aps["dismissal-date"], event.event === "end" ? aps.timestamp : undefined);
    assert.equal(event.expiresAt.getTime() - event.fireAt.getTime(), 60_000);
  }
});

test("holidays and moved dates are silent, make-up days and weekend classes receive signals", () => {
  const adjusted = { ...term, adjustments: [
    { date: "2026-09-16", kind: "off" as const },
    { date: "2026-09-19", kind: "swap" as const, source: "2026-09-16" },
  ] };
  assert.equal(service.schoolBroadcastEvents(adjusted, "2026-09-16").length, 0);
  assert.equal(service.schoolBroadcastEvents(adjusted, "2026-09-19").length, 12);
  assert.equal(service.schoolBroadcastEvents(term, "2026-09-20").length, 12);
  assert.equal(service.schoolBroadcastEvents(term, "2026-09-13").length, 0);
  assert.equal(service.schoolBroadcastEvents(term, "2027-09-20").length, 0);
});

test("coincident boundaries are deduplicated and period ordering does not determine session end", () => {
  const changed = { ...term, periods: [term.periods[1], { ...term.periods[0], end: "08:55" }] };
  const events = service.schoolBroadcastEvents(changed, "2026-09-16");
  assert.equal(events.length, 5);
  assert.equal(events.at(-1)?.event, "end");
  assert.equal(events.at(-1)?.fireAt.toISOString(), "2026-09-16T01:40:00.000Z");
});

test("iOS 26 uses one date channel and broadcasts bell boundaries without ending activities", async t => {
  mockConfig(t);
  const config = await service.liveActivityBroadcastConfig("production", "cn.cputime.mobile", true);
  assert.equal(config.minimumIOSVersion, 26);
  assert.equal(config.windows.length, 2);
  assert.ok(config.windows.every(w => /^\d{4}-\d{2}-\d{2}$/.test(w.id)));
  const events = service.schoolBroadcastEvents(term, "2026-09-16", true);
  assert.equal(events.length, 8);
  assert.deepEqual([...new Set(events.map(e => e.windowID))], ["day:2026-09-16"]);
  assert.equal(events.filter(e => e.event === "end").length, 0);
  assert.equal(events.at(-1)?.event, "update");
  assert.equal(events[0].fireAt.toISOString(), "2026-09-16T00:00:00.000Z");
  for (const event of events) {
    const aps = JSON.parse(event.payload).aps;
    assert.equal(aps.alert, undefined);
    assert.equal(aps.event, "update");
    assert.equal(aps["dismissal-date"], undefined);
  }
  assert.notEqual(events[0].windowID, service.schoolBroadcastEvents(term, "2026-09-17", true)[0].windowID);
});

test("broadcast worker skips expired events, retries transport errors and never reads personal tables", async t => {
  const directory = await mkdtemp(join(tmpdir(), "cpu-broadcast-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keyPath = join(directory, "key.p8");
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  await writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }));
  const { dayChannelDates } = await import("../src/services/apnsChannels");
  const daily = Object.fromEntries(dayChannelDates().flatMap(date => ["production", "sandbox"].map(env => [`${env}:cpu-day:${date}`, `${env}-${date}`])));
  const values = { keyPath, keyID: "KEY", teamID: "TEAM", bundleID: "cn.cputime.mobile", channels: JSON.stringify({ "production:cpu-morning": "am", ...daily }) };
  t.mock.method(db.siteSetting, "findMany", async () => Object.entries(values).map(([key, value]) => ({ key: `apns.${key}`, value, updatedAt: new Date() })));
  const row = { id: "event", state: "pending", channelID: "am", environment: "production", bundleID: "cn.cputime.mobile", eventID: "broadcast-v2-test", attempts: 0, payload: JSON.stringify(service.broadcastPayload("2026-09-16", Date.now() / 1000)), expiresAt: new Date(Date.now() - 1000) };
  const writes: any[] = [];
  t.mock.method(db.liveActivityBroadcastEvent, "findMany", async () => [row]);
  t.mock.method(db.liveActivityBroadcastEvent, "findUnique", async () => row);
  t.mock.method(db.liveActivityBroadcastEvent, "updateMany", async (value: any) => { writes.push(value); return { count: 1 }; });
  t.mock.method(db.liveActivityBroadcastEvent, "deleteMany", async () => ({ count: 0 }));
  const calls: any[] = [];
  let responseStatus = 503;
  t.mock.method(http2, "connect", ((origin: string) => {
    const client = new EventEmitter() as any;
    client.destroy = () => {};
    client.request = (headers: any) => {
      const request = new EventEmitter() as any;
      request.setEncoding = () => {};
      request.end = (body: string) => {
        calls.push({ origin, headers, body: JSON.parse(body) });
        queueMicrotask(() => {
          request.emit("response", { ":status": responseStatus });
          if (responseStatus !== 200) request.emit("data", '{"reason":"ServiceUnavailable"}');
          request.emit("end");
        });
      };
      return request;
    };
    return client;
  }) as any);
  await service.tickBroadcastEvents();
  assert.equal(calls.length, 0);
  assert.equal(writes.at(-1).data.state, "skipped");
  row.expiresAt = new Date(Date.now() + 60_000);
  await service.tickBroadcastEvents();
  assert.equal(calls.length, 1);
  assert.equal(writes.at(-1).data.attempts, 1);
  assert.ok(writes.at(-1).data.nextAttemptAt.getTime() > Date.now());
  responseStatus = 200;
  await service.tickBroadcastEvents();
  assert.equal(writes.at(-1).data.state, "sent");
  assert.equal(calls.at(-1).headers["apns-channel-id"], "am");
  assert.equal(calls.at(-1).headers["apns-expiration"], "0");
});
