import type { ForumReportTargetType } from "./forumReportPolicy";

type ForumReportLockTransaction = {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

const LOCK_NAMESPACES: Record<ForumReportTargetType, number> = {
  topic: 73101,
  reply: 73102,
  direct_message: 73103,
};

export async function acquireForumReportTargetLock(
  transaction: ForumReportLockTransaction,
  targetType: ForumReportTargetType,
  targetId: number,
) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACES[targetType]}, ${targetId})`;
}
