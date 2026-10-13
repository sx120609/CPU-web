import type { PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { workshopManifestSchema } from "./workshopPackage";
import { workshopVersionDto, workshopPagination, type WorkshopPage } from "./workshop";
import {
  assertWorkshopAdmin,
  isWorkshopPublished,
  type WorkshopViewer,
  type WorkshopPolicyWork,
  type WorkshopPolicyVersion,
} from "./workshopPolicy";
export type WorkshopSlot = "splash" | "dialog";
export function workshopPlacementActive(
  slot: string,
  version: WorkshopPolicyVersion & { type: string; manifest: unknown; work: WorkshopPolicyWork },
) {
  if (!isWorkshopPublished(version.work, version) || version.type !== "extension") return false;
  const parsed = workshopManifestSchema.safeParse(version.manifest);
  return (
    parsed.success &&
    parsed.data.type === "extension" &&
    Boolean(parsed.data.extension?.slots.includes(slot as WorkshopSlot))
  );
}
export async function listWorkshopPlacements(viewer?: WorkshopViewer, db: PrismaClient = prisma) {
  if (viewer) assertWorkshopAdmin(viewer);
  const rows = await db.workshopPlacement.findMany({
    include: { version: { include: { work: true } } },
    orderBy: { slot: "asc" },
  });
  return {
    items: rows.flatMap((row) => {
      const active = workshopPlacementActive(row.slot, row.version);
      if (!viewer && !active) return [];
      return [
        {
          slot: row.slot,
          workId: row.version.workId,
          version: workshopVersionDto(row.version, Boolean(viewer)),
          maxDurationSeconds: row.slot === "splash" ? 15 : 120,
          ...(viewer ? { active, updatedAt: row.updatedAt } : {}),
        },
      ];
    }),
  };
}
export async function setWorkshopPlacement(
  slot: WorkshopSlot,
  versionId: string | null,
  viewer: WorkshopViewer,
  db: PrismaClient = prisma,
) {
  assertWorkshopAdmin(viewer);
  if (!["splash", "dialog"].includes(slot)) throw Errors.badRequest("插件位置无效");
  await db.$transaction(async (tx) => {
    // Serialize empty slots too; use the same work-row lock as review/disable.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${20261014}::int, ${slot === "splash" ? 1 : 2}::int)`;
    const prior = await tx.workshopPlacement.findUnique({
      where: { slot },
      include: { version: true },
    });
    if (versionId) {
      const initial = await tx.workshopVersion.findUnique({
        where: { id: versionId },
        select: { workId: true },
      });
      if (!initial) throw Errors.notFound("作品版本不存在");
      await tx.$queryRaw`SELECT "id" FROM "WorkshopWork" WHERE "id" = ${initial.workId} FOR UPDATE`;
      const version = await tx.workshopVersion.findUnique({
        where: { id: versionId },
        include: { work: true },
      });
      if (!version || !workshopPlacementActive(slot, version))
        throw Errors.conflict("只能启用已公开、未停用且声明此位置的站点插件版本");
      await tx.workshopPlacement.upsert({
        where: { slot },
        create: { slot, versionId },
        update: { versionId },
      });
      await tx.workshopAudit.create({
        data: {
          workId: version.workId,
          versionId,
          actorId: viewer.userId,
          action: "placement-set",
          reason: JSON.stringify({ slot, previousVersionId: prior?.versionId ?? null }),
        },
      });
    } else if (prior) {
      await tx.workshopPlacement.delete({ where: { slot } });
      await tx.workshopAudit.create({
        data: {
          workId: prior.version.workId,
          versionId: prior.versionId,
          actorId: viewer.userId,
          action: "placement-remove",
          reason: slot,
        },
      });
    }
  });
  return listWorkshopPlacements(viewer, db);
}
export async function listWorkshopPublicCatalog(page: WorkshopPage, db: PrismaClient = prisma) {
  page = { ...page, pageSize: Math.min(12, page.pageSize) };
  const where = {
    disabled: false,
    publishedVersion: {
      is: {
        status: "APPROVED",
        ...(page.type ? { type: page.type } : {}),
        ...(page.q
          ? {
              OR: [
                { name: { contains: page.q, mode: "insensitive" as const } },
                { description: { contains: page.q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
    },
  };
  const [rows, total] = await db.$transaction([
    db.workshopWork.findMany({
      where,
      select: {
        id: true,
        slug: true,
        publishedVersion: { select: { name: true, description: true, type: true, version: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: Math.min(12, page.pageSize),
    }),
    db.workshopWork.count({ where }),
  ]);
  return {
    items: rows.flatMap((row) =>
      row.publishedVersion
        ? [
            {
              id: row.id,
              slug: row.slug,
              name: row.publishedVersion.name,
              description: row.publishedVersion.description,
              type: row.publishedVersion.type,
              version: row.publishedVersion.version,
            },
          ]
        : [],
    ),
    pagination: workshopPagination(page, total),
  };
}
