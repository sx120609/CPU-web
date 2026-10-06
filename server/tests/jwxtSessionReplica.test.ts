import assert from "node:assert/strict";
import test from "node:test";

test("encrypted backfill preserves owner and token binding, rejects stale copies and cannot resurrect a logout", async () => {
  process.env.REDIS_ENABLED = "false";
  process.env.DATABASE_URL = "";
  process.env.JWT_SECRET = "replica-test-secret-0123456789abcdef";
  const crypto = await import("../src/services/jwxtAgentReplicaCrypto");
  const store = await import("../src/services/jwxtSessionReplica");
  const a = crypto.generateAgentReplicaIdentity();
  const b = crypto.generateAgentReplicaIdentity();
  const token = "test-token-not-exported-to-backfill";
  const snapshot = { version: 1 as const, jar: { "school.test": { SID: "private-cookie" } }, username: "private-user", createdAt: Date.now(), lastSeenAt: Date.now() };
  const copies = crypto.encryptSessionSnapshotForRecipients(snapshot, token, [{ agentId: "a", publicKey: a.publicKey }]);
  assert.equal(await store.saveJwxtSessionReplica(token, "a", copies), true);
  const backfilled = crypto.reencryptSessionReplica(copies[0], "a", a, [{ agentId: "a", publicKey: a.publicKey }, { agentId: "b", publicKey: b.publicKey }]);
  assert.equal(JSON.stringify(backfilled).includes("private-cookie"), false);
  assert.equal(await store.saveJwxtSessionReplicaKey(store.jwxtSessionReplicaKey(token), "a", backfilled, { mergeOnly: true, expectedOwnerEpoch: 1 }), true);
  assert.equal((await store.loadJwxtSessionReplica(token))?.ownerEpoch, 1);
  assert.equal((await store.loadJwxtSessionReplica(token))?.replicas.length, 2);
  assert.deepEqual(crypto.decryptSessionSnapshotReplica(backfilled[1], token, "b", b), snapshot);
  assert.throws(() => crypto.decryptSessionSnapshotReplica(backfilled[1], "wrong-token", "b", b));
  assert.equal(await store.saveJwxtSessionReplica(token, "b", backfilled, { takeover: true, expectedOwnerAgentId: "a", expectedOwnerEpoch: 1 }), true);
  assert.equal(await store.saveJwxtSessionReplicaKey(store.jwxtSessionReplicaKey(token), "a", backfilled, { mergeOnly: true, expectedOwnerEpoch: 1 }), false);
  await store.deleteJwxtSessionReplica(token);
  assert.equal(await store.saveJwxtSessionReplicaKey(store.jwxtSessionReplicaKey(token), "a", backfilled, { mergeOnly: true, expectedOwnerEpoch: 1 }), false);
  assert.equal(await store.loadJwxtSessionReplica(token), null);
});
