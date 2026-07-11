import crypto from "node:crypto";
import { deleteEphemeralValue, getEphemeralValue, runWithDistributedLock, setEphemeralValue } from "./cache";
import { buildRedisKey } from "./redis";
import { validateReplicaEnvelope, type AgentEncryptedSessionReplica } from "./jwxtAgentReplicaCrypto";

type StoredReplica = {
  version: 2;
  ownerAgentId: string;
  revision: number;
  capturedAt: number;
  replicas: AgentEncryptedSessionReplica[];
};

export type JwxtSessionReplica = StoredReplica;
export const JWXT_SESSION_REPLICA_TTL_MS = 30 * 60 * 1000;
const REPLICA_PREFIX = buildRedisKey("jwxt", "agent-session-replica");

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function jwxtSessionReplicaKey(token: string) {
  return `${REPLICA_PREFIX}:${tokenHash(token)}`;
}

async function readStoredReplica(token: string): Promise<StoredReplica | null> {
  const raw = await getEphemeralValue(jwxtSessionReplicaKey(token));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredReplica;
    if (
      parsed?.version !== 2 || typeof parsed.ownerAgentId !== "string" || !parsed.ownerAgentId
      || parsed.ownerAgentId.length > 64 || !Number.isInteger(parsed.revision) || parsed.revision < 1
      || !Number.isFinite(parsed.capturedAt) || !Array.isArray(parsed.replicas)
      || parsed.replicas.length < 1 || parsed.replicas.length > 32
    ) throw new Error("invalid replica");
    const recipients = new Set<string>();
    for (const replica of parsed.replicas) {
      validateReplicaEnvelope(replica);
      if (recipients.has(replica.recipientAgentId)) throw new Error("duplicate replica recipient");
      recipients.add(replica.recipientAgentId);
    }
    return parsed;
  } catch {
    // v1 contained a main-service-decryptable snapshot. Discard it instead of retaining the old trust model.
    await deleteEphemeralValue(jwxtSessionReplicaKey(token));
    return null;
  }
}

export async function loadJwxtSessionReplica(token: string) {
  return readStoredReplica(token);
}

export async function saveJwxtSessionReplica(
  token: string,
  ownerAgentId: string,
  replicas: AgentEncryptedSessionReplica[],
) {
  if (!token || token.length > 512 || !ownerAgentId || ownerAgentId.length > 64 || !replicas.length) return false;
  for (const replica of replicas) validateReplicaEnvelope(replica);
  if (!replicas.some((item) => item.recipientAgentId === ownerAgentId)) return false;
  const capturedAt = Math.max(...replicas.map((item) => item.capturedAt));
  const hash = tokenHash(token);
  const locked = await runWithDistributedLock(`jwxt-session-replica-write:${hash}`, 5_000, async () => {
    const existing = await readStoredReplica(token);
    if (existing && existing.capturedAt > capturedAt) return false;
    const record: StoredReplica = {
      version: 2,
      ownerAgentId,
      revision: (existing?.revision ?? 0) + 1,
      capturedAt,
      replicas,
    };
    await setEphemeralValue(jwxtSessionReplicaKey(token), JSON.stringify(record), JWXT_SESSION_REPLICA_TTL_MS);
    return true;
  });
  return locked.acquired && Boolean(locked.result);
}

export async function deleteJwxtSessionReplica(token: string) {
  if (token) await deleteEphemeralValue(jwxtSessionReplicaKey(token));
}

export async function runWithJwxtSessionMigrationLock<T>(token: string, task: () => Promise<T>) {
  return runWithDistributedLock(`jwxt-session-migrate:${tokenHash(token)}`, 15_000, task);
}
