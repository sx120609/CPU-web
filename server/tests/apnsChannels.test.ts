import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http2 from "node:http2";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_URL ||= "postgres://schedule-blocks-test";
// Three block channels plus one tick channel per environment.
const PERIODS = [
  { id: 1, name: "1", start: "08:00", end: "08:45" }, { id: 2, name: "2", start: "08:55", end: "09:40" },
  { id: 3, name: "3", start: "14:00", end: "14:45" },
  { id: 4, name: "4", start: "19:00", end: "19:45" },
];
const NOW = Date.parse("2026-09-21T00:00:00Z");
const KEYS = ["cpu-day", "cpu-block:0800", "cpu-block:1400", "cpu-block:1900"];

test("channel provisioning preserves partial success, retries missing channels and isolates App IDs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cpu-channels-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keyPath = join(directory, "key.p8");
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  await writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }));
  const settings = new Map(Object.entries({ keyPath, keyID: "KEY", teamID: "TEAM", bundleID: "cn.cputime.mobile", tickSeconds: "5", channels: "{}" }).map(([key, value]) => [`apns.${key}`, value]));
  let serial: Promise<unknown> = Promise.resolve();
  let locks = 0;
  const db: any = {
    siteSetting: {
      findMany: async () => [...settings].map(([key, value]) => ({ key, value, updatedAt: new Date() })),
      upsert: async ({ where, update }: any) => { settings.set(where.key, update.value); },
    },
    liveActivityDevice: { findMany: async () => [] },
    schedulePeriodConfig: { findUnique: async () => ({ periods: JSON.stringify(PERIODS) }) },
    $queryRaw: async () => { locks++; },
    $transaction: (fn: any) => {
      const result = serial.then(() => fn(db));
      serial = result.catch(() => {});
      return result;
    },
  };
  (globalThis as any).prisma = db;
  const { ensureApnsChannels, maintainApnsChannels, dayChannelDates } = await import("../src/services/apnsChannels");
  const { saveApnsConfig } = await import("../src/services/apnsConfig");
  let sandboxFails = true;
  let omitChannelHeader = false;
  const calls: any[] = [];
  t.mock.method(http2, "connect", ((origin: string) => {
    const client = new EventEmitter() as any;
    client.destroy = () => {};
    client.request = (headers: any) => {
      const request = new EventEmitter() as any;
      request.setEncoding = () => {};
      request.end = (body: string) => {
        const sandbox = origin.includes("sandbox");
        calls.push({ origin, headers, body: body ? JSON.parse(body) : null });
        const callNumber = calls.length;
        queueMicrotask(() => {
          const failed = sandbox && sandboxFails;
          request.emit("response", { ":status": failed ? 403 : headers[":method"] === "DELETE" ? 204 : 201, ...(!omitChannelHeader ? { "apns-channel-id": `apple-${sandbox ? "dev" : "prod"}-${callNumber}` } : {}) });
          if (failed) request.emit("data", '{"reason":"TopicDisallowed"}');
          request.emit("end");
        });
      };
      return request;
    };
    return client;
  }) as any);

  const partial = await ensureApnsChannels(NOW);
  assert.deepEqual(Object.keys(partial.channels), KEYS.map(key => `production:${key}`),
    "channels describe stable audiences independent of dates");
  assert.ok(KEYS.every(key => /^apple-prod-/.test(partial.channels[`production:${key}`])));
  assert.equal(partial.channels["sandbox:cpu-block:0800"], undefined);
  assert.equal(partial.channelErrors.length, KEYS.length);
  assert.match(partial.channelErrors[0].message, /TopicDisallowed/);
  assert.ok(calls.some(call => call.origin === "https://api-manage-broadcast.push.apple.com:2196"));
  assert.ok(calls.some(call => call.origin === "https://api-manage-broadcast.sandbox.push.apple.com:2195"));
  assert.equal(calls[0].headers[":path"], "/1/apps/cn.cputime.mobile/channels");
  assert.equal(calls[0].headers[":method"], "POST");
  assert.deepEqual(calls[0].body, { "message-storage-policy": 0, "push-type": "LiveActivity" });

  sandboxFails = false;
  const [ready] = await Promise.all([ensureApnsChannels(NOW), ensureApnsChannels(NOW)]);
  assert.equal(calls.length, 3 * KEYS.length, "concurrent retries must not create duplicate channels");
  assert.deepEqual(ready.channelErrors, []);
  assert.equal(ready.channels["production:cpu-block:0800"], partial.channels["production:cpu-block:0800"]);
  assert.match(ready.channels["sandbox:cpu-block:0800"], /^apple-dev-/);

  const credentials = { keyPath, keyID: "KEY", teamID: "TEAM", bundleID: "cn.cputime.mobile", tickSeconds: 5 };
  const saved = await saveApnsConfig({ ...credentials, channels: { "production:cpu-block:0800": "forged" } });
  assert.deepEqual(saved.channels, ready.channels, "saving a form must not replace server-owned IDs");
  const changed = await saveApnsConfig({ ...credentials, bundleID: "cn.cputime.mobile.debug" });
  assert.deepEqual(changed.channels, {}, "changing App ID must detach old channels");
  const afterRename = calls.length;
  await ensureApnsChannels(NOW);
  assert.equal(calls[afterRename].headers[":path"], "/1/apps/cn.cputime.mobile.debug/channels");
  assert.ok(locks >= 6);

  settings.set("apns.channels", "{}");
  omitChannelHeader = true;
  const missingHeader = await ensureApnsChannels(NOW);
  assert.deepEqual(missingHeader.channels, {});
  assert.equal(missingHeader.channelErrors.length, 2 * KEYS.length);
  assert.match(missingHeader.channelErrors[0].message, /apns-channel-id/);

  settings.set("apns.keyPath", "");
  const count = calls.length;
  await ensureApnsChannels(NOW);
  assert.equal(calls.length, count, "disabled APNs must not contact Apple");

  settings.set("apns.keyPath", keyPath);
  // The window-era channels are permanent keys with no school date. Rotation
  // reclaims them on the first pass; an unrelated key shape must survive.
  const legacy = { "production:cpu-morning": "legacy-am", "sandbox:cpu-evening": "legacy-pm", "production:cpu": "legacy-v1", "production:other": "keep" };
  settings.set("apns.channels", JSON.stringify(legacy));
  omitChannelHeader = false;
  await Promise.all([maintainApnsChannels(NOW), maintainApnsChannels(NOW)]);
  const daily = JSON.parse(settings.get("apns.channels")!);
  assert.equal(Object.keys(daily).length, 2 * KEYS.length + 1, "fixed channels plus the unrelated key");
  assert.deepEqual(Object.keys(legacy).filter(key => daily[key]), ["production:other"]);
  assert.ok(daily["production:cpu-day"]);
  assert.notEqual(daily["production:cpu-block:0800"], daily["production:cpu-block:1400"]);
  assert.equal(calls.length, count + 2 * KEYS.length + 3, "concurrent refresh provisions each channel once and reclaims each legacy channel once");
  const reclaimed = calls.filter(call => call.headers[":method"] === "DELETE").map(call => call.headers["apns-channel-id"]);
  assert.deepEqual(reclaimed.sort(), ["legacy-am", "legacy-pm", "legacy-v1"]);
  assert.ok(reclaimed.every(id => id !== "keep"), "only the documented window-era keys are deleted");
  const beforeRollover = calls.length;
  await maintainApnsChannels(NOW + 86400_000);
  assert.equal(calls.length, beforeRollover, "midnight must not create or delete channels");
  assert.deepEqual(JSON.parse(settings.get("apns.channels")!), daily);
  settings.set("apns.channels", JSON.stringify({ ...daily,
    "production:cpu-day:2026-09-21": "dated-day",
    "production:cpu-block:2026-09-21:0800": "dated-block",
    "production:cpu-day:2026-09-25": "future-day",
  }));
  const later = NOW + 3 * 86400_000;
  await maintainApnsChannels(later);
  const cleaned = JSON.parse(settings.get("apns.channels")!);
  assert.equal(Object.keys(cleaned).length, 2 * KEYS.length + 2);
  assert.equal(cleaned["production:other"], "keep");
  assert.ok(KEYS.every(key => cleaned[`production:${key}`] === daily[`production:${key}`]));
  assert.equal(cleaned["production:cpu-day:2026-09-25"], "future-day");
  const deletes = calls.filter(call => call.headers[":method"] === "DELETE");
  assert.equal(deletes.length, 5, "only expired dated channels are reclaimed");
  assert.ok(deletes.every(call => call.headers["apns-channel-id"] !== "keep"));
});


test("migration prefers stable subscriptions and broadcasts to both generations", async () => {
  const { channelForDate, broadcastChannelIDs } = await import("../src/services/apnsChannels");
  const channels = { "production:cpu-block:0800": "fixed", "production:cpu-block:2026-09-21:0800": "old",
    "production:cpu-day": "tick", "production:cpu-day:2026-09-21": "old-tick" };
  assert.equal(channelForDate(channels, "production", "block", "2027-01-01", "0800"), "fixed");
  assert.deepEqual(broadcastChannelIDs(channels, "production", "block:2026-09-21:0800"), ["fixed", "old"]);
  assert.deepEqual(broadcastChannelIDs(channels, "production", "day:2026-09-21"), ["tick", "old-tick"]);
  assert.deepEqual(broadcastChannelIDs(channels, "sandbox", "day:2026-09-21"), []);
  assert.deepEqual(broadcastChannelIDs(channels, "production", "block:2026-09-21:1400"), []);
});
