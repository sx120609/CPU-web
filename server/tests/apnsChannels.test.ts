import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http2 from "node:http2";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    $queryRaw: async () => { locks++; },
    $transaction: (fn: any) => {
      const result = serial.then(() => fn(db));
      serial = result.catch(() => {});
      return result;
    },
  };
  (globalThis as any).prisma = db;
  const { ensureApnsChannels } = await import("../src/services/apnsChannels");
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
        calls.push({ origin, headers, body: JSON.parse(body) });
        const callNumber = calls.length;
        queueMicrotask(() => {
          const failed = sandbox && sandboxFails;
          request.emit("response", { ":status": failed ? 403 : 201, ...(!omitChannelHeader ? { "apns-channel-id": `apple-${sandbox ? "dev" : "prod"}-${callNumber}` } : {}) });
          if (failed) request.emit("data", '{"reason":"TopicDisallowed"}');
          request.emit("end");
        });
      };
      return request;
    };
    return client;
  }) as any);

  const partial = await ensureApnsChannels();
  assert.match(partial.channels["production:cpu-morning"], /^apple-prod-/);
  assert.equal(partial.channels["sandbox:cpu-morning"], undefined);
  assert.match(partial.channelErrors[0].message, /TopicDisallowed/);
  assert.ok(calls.some(call => call.origin === "https://api-manage-broadcast.push.apple.com:2196"));
  assert.ok(calls.some(call => call.origin === "https://api-manage-broadcast.sandbox.push.apple.com:2195"));
  assert.equal(calls[0].headers[":path"], "/1/apps/cn.cputime.mobile/channels");
  assert.equal(calls[0].headers[":method"], "POST");
  assert.deepEqual(calls[0].body, { "message-storage-policy": 0, "push-type": "LiveActivity" });

  sandboxFails = false;
  const [ready] = await Promise.all([ensureApnsChannels(), ensureApnsChannels()]);
  assert.equal(calls.length, 9, "concurrent retries must not create duplicate channels");
  assert.deepEqual(ready.channelErrors, []);
  assert.equal(ready.channels["production:cpu-morning"], partial.channels["production:cpu-morning"]);
  assert.match(ready.channels["sandbox:cpu-morning"], /^apple-dev-/);

  const credentials = { keyPath, keyID: "KEY", teamID: "TEAM", bundleID: "cn.cputime.mobile", tickSeconds: 5 };
  const saved = await saveApnsConfig({ ...credentials, channels: { "production:cpu-morning": "forged" } });
  assert.deepEqual(saved.channels, ready.channels, "saving a form must not replace server-owned IDs");
  const changed = await saveApnsConfig({ ...credentials, bundleID: "cn.cputime.mobile.debug" });
  assert.deepEqual(changed.channels, {}, "changing App ID must detach old channels");
  await ensureApnsChannels();
  assert.equal(calls[9].headers[":path"], "/1/apps/cn.cputime.mobile.debug/channels");
  assert.ok(locks >= 6);

  settings.set("apns.channels", "{}");
  omitChannelHeader = true;
  const missingHeader = await ensureApnsChannels();
  assert.deepEqual(missingHeader.channels, {});
  assert.equal(missingHeader.channelErrors.length, 6);
  assert.match(missingHeader.channelErrors[0].message, /apns-channel-id/);

  settings.set("apns.keyPath", "");
  const count = calls.length;
  await ensureApnsChannels();
  assert.equal(calls.length, count, "disabled APNs must not contact Apple");
});
