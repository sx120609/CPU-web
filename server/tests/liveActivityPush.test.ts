import test, { before } from "node:test";
import assert from "node:assert/strict";
import { decryptJwxtSensitiveJson } from "../src/services/jwxtSessionCrypto";

// Inject an in-memory database boundary before loading the actual service.
const unexpected = async () => { throw new Error("Unexpected database access"); };
const prisma = {
  siteSetting: { findMany: unexpected },
  liveActivityDevice: { findMany: unexpected, findFirst: unexpected, findUnique: unexpected, create: unexpected, deleteMany: unexpected },
  liveActivityPlan: { count: unexpected, findFirst: unexpected, findMany: unexpected, findUnique: unexpected, updateMany: unexpected, deleteMany: unexpected },
  $transaction: unexpected,
};
let registerLiveActivityDevice: typeof import("../src/services/liveActivityPush").registerLiveActivityDevice;
let replaceLiveActivityPlan: typeof import("../src/services/liveActivityPush").replaceLiveActivityPlan;
let removeLiveActivityDevice: typeof import("../src/services/liveActivityPush").removeLiveActivityDevice;
before(async () => {
  (globalThis as any).prisma = prisma;
  ({ registerLiveActivityDevice, replaceLiveActivityPlan, removeLiveActivityDevice } = await import("../src/services/liveActivityPush"));
});

function mockConfig(t: any, channels = {}) {
  const values = { keyPath: "/test.p8", keyID: "KEY", teamID: "TEAM", bundleID: "cn.cputime.mobile", tickSeconds: "5", channels: JSON.stringify(channels) };
  t.mock.method(prisma.siteSetting, "findMany", async () => Object.entries(values).map(([key, value]) => ({ key: `apns.${key}`, value, updatedAt: new Date() })));
  t.mock.method(prisma.liveActivityDevice, "findMany", async () => []);
  t.mock.method(prisma.liveActivityDevice, "findUnique", async () => null);
}

test("CPU rejects NapTable bundle before creating a device", async (t) => {
  mockConfig(t);
  const create = t.mock.method(prisma.liveActivityDevice, "create", async () => { throw new Error("must not create"); });
  await assert.rejects(registerLiveActivityDevice({ userId: 1, environment: "production", bundleID: "me.mom0ka27.naptable" }), /Bundle ID/);
  assert.equal(create.mock.callCount(), 0);
});

test("CPU registers encrypted token and falls back to device push without a channel", async (t) => {
  mockConfig(t);
  let saved: any;
  t.mock.method(prisma.liveActivityDevice, "create", async ({ data }: any) => { saved = data; return { id: "cpu-device", ...data }; });
  t.mock.method(prisma.liveActivityPlan, "count", async () => 0);
  t.mock.method(prisma.liveActivityPlan, "findFirst", async () => null);
  const token = "ab".repeat(32);
  const result = await registerLiveActivityDevice({ userId: 1, startToken: token, environment: "production", bundleID: "cn.cputime.mobile", supportsBroadcast: true });
  assert.equal(result.broadcastEnabled, false);
  assert.equal(result.channelID, null);
  assert.equal(result.hasStartToken, true);
  assert.ok(!saved.startTokenCiphertext.includes(token));
  assert.equal(decryptJwxtSensitiveJson<{ token: string }>("live-activity-start-token", saved.startTokenHash, saved.startTokenCiphertext).value.token, token);
});

test("CPU selects only the matching APNs environment channel", async (t) => {
  mockConfig(t, { "production:cpu": "prod", "sandbox:cpu": "dev" });
  t.mock.method(prisma.liveActivityDevice, "create", async ({ data }: any) => ({ id: "cpu-device", ...data }));
  t.mock.method(prisma.liveActivityPlan, "count", async () => 0);
  t.mock.method(prisma.liveActivityPlan, "findFirst", async () => null);
  const result = await registerLiveActivityDevice({ userId: 1, environment: "sandbox", bundleID: "cn.cputime.mobile", supportsBroadcast: true });
  assert.equal(result.channelID, "dev");
});

test("device plan replacement and deletion enforce account ownership", async (t) => {
  t.mock.method(prisma.liveActivityDevice, "findFirst", async ({ where }: any) => {
    assert.equal(where.userId, 2);
    assert.equal(where.id, "other-user-device");
    return null;
  });
  const write = t.mock.method(prisma, "$transaction", async () => { throw new Error("must not write"); });
  t.mock.method(prisma.liveActivityDevice, "deleteMany", async ({ where }: any) => {
    assert.deepEqual(where, { id: "other-user-device", userId: 2 });
    return { count: 0 };
  });
  await assert.rejects(replaceLiveActivityPlan(2, "other-user-device", []), /设备不存在/);
  await removeLiveActivityDevice(2, "other-user-device");
  assert.equal(write.mock.callCount(), 0);
});

test("malformed or oversized plans are rejected before persistence", async (t) => {
  t.mock.method(prisma.liveActivityDevice, "findFirst", async () => ({ id: "device", enabled: true }));
  const now = Date.now() / 1000;
  await assert.rejects(replaceLiveActivityPlan(1, "device", [{ id: "x", event: "start", fireAt: now, contentState: {} }]), /attributes/);
  await assert.rejects(replaceLiveActivityPlan(1, "device", Array(241).fill({})), /最多/);
  const item = { id: "x", event: "update", fireAt: now, contentState: {} };
  await assert.rejects(replaceLiveActivityPlan(1, "device", [item, item]), /重复/);
});

test("push-to-start includes Apple's required alert and update preserves the rendered state", async () => {
  const { planPayload } = await import("../src/services/liveActivityPush");
  const state = { courseName: "药理学", phase: "upcoming" };
  const raw = JSON.stringify({ attributes: { id: "today" }, contentState: state, staleDate: 2000 });
  const start = planPayload("start", raw, 1000.9).aps;
  assert.ok(start.alert);
  assert.equal(start.timestamp, 1000);
  assert.equal(start["attributes-type"], "ScheduleLiveActivityAttributes");
  assert.deepEqual(start["content-state"], state);
  const update = planPayload("update", raw, 1001).aps;
  assert.equal(update.alert, undefined);
  assert.equal(update["stale-date"], 2000);
});

test("scheduler skips stale starts and persists retry state while waiting for device token", async (t) => {
  mockConfig(t);
  const { tickPlannedLiveActivities } = await import("../src/services/liveActivityPush");
  const updates: any[] = [];
  const row = { id: "event", revision: 1, state: "pending", event: "start", attempts: 0, expiresAt: new Date(Date.now() - 1000), device: { enabled: true, broadcastEnabled: false } };
  t.mock.method(prisma.liveActivityPlan, "findMany", async () => [row]);
  t.mock.method(prisma.liveActivityPlan, "findUnique", async () => row);
  t.mock.method(prisma.liveActivityPlan, "updateMany", async (args: any) => { updates.push(args); return { count: 1 }; });
  t.mock.method(prisma.liveActivityPlan, "deleteMany", async () => ({ count: 0 }));
  await tickPlannedLiveActivities();
  assert.equal(updates.at(-1).data.state, "skipped");
  updates.length = 0;
  row.expiresAt = new Date(Date.now() + 60_000);
  await tickPlannedLiveActivities();
  const retry = updates.at(-1);
  assert.equal(retry.data.attempts, 1);
  assert.ok(retry.data.nextAttemptAt.getTime() > Date.now());
  assert.equal(retry.data.claimedUntil, null);
  assert.equal(retry.where.revision, 1);
});
