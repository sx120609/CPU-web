import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http2 from "node:http2";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let service: typeof import("../src/services/liveActivityRemoteStart");
process.env.DATABASE_URL ||= "postgres://schedule-blocks-test";
/// 上午四节连堂、下午四节连堂、晚上两节：真实节次表切出三个课节块。
const PERIODS = [
  { id: 1, name: "1", start: "08:00", end: "08:45" }, { id: 2, name: "2", start: "08:55", end: "09:40" },
  { id: 3, name: "3", start: "10:00", end: "10:45" }, { id: 4, name: "4", start: "10:55", end: "11:40" },
  { id: 5, name: "5", start: "14:00", end: "14:45" }, { id: 6, name: "6", start: "14:55", end: "15:40" },
  { id: 7, name: "7", start: "16:00", end: "16:45" }, { id: 8, name: "8", start: "16:55", end: "17:40" },
  { id: 9, name: "9", start: "19:00", end: "19:45" }, { id: 10, name: "10", start: "19:55", end: "20:40" },
];
let directory: string;
const devices = new Map<string, any>();
const plans = new Map<string, any>();
let sequence = 0;
let status = 200;
const pushes: any[] = [];
let config: Record<string, string>;
const match = (row: any, where: any) => Object.entries(where).every(([k, v]) => row[k] === v);
const db: any = {
  siteSetting: { findMany: async () => Object.entries(config).map(([key, value]) => ({ key: `apns.${key}`, value, updatedAt: new Date() })) },
  schedulePeriodConfig: { findUnique: async () => ({ periods: JSON.stringify(PERIODS) }) },
  $queryRaw: async () => [],
  $transaction: async (fn: any) => fn(db),
  liveActivityDevice: {
    findUnique: async ({ where }: any) => [...devices.values()].find(d => match(d, where)),
    findFirst: async ({ where }: any) => [...devices.values()].find(d => match(d, where)),
    upsert: async ({ where, create, update }: any) => {
      let d = [...devices.values()].find(d => match(d, where));
      if (d) Object.assign(d, update);
      else { d = { id: `d${++sequence}`, enabled: true, ...create }; devices.set(d.id, d); }
      return d;
    },
    update: async ({ where, data }: any) => Object.assign(devices.get(where.id), data),
    delete: async ({ where }: any) => {
      devices.delete(where.id);
      for (const [id, row] of plans) if (row.deviceId === where.id) plans.delete(id);
    },
    deleteMany: async ({ where }: any) => {
      for (const row of [...devices.values()]) if (match(row, where)) await db.liveActivityDevice.delete({ where: { id: row.id } });
    },
  },
  liveActivityPlan: {
    deleteMany: async ({ where }: any) => {
      for (const [id, row] of plans) if (match(row, where)) plans.delete(id);
    },
    createMany: async ({ data }: any) => {
      for (const row of data) {
        if ([...plans.values()].some(p => p.deviceId === row.deviceId && p.itemID === row.itemID)) continue;
        const id = `p${++sequence}`;
        plans.set(id, { id, state: "pending", nextAttemptAt: new Date(0), attempts: 0, ...row });
      }
    },
    findMany: async ({ where, take }: any) => {
      assert.equal(where.event, "hybrid-start-v1", "never execute legacy per-course plans");
      return [...plans.values()].filter(p => p.state === where.state && p.fireAt <= where.fireAt.lte && p.nextAttemptAt <= where.nextAttemptAt.lte && devices.get(p.deviceId)?.enabled)
        .slice(0, take).map(p => ({ id: p.id, device: devices.get(p.deviceId) }));
    },
    findUnique: async ({ where }: any) => {
      const p = plans.get(where.id); return p && { ...p, device: devices.get(p.deviceId) };
    },
    update: async ({ where, data }: any) => {
      const p = plans.get(where.id);
      const attempts = typeof data.attempts === "object" ? p.attempts + data.attempts.increment : p.attempts;
      Object.assign(p, data, { attempts }); return p;
    },
  },
};
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "cpu-remote-start-"));
  const keyPath = join(directory, "key.p8");
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  await writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }));
  config = { keyPath, keyID: "KEY", teamID: "TEAM", bundleID: "cn.cputime.mobile", channels: JSON.stringify({ "production:cpu-block:2026-09-21:0800": "am" }) };
  (globalThis as any).prisma = db;
  service = await import("../src/services/liveActivityRemoteStart");
  blocks = (await import("../src/services/liveActivityBlocks")).scheduleBlocks(PERIODS);
});
let blocks: import("../src/services/liveActivityBlocks").ScheduleBlock[];
after(async () => rm(directory, { recursive: true, force: true }));
const now = Date.parse("2026-09-21T00:00:00Z") / 1000;
// 08:00 Beijing. The block runs to 11:40, which is the only end the server accepts.
const window = { dateKey: "2026-09-21", window: "0800", start: now + 1800, end: now + 3600 * 3 + 2400 };
function input(leadMinutes = 15) {
  return { token: "ab".repeat(32), environment: "production", bundleID: "cn.cputime.mobile", leadMinutes, items: [window] };
}
test("custom lead accepts 0–60 minutes, strips course text and rejects malformed/oversized schedules", () => {
  for (const lead of [0, 1, 15, 30, 60]) assert.deepEqual(service.parseStartWindows([{ ...window, courseName: "private" }], lead, blocks, now), [window]);
  for (const lead of [-1, 61, 1.5, "15", null]) assert.throws(() => service.parseStartWindows([window], lead, blocks, now));
  assert.throws(() => service.parseStartWindows([window, window], 15, blocks, now));
  assert.throws(() => service.parseStartWindows([window], 15, [], now), /节次未配置/);
  // A morning start may not claim the afternoon block, and the end must be the
  // school block end: anything else would address a channel that does not exist.
  assert.throws(() => service.parseStartWindows([{ ...window, window: "1400" }], 15, blocks, now));
  assert.throws(() => service.parseStartWindows([{ ...window, window: "0900" }], 15, blocks, now));
  assert.throws(() => service.parseStartWindows([{ ...window, end: window.end - 60 }], 15, blocks, now));
  assert.throws(() => service.parseStartWindows([{ ...window, end: window.start + 8 * 3600 }], 0, blocks, now));
  assert.throws(() => service.parseStartWindows(Array(371 * blocks.length).fill(window), 15, blocks, now));
  const future = { dateKey: "2027-01-01", window: "1900", start: Date.parse("2027-01-01T19:00:00+08:00") / 1000, end: Date.parse("2027-01-01T20:40:00+08:00") / 1000 };
  assert.equal(service.parseStartWindows([future], 60, blocks, now).length, 1, "semester support extends beyond 7/45 days");
});

test("blocks merge across the short break and split at lunch and dinner", () => {
  assert.deepEqual(blocks.map(block => [block.id, block.startClock, block.endClock]), [
    ["0800", "08:00", "11:40"], ["1400", "14:00", "17:40"], ["1900", "19:00", "20:40"],
  ]);
});

test("start payload subscribes directly to channel and contains no personal course fields", () => {
  const { aps } = service.remoteStartPayload(window, "am", now);
  assert.equal(aps.event, "start");
  assert.equal(aps["input-push-channel"], "am");
  assert.equal(aps.attributes.dateKey, window.dateKey);
  assert.equal(aps.attributes.reservationStart, window.start - 978307200);
  assert.equal(aps["stale-date"], window.end);
  assert.ok(aps.alert);
  assert.ok(Buffer.byteLength(JSON.stringify({ aps })) < 4096);
});

test("semester sync replaces pending starts, preserves sent identities and isolates account revocation", async t => {
  t.mock.method(Date, "now", () => now * 1000);
  const first = await service.syncRemoteStarts(1, input());
  let row = [...plans.values()][0];
  assert.equal(row.fireAt.getTime() / 1000, window.start - 900);
  assert.ok(!devices.get(first.deviceID).startTokenCiphertext.includes(input().token));
  await service.syncRemoteStarts(1, input(30));
  row = [...plans.values()][0];
  assert.equal(row.fireAt.getTime() / 1000, window.start - 1800);
  row.state = "sent";
  await service.syncRemoteStarts(1, input(0));
  assert.equal(plans.size, 1);
  assert.equal([...plans.values()][0].state, "sent", "lead edits must not create another activity");
  const rotated = await service.syncRemoteStarts(1, { ...input(0), token: "cd".repeat(32), replaces: first.revoke });
  assert.equal(rotated.deviceID, first.deviceID);
  assert.equal([...plans.values()][0].state, "sent", "token rotation retains sent identities");
  await service.revokeRemoteStarts(first.revoke);
  assert.ok(devices.has(rotated.deviceID), "outdated token capability cannot revoke rotated device");
  await service.revokeRemoteStarts(rotated.revoke);
  const transferred = await service.syncRemoteStarts(1, input());
  const second = await service.syncRemoteStarts(2, input());
  assert.notEqual(first.deviceID, second.deviceID);
  await service.revokeRemoteStarts(transferred.revoke);
  assert.ok(devices.has(second.deviceID));
  await assert.rejects(service.revokeRemoteStarts(second.revoke.replace(/ciphertext/, "broken")));
  await service.revokeRemoteStarts(second.revoke);
  assert.equal(plans.size, 0);
  assert.equal(devices.size, 0);
});

test("first registration mid-class starts now, while an empty replacement cancels future starts", async t => {
  const late = window.start + 600;
  t.mock.method(Date, "now", () => late * 1000);
  const registration = await service.syncRemoteStarts(1, input());
  const row = [...plans.values()][0];
  assert.equal(row.fireAt.getTime() / 1000, late);
  assert.ok(row.expiresAt.getTime() / 1000 > late);
  await service.syncRemoteStarts(1, { ...input(), items: [] });
  assert.equal(plans.size, 0);
  await service.revokeRemoteStarts(registration.revoke);
});

test("worker sends due starts, retries APNs 503, disables invalid tokens, and skips expired starts", async t => {
  t.mock.method(Date, "now", () => now * 1000);
  let connections = 0;
  t.mock.method(http2, "connect", (() => {
    connections++;
    const client = new EventEmitter() as any;
    client.destroy = () => {};
    client.request = (headers: any) => {
      const request = new EventEmitter() as any;
      request.setEncoding = () => {};
      request.end = (body: string) => {
        pushes.push({ headers, body: JSON.parse(body) });
        queueMicrotask(() => {
          request.emit("response", { ":status": status });
          if (status !== 200) request.emit("data", JSON.stringify({ reason: status === 410 ? "Unregistered" : "ServiceUnavailable" }));
          request.emit("end");
        });
      };
      return request;
    };
    return client;
  }) as any);
  const registered = await service.syncRemoteStarts(1, input(30));
  const row = [...plans.values()][0];
  status = 503;
  await service.tickRemoteStarts();
  assert.equal(row.state, "pending");
  assert.equal(row.attempts, 1);
  assert.ok(row.nextAttemptAt.getTime() > now * 1000);
  row.nextAttemptAt = new Date(0);
  status = 200;
  await service.tickRemoteStarts();
  assert.equal(row.state, "sent");
  assert.equal(connections, 1, "reuse HTTP/2 connection across starts/retries");
  assert.equal(pushes.at(-1).body.aps["input-push-channel"], "am");
  assert.equal(pushes.at(-1).headers["apns-topic"], "cn.cputime.mobile.push-type.liveactivity");
  row.state = "pending";
  row.expiresAt = new Date((now - 1) * 1000);
  const count = pushes.length;
  await service.tickRemoteStarts();
  assert.equal(row.state, "skipped");
  assert.equal(pushes.length, count);
  row.state = "pending";
  row.expiresAt = new Date((now + 60) * 1000);
  status = 410;
  await service.tickRemoteStarts();
  assert.equal(row.state, "failed");
  assert.equal(devices.get(registered.deviceID).enabled, false);
  await service.revokeRemoteStarts(registered.revoke);
});
