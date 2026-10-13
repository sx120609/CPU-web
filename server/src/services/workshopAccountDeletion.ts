import type { Prisma } from "@prisma/client";

export async function lockWorkshopAuthor(tx: Prisma.TransactionClient, userId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${20261012}::int, ${userId}::int)`;
}

export async function revokeWorkshopAccountWorks(tx: Prisma.TransactionClient, userId: number) {
  await lockWorkshopAuthor(tx, userId);
  await tx.workshopWork.updateMany({
    where: { authorId: userId },
    data: { disabled: true, publishedVersionId: null, runtimeRevision: { increment: 1 } },
  });
}

/** Return file keys before cascading rows disappear; the deletion job persists them for retries. */
export async function eraseWorkshopAccountData(tx: Prisma.TransactionClient, userId: number) {
  await revokeWorkshopAccountWorks(tx, userId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${20261013}::int, ${userId}::int)`;
  const packages = await tx.workshopVersion.findMany({
    where: { work: { authorId: userId } },
    select: { packageKey: true },
  });
  await tx.workshopSave.deleteMany({ where: { userId } });
  await tx.workshopFavorite.deleteMany({ where: { userId } });
  await tx.workshopReport.deleteMany({ where: { reporterId: userId } });
  await tx.workshopAudit.updateMany({
    where: { actorId: userId }, data: { actorId: null, reason: null },
  });
  await tx.workshopVersion.updateMany({
    where: { reviewerId: userId }, data: { reviewerId: null, reviewReason: null },
  });
  await tx.workshopReport.updateMany({
    where: { resolvedById: userId }, data: { resolvedById: null, resolution: null },
  });
  // Versions, placements and other users' records for these works cascade with the work.
  await tx.workshopWork.deleteMany({ where: { authorId: userId } });
  return packages.map(({ packageKey }) => packageKey);
}
