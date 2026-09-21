import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http2 from "node:http2";
import crypto from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("APNs signs ES256 and sends isolated CPU topics on HTTP/2, preserving rejection reasons", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "cpu-apns-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keyPath = join(directory, "key.p8");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  await writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }));
  const config = { keyPath, keyID: "KEY", teamID: "TEAM", bundleID: "cn.cputime.mobile", channels: "{}", tickSeconds: "5" };
  (globalThis as any).prisma = {
    siteSetting: { findMany: async () => Object.entries(config).map(([key, value]) => ({ key: `apns.${key}`, value, updatedAt: new Date() })) },
    liveActivityDevice: { findMany: async () => [] },
  };
  const { sendLiveActivityPayload, sendLiveActivityBroadcast } = await import("../src/services/apnsClient");
  const calls: any[] = [];
  let status = 200;
  t.mock.method(http2, "connect", ((host: string) => {
    const client = new EventEmitter() as any;
    client.destroy = () => {};
    client.request = (headers: any) => {
      const request = new EventEmitter() as any;
      request.setEncoding = () => {};
      request.end = (body: string) => {
        calls.push({ host, headers, body: JSON.parse(body) });
        queueMicrotask(() => {
          request.emit("response", { ":status": status });
          if (status !== 200) request.emit("data", JSON.stringify({ reason: "BadDeviceToken" }));
          request.emit("end");
        });
      };
      return request;
    };
    return client;
  }) as any);
  const input = { token: "ab".repeat(32), bundleID: "cn.cputime.mobile", environment: "sandbox" as const, payload: { aps: { event: "update", timestamp: 1, "content-state": {} } } };
  await sendLiveActivityPayload(input);
  assert.equal(calls[0].host, "https://api.sandbox.push.apple.com");
  assert.equal(calls[0].headers["apns-topic"], "cn.cputime.mobile.push-type.liveactivity");
  assert.equal(calls[0].headers["apns-expiration"], "0");
  const jwt = calls[0].headers.authorization.slice(7).split(".");
  assert.equal(Buffer.from(jwt[2], "base64url").length, 64);
  assert.ok(crypto.verify("sha256", Buffer.from(`${jwt[0]}.${jwt[1]}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(jwt[2], "base64url")));
  await sendLiveActivityBroadcast({ environment: "production", bundleID: input.bundleID, channelID: "cpu-channel", payload: input.payload });
  assert.equal(calls[1].headers[":path"], "/4/broadcasts/apps/cn.cputime.mobile");
  assert.equal(calls[1].headers["apns-channel-id"], "cpu-channel");
  assert.equal(calls[1].headers["apns-topic"], undefined);
  await assert.rejects(sendLiveActivityPayload({ ...input, bundleID: "me.mom0ka27.naptable" }), /Bundle ID/);
  assert.equal(calls.length, 2);
  status = 400;
  await assert.rejects(sendLiveActivityPayload(input), (error: any) => error.status === 400 && error.apnsReason === "BadDeviceToken");
});
