import { prisma } from "../prisma";
import { buildRedisKey } from "./redis";
import { readJwxtSessionReplicaKey, saveJwxtSessionReplicaKey } from "./jwxtSessionReplica";
import type { AgentReplicaRecipient } from "./jwxtAgentReplicaCrypto";
import type { JwxtAgentAction, JwxtAgentInput, JwxtAgentOutput } from "./jwxtAgentProtocol";

type State = { ready: boolean; inFlight: number; maxConcurrent: number; replicaBackfill?: boolean };
type Request = <A extends JwxtAgentAction>(id: string, action: A, payload: JwxtAgentInput<A>, timeout?: number) => Promise<JwxtAgentOutput<A>>;

/** One gateway owns the bounded sweep. Rewrapping does not import a session or contact school SSO. */
export function startJwxtReplicaBackfill(recipients: () => AgentReplicaRecipient[], state: (id: string) => State, request: Request) {
  let stopped = false;
  let cursor = "";
  let timer: NodeJS.Timeout | undefined;
  let repaired = 0;
  let skipped = 0;
  let failures = 0;
  let lastReport = Date.now();
  const prefix = `${buildRedisKey("jwxt", "agent-session-replica")}:`;
  const tick = async () => {
    try {
      const targets = recipients();
      if (!process.env.DATABASE_URL || targets.length < 2 || !targets.some(target => state(target.agentId).replicaBackfill && state(target.agentId).ready)) return;
      const rows = await prisma.runtimeSession.findMany({
        where: { key: { startsWith: prefix, ...(cursor ? { gt: cursor } : {}) }, expiresAt: { gt: new Date() } },
        orderBy: { key: "asc" }, take: 50, select: { key: true, expiresAt: true },
      });
      for (const row of rows) {
        if (stopped) break;
        cursor = row.key;
        const stored = await readJwxtSessionReplicaKey(row.key);
        if (!stored || targets.every(target => stored.replicas.some(replica => replica.recipientAgentId === target.agentId))) continue;
        const source = stored.replicas.find(replica => {
          const s = state(replica.recipientAgentId);
          return s.ready && s.replicaBackfill && s.inFlight < Math.max(1, s.maxConcurrent - 1);
        });
        if (!source) { skipped++; continue; }
        try {
          const result = await request(source.recipientAgentId, "session.replicate-encrypted", { replica: source }, 5000);
          const changed = await saveJwxtSessionReplicaKey(row.key, stored.ownerAgentId, result.replicas, {
            expectedOwnerAgentId: stored.ownerAgentId, expectedOwnerEpoch: stored.ownerEpoch, mergeOnly: true,
            ttlMs: Math.max(1, row.expiresAt.getTime() - Date.now()),
          });
          if (changed) repaired++;
        } catch { failures++; }
      }
      if (Date.now() - lastReport >= 60000) {
        console.log(`[jwxt-agent] replica-backfill ${JSON.stringify({ repaired, skipped, failures, completedSweep: false })}`);
        lastReport = Date.now();
      }
      if (!rows.length) {
        console.log(`[jwxt-agent] replica-backfill ${JSON.stringify({ repaired, skipped, failures, completedSweep: true })}`);
        cursor = ""; repaired = 0; skipped = 0; failures = 0;
      }
    } catch {
      console.warn("[jwxt-agent] replica-backfill store temporarily unavailable");
    } finally {
      if (!stopped) { timer = setTimeout(tick, cursor ? 1000 : 60000); timer.unref(); }
    }
  };
  timer = setTimeout(tick, 1000); timer.unref();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
