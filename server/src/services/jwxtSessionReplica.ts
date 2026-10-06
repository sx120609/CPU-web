import crypto from "node:crypto";
import { config } from "../config";
import { deleteEphemeralValue, getEphemeralValue, runWithDistributedLock, setEphemeralValue } from "./cache";
import { buildRedisKey } from "./redis";
import { validateReplicaEnvelope, type AgentEncryptedSessionReplica } from "./jwxtAgentReplicaCrypto";

type StoredReplica = {
  version: 2;
  ownerAgentId: string;
  revision: number;
  ownerEpoch: number;
  capturedAt: number;
  replicas: AgentEncryptedSessionReplica[];
};
type SaveOptions = { expectedOwnerEpoch?: number; expectedOwnerAgentId?: string; takeover?: boolean; mergeOnly?: boolean; ttlMs?: number };

export type JwxtSessionReplica = StoredReplica;
export const JWXT_SESSION_REPLICA_TTL_MS = config.jwxtSessionIdleMs;
const REPLICA_PREFIX = buildRedisKey("jwxt", "agent-session-replica");

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function jwxtSessionReplicaKey(token: string) {
  return `${REPLICA_PREFIX}:${tokenHash(token)}`;
}

async function readStoredReplica(token: string): Promise<StoredReplica | null> {
  return readJwxtSessionReplicaKey(jwxtSessionReplicaKey(token));
}

export async function readJwxtSessionReplicaKey(key: string): Promise<StoredReplica | null> {
  if (!key.startsWith(`${REPLICA_PREFIX}:`)) return null;
  const raw = await getEphemeralValue(key);
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
    parsed.ownerEpoch = Number.isInteger(parsed.ownerEpoch) && parsed.ownerEpoch >= 1 ? parsed.ownerEpoch : 1;
    return parsed;
  } catch {
    // v1 contained a main-service-decryptable snapshot. Discard it instead of retaining the old trust model.
    await deleteEphemeralValue(key);
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
  options: SaveOptions = {},
) {
  if (!token || token.length > 512 || !ownerAgentId || ownerAgentId.length > 64 || !replicas.length) return false;
  return saveJwxtSessionReplicaKey(jwxtSessionReplicaKey(token), ownerAgentId, replicas, options);
}

export async function saveJwxtSessionReplicaKey(
  key: string,
  ownerAgentId: string,
  replicas: AgentEncryptedSessionReplica[],
  options: SaveOptions = {},
) {
  if (!key.startsWith(`${REPLICA_PREFIX}:`) || !replicas.length) return false;
  for (const replica of replicas) validateReplicaEnvelope(replica);
  if (replicas.some(replica => Buffer.from(replica.tokenHash, "base64url").toString("hex") !== key.slice(REPLICA_PREFIX.length + 1))) return false;
  if (!replicas.some((item) => item.recipientAgentId === ownerAgentId)) return false;
  const capturedAt = Math.max(...replicas.map((item) => item.capturedAt));
  const hash = key.slice(REPLICA_PREFIX.length + 1);
  const locked = await runWithDistributedLock(`jwxt-session-replica-write:${hash}`, 5_000, async () => {
    const existing = await readJwxtSessionReplicaKey(key);
    if (!existing && (options.takeover || options.mergeOnly || options.expectedOwnerEpoch)) return false;
    if (existing && options.expectedOwnerEpoch !== undefined && existing.ownerEpoch !== options.expectedOwnerEpoch) return false;
    if (existing && options.expectedOwnerAgentId !== undefined && existing.ownerAgentId !== options.expectedOwnerAgentId) return false;
    if (existing && existing.ownerAgentId !== ownerAgentId && !options.takeover) return false;
    if (existing && existing.capturedAt > capturedAt) return false;
    const merged = new Map((existing?.replicas ?? []).map(replica => [replica.recipientAgentId, replica]));
    for (const replica of replicas) {
      if (!options.mergeOnly || !merged.has(replica.recipientAgentId)) merged.set(replica.recipientAgentId, replica);
    }
    const record: StoredReplica = {
      version: 2,
      ownerAgentId,
      revision: (existing?.revision ?? 0) + 1,
      ownerEpoch: (existing?.ownerEpoch ?? 1) + (existing && existing.ownerAgentId !== ownerAgentId ? 1 : 0),
      capturedAt,
      replicas: (options.mergeOnly ? [...merged.values()] : [
        ...replicas, ...[...merged.values()].filter(item => !replicas.some(replica => replica.recipientAgentId === item.recipientAgentId)),
      ]).slice(0, 32),
    };
    await setEphemeralValue(key, JSON.stringify(record), options.ttlMs ?? JWXT_SESSION_REPLICA_TTL_MS);
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
