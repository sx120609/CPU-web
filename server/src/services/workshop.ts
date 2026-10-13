import { Prisma, type PrismaClient, type WorkshopVersion, type WorkshopWork } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { lockWorkshopAuthor } from "./workshopAccountDeletion";
import type { WorkshopManifest } from "./workshopPackage";
import {
  assertWorkshopAdmin,
  assertWorkshopReview,
  assertWorkshopSubmission,
  canManageWorkshop,
  isWorkshopPublished,
  workshopSaveBytes,
  WORKSHOP_SAVE_ACCOUNT_BYTES,
  type WorkshopViewer,
} from "./workshopPolicy";

const MAX_AUTHOR_PACKAGE_BYTES = 300 * 1024 * 1024;
const MAX_AUTHOR_VERSIONS = 50;
type Database = PrismaClient;
type Tx = Prisma.TransactionClient;
export type WorkshopPage = {
  page: number;
  pageSize: number;
  q?: string;
  type?: "game" | "tool" | "extension";
  favorites?: boolean;
};
export type WorkshopAdminPage = WorkshopPage & {
  state?: "published" | "unpublished" | "disabled";
};
export type WorkshopReportPage = WorkshopPage & { reportStatus?: "open" | "resolved" };
export function workshopPagination(page: WorkshopPage, total: number) {
  return {
    page: page.page,
    pageSize: page.pageSize,
    total,
    totalPages: Math.ceil(total / page.pageSize),
  };
}

const versionSelect = {
  id: true,
  workId: true,
  version: true,
  name: true,
  description: true,
  type: true,
  manifest: true,
  status: true,
  reviewReason: true,
  createdAt: true,
  submittedAt: true,
  reviewedAt: true,
} satisfies Prisma.WorkshopVersionSelect;
type VersionRow = Pick<WorkshopVersion, keyof typeof versionSelect>;
function workInclude(userId?: number, allVersions = false) {
  return {
    author: { select: { id: true, nickname: true } },
    publishedVersion: { select: versionSelect },
    versions: {
      select: versionSelect,
      orderBy: { createdAt: "desc" as const },
      ...(allVersions ? {} : { take: 1 }),
    },
    _count: { select: { favorites: true } },
    favorites: { where: { userId: userId ?? -1 }, select: { userId: true } },
  } satisfies Prisma.WorkshopWorkInclude;
}
type WorkRow = WorkshopWork & {
  author: { id: number; nickname: string };
  publishedVersion: VersionRow | null;
  versions: VersionRow[];
  _count: { favorites: number };
  favorites: { userId: number }[];
};
export function workshopVersionDto(version: VersionRow, privateDetails = true) {
  return {
    id: version.id,
    workId: version.workId,
    version: version.version,
    name: version.name,
    description: version.description,
    type: version.type,
    manifest: version.manifest,
    status: version.status,
    reviewReason: privateDetails ? version.reviewReason : null,
    createdAt: version.createdAt,
    submittedAt: version.submittedAt,
    reviewedAt: version.reviewedAt,
  };
}
export function workshopWorkDto(
  work: WorkRow,
  options: { privateVersions?: boolean; latest?: boolean; version?: VersionRow } = {},
) {
  const version = options.version ?? (options.latest ? work.versions[0] : work.publishedVersion);
  return {
    id: work.id,
    slug: work.slug,
    author: work.author,
    disabled: work.disabled,
    publishedVersionId: work.publishedVersionId,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    favoriteCount: work._count.favorites,
    isFavorited: work.favorites.length > 0,
    version: version
      ? workshopVersionDto(
          version,
          Boolean(options.privateVersions || options.latest || options.version),
        )
      : null,
    ...(options.privateVersions
      ? { versions: work.versions.map((version) => workshopVersionDto(version)) }
      : {}),
  };
}

function publicWhere(): Prisma.WorkshopWorkWhereInput {
  return { disabled: false, publishedVersion: { is: { status: "APPROVED" } } };
}
function metadataWhere(page: WorkshopPage): Prisma.WorkshopVersionWhereInput {
  return {
    ...(page.type ? { type: page.type } : {}),
    ...(page.q
      ? {
          OR: [
            { name: { contains: page.q, mode: "insensitive" } },
            { description: { contains: page.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}
export async function listWorkshopWorks(
  page: WorkshopAdminPage,
  viewer?: WorkshopViewer,
  mode: "public" | "mine" | "admin" = "public",
) {
  if (mode === "admin") assertWorkshopAdmin(viewer);
  if ((mode === "mine" || page.favorites) && !viewer) throw Errors.unauthorized();
  const metadata = metadataWhere(page);
  const where: Prisma.WorkshopWorkWhereInput = {
    ...(mode === "public"
      ? { ...publicWhere(), publishedVersion: { is: { status: "APPROVED", ...metadata } } }
      : {}),
    ...(mode === "admin" && page.state
      ? page.state === "disabled"
        ? { disabled: true }
        : page.state === "published"
          ? publicWhere()
          : { disabled: false, publishedVersionId: null }
      : {}),
    ...(mode === "mine" ? { authorId: viewer!.userId } : {}),
    ...(mode !== "public" && (page.q || page.type) ? { versions: { some: metadata } } : {}),
    ...(page.favorites ? { favorites: { some: { userId: viewer!.userId } } } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.workshopWork.findMany({
      where,
      include: workInclude(viewer?.userId, mode === "mine"),
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    prisma.workshopWork.count({ where }),
  ]);
  return {
    items: items.map((work) =>
      workshopWorkDto(work, { latest: mode !== "public", privateVersions: mode === "mine" }),
    ),
    pagination: workshopPagination(page, total),
  };
}

export async function getWorkshopWork(id: string, viewer?: WorkshopViewer) {
  const work = await prisma.workshopWork.findUnique({
    where: { id },
    include: workInclude(viewer?.userId, true),
  });
  if (!work) throw Errors.notFound("作品不存在");
  const manage = canManageWorkshop(work, viewer);
  if (!manage && !isWorkshopPublished(work, work.publishedVersion))
    throw Errors.notFound("作品尚未公开或已下架");
  return workshopWorkDto(work, { privateVersions: manage, latest: manage });
}

async function lockWork(tx: Tx, id: string) {
  // Serialize submit/review/publication changes for one work, including different versions.
  await tx.$queryRaw`SELECT "id" FROM "WorkshopWork" WHERE "id" = ${id} FOR UPDATE`;
}
async function loadVersion(tx: Tx, id: string) {
  const initial = await tx.workshopVersion.findUnique({ where: { id }, select: { workId: true } });
  if (!initial) throw Errors.notFound("作品版本不存在");
  await lockWork(tx, initial.workId);
  const version = await tx.workshopVersion.findUnique({ where: { id }, include: { work: true } });
  if (!version) throw Errors.notFound("作品版本不存在");
  return version;
}

export async function createWorkshopDraft(
  input: {
    manifest: WorkshopManifest;
    files: string[];
    totalBytes: number;
    packageKey: string;
    expectedWorkId?: string;
  },
  viewer: WorkshopViewer,
  db: Database = prisma,
) {
  try {
    return await db.$transaction(async (tx) => {
      // Per-author lock also makes the aggregate disk quota race safe.
      await lockWorkshopAuthor(tx, viewer.userId);
      const author = await tx.user.findUnique({ where: { id: viewer.userId }, select: { status: true } });
      if (!author || ["banned", "deleting", "deleted"].includes(author.status))
        throw Errors.forbidden("账户已停止访问，无法上传作品");
      if (input.expectedWorkId) {
        const selected = await tx.workshopWork.findUnique({ where: { id: input.expectedWorkId } });
        if (!selected || selected.authorId !== viewer.userId)
          throw Errors.forbidden("无权更新所选作品");
        if (selected.slug !== input.manifest.id)
          throw Errors.badRequest("作品清单的 ID 与所选作品不一致");
      }
      const quota = await tx.workshopVersion.aggregate({
        where: { work: { authorId: viewer.userId } },
        _sum: { totalBytes: true },
        _count: { _all: true },
      });
      if (
        quota._count._all >= MAX_AUTHOR_VERSIONS ||
        (quota._sum.totalBytes ?? 0) + input.totalBytes > MAX_AUTHOR_PACKAGE_BYTES
      ) {
        throw Errors.badRequest("每位作者最多保存 50 个版本、300 MiB 作品内容");
      }
      let work = await tx.workshopWork.findUnique({ where: { slug: input.manifest.id } });
      if (work && work.authorId !== viewer.userId)
        throw Errors.conflict("这个作品 ID 已被其他作者使用");
      if (work) {
        await lockWork(tx, work.id);
        work = await tx.workshopWork.findUnique({ where: { id: work.id } });
        if (!work) throw Errors.notFound("作品不存在");
      }
      if (work?.disabled) throw Errors.forbidden("作品已被停用，请联系管理员");
      if (!work)
        work = await tx.workshopWork.create({
          data: { slug: input.manifest.id, authorId: viewer.userId },
        });
      const version = await tx.workshopVersion.create({
        data: {
          workId: work.id,
          version: input.manifest.version,
          name: input.manifest.name,
          description: input.manifest.description,
          type: input.manifest.type,
          manifest: input.manifest as Prisma.InputJsonValue,
          files: input.files,
          packageKey: input.packageKey,
          totalBytes: input.totalBytes,
        },
      });
      await tx.workshopWork.update({ where: { id: work.id }, data: { updatedAt: new Date() } });
      const dtoWork = await tx.workshopWork.findUnique({
        where: { id: work.id },
        include: workInclude(viewer.userId, true),
      });
      if (!dtoWork) throw Errors.server("作品创建失败");
      return {
        workId: work.id,
        versionId: version.id,
        version: workshopVersionDto(version),
        work: workshopWorkDto(dtoWork, { latest: true, privateVersions: true }),
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw Errors.conflict("作品 ID 或版本号已存在；更新请使用新的版本号");
    }
    throw error;
  }
}

export async function submitWorkshopVersion(
  id: string,
  viewer: WorkshopViewer,
  db: Database = prisma,
) {
  return db.$transaction(async (tx) => {
    const version = await loadVersion(tx, id);
    assertWorkshopSubmission(version.work, version, viewer);
    const pending = await tx.workshopVersion.count({
      where: { workId: version.workId, status: "PENDING" },
    });
    if (pending) throw Errors.conflict("这件作品已有一个待审核版本，请等待审核结果");
    const update = await tx.workshopVersion.updateMany({
      where: { id, status: version.status, runtimeRevision: version.runtimeRevision },
      data: {
        status: "PENDING",
        submittedAt: new Date(),
        reviewedAt: null,
        reviewReason: null,
        reviewerId: null,
        runtimeRevision: { increment: 1 },
      },
    });
    if (update.count !== 1) throw Errors.conflict("版本状态已变化，请刷新后重试");
    await tx.workshopWork.update({
      where: { id: version.workId },
      data: { updatedAt: new Date() },
    });
    await tx.workshopAudit.create({
      data: { workId: version.workId, versionId: id, actorId: viewer.userId, action: "submit" },
    });
    return { versionId: id, status: "PENDING" };
  });
}

export async function reviewWorkshopVersion(
  id: string,
  input: { decision: "approve" | "reject"; reason?: string },
  viewer: WorkshopViewer,
  db: Database = prisma,
) {
  assertWorkshopAdmin(viewer);
  return db.$transaction(async (tx) => {
    const version = await loadVersion(tx, id);
    assertWorkshopReview(version.work, version, viewer);
    const status = input.decision === "approve" ? "APPROVED" : "REJECTED";
    const update = await tx.workshopVersion.updateMany({
      where: { id, status: "PENDING", runtimeRevision: version.runtimeRevision },
      data: {
        status,
        reviewReason: input.reason?.trim() || null,
        reviewerId: viewer.userId,
        reviewedAt: new Date(),
        runtimeRevision: { increment: 1 },
      },
    });
    if (update.count !== 1) throw Errors.conflict("版本状态已变化，请刷新后重试");
    // No manifest/package mutation exists: publication points at the exact reviewed immutable package.
    await tx.workshopWork.update({
      where: { id: version.workId },
      data: {
        ...(status === "APPROVED"
          ? { publishedVersionId: id, runtimeRevision: { increment: 1 } }
          : {}),
        updatedAt: new Date(),
      },
    });
    await tx.workshopAudit.create({
      data: {
        workId: version.workId,
        versionId: id,
        actorId: viewer.userId,
        action: input.decision,
        reason: input.reason?.trim() || null,
      },
    });
    return { workId: version.workId, versionId: id, status };
  });
}

export async function setWorkshopWorkState(
  id: string,
  action: "unpublish" | "disable" | "enable",
  viewer: WorkshopViewer,
  db: Database = prisma,
) {
  assertWorkshopAdmin(viewer);
  return db.$transaction(async (tx) => {
    await lockWork(tx, id);
    const work = await tx.workshopWork.findUnique({ where: { id } });
    if (!work) throw Errors.notFound("作品不存在");
    await tx.workshopWork.update({
      where: { id },
      data: {
        ...(action === "unpublish"
          ? { publishedVersionId: null }
          : { disabled: action === "disable" }),
        runtimeRevision: { increment: 1 },
      },
    });
    await tx.workshopAudit.create({
      data: { workId: id, versionId: work.publishedVersionId, actorId: viewer.userId, action },
    });
    return { workId: id, action };
  });
}

export async function listWorkshopQueue(page: WorkshopPage, viewer: WorkshopViewer) {
  assertWorkshopAdmin(viewer);
  const where: Prisma.WorkshopVersionWhereInput = { status: "PENDING", ...metadataWhere(page) };
  const [versions, total] = await prisma.$transaction([
    prisma.workshopVersion.findMany({
      where,
      include: { work: { include: workInclude(viewer.userId) } },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    prisma.workshopVersion.count({ where }),
  ]);
  return {
    items: versions.map((version) => workshopWorkDto(version.work, { version })),
    pagination: workshopPagination(page, total),
  };
}

async function publicWork(id: string, tx: Tx = prisma) {
  const work = await tx.workshopWork.findUnique({
    where: { id },
    include: { publishedVersion: true },
  });
  if (!work || !isWorkshopPublished(work, work.publishedVersion))
    throw Errors.notFound("作品尚未公开或已下架");
  return work;
}
export async function favoriteWorkshopWork(id: string, viewer: WorkshopViewer, add: boolean) {
  if (add) await publicWork(id);
  if (add)
    await prisma.workshopFavorite.upsert({
      where: { workId_userId: { workId: id, userId: viewer.userId } },
      create: { workId: id, userId: viewer.userId },
      update: {},
    });
  else await prisma.workshopFavorite.deleteMany({ where: { workId: id, userId: viewer.userId } });
  return {
    isFavorited: add,
    favoriteCount: await prisma.workshopFavorite.count({ where: { workId: id } }),
  };
}
export async function reportWorkshopWork(id: string, reason: string, viewer: WorkshopViewer) {
  await publicWork(id);
  const existing = await prisma.workshopReport.findFirst({
    where: {
      workId: id,
      reporterId: viewer.userId,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (existing) throw Errors.conflict("你今天已经举报过这件作品");
  const report = await prisma.workshopReport.create({
    data: { workId: id, reporterId: viewer.userId, reason },
  });
  return { id: report.id };
}
export async function listWorkshopAudits(id: string, page: WorkshopPage, viewer: WorkshopViewer) {
  assertWorkshopAdmin(viewer);
  if (!(await prisma.workshopWork.findUnique({ where: { id }, select: { id: true } })))
    throw Errors.notFound("作品不存在");
  const where = { workId: id };
  const [items, total] = await prisma.$transaction([
    prisma.workshopAudit.findMany({
      where,
      select: {
        id: true, action: true, reason: true, createdAt: true,
        actor: { select: { id: true, nickname: true } },
        version: { select: { id: true, version: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    prisma.workshopAudit.count({ where }),
  ]);
  return { items, pagination: workshopPagination(page, total) };
}

const reportInclude = {
  reporter: { select: { id: true, nickname: true } },
  resolvedBy: { select: { id: true, nickname: true } },
  work: { select: { id: true, slug: true, publishedVersion: { select: { name: true } } } },
} satisfies Prisma.WorkshopReportInclude;
function workshopReportDto(report: Prisma.WorkshopReportGetPayload<{ include: typeof reportInclude }>) {
  return {
    id: report.id,
    reason: report.reason,
    createdAt: report.createdAt,
    resolvedAt: report.resolvedAt,
    resolution: report.resolution,
    resolvedBy: report.resolvedBy,
    reporter: report.reporter,
    work: {
      id: report.work.id,
      slug: report.work.slug,
      name: report.work.publishedVersion?.name || report.work.slug,
    },
  };
}
export async function listWorkshopReports(page: WorkshopReportPage, viewer: WorkshopViewer) {
  assertWorkshopAdmin(viewer);
  const where: Prisma.WorkshopReportWhereInput = page.reportStatus
    ? { resolvedAt: page.reportStatus === "open" ? null : { not: null } }
    : {};
  const [reports, total] = await prisma.$transaction([
    prisma.workshopReport.findMany({
      where,
      include: reportInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    prisma.workshopReport.count({ where }),
  ]);
  return { items: reports.map(workshopReportDto), pagination: workshopPagination(page, total) };
}

export async function resolveWorkshopReport(
  id: string,
  resolution: string,
  viewer: WorkshopViewer,
  db: Database = prisma,
) {
  assertWorkshopAdmin(viewer);
  resolution = resolution.trim();
  if (!resolution || resolution.length > 1000) throw Errors.badRequest("处理说明必填且最多 1000 字");
  return db.$transaction(async (tx) => {
    const report = await tx.workshopReport.findUnique({ where: { id } });
    if (!report) throw Errors.notFound("举报不存在");
    const update = await tx.workshopReport.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolution, resolvedById: viewer.userId },
    });
    if (update.count !== 1) throw Errors.conflict("举报已处理，请刷新后重试");
    await tx.workshopAudit.create({
      data: { workId: report.workId, actorId: viewer.userId, action: "resolve_report", reason: `举报 ${id}：${resolution}` },
    });
    const resolved = await tx.workshopReport.findUnique({ where: { id }, include: reportInclude });
    if (!resolved) throw Errors.notFound("举报不存在");
    return workshopReportDto(resolved);
  });
}

async function storageWork(tx: Tx, id: string, versionId: string) {
  const work = await publicWork(id, tx);
  const manifest = work.publishedVersion!.manifest as unknown as WorkshopManifest;
  if (work.publishedVersionId !== versionId)
    throw Errors.conflict("作品已更新或下架，请重新打开作品");
  if (!manifest.permissions?.includes("storage")) throw Errors.forbidden("此作品未申请存档权限");
  return work;
}
export async function readWorkshopSave(id: string, versionId: string, viewer: WorkshopViewer) {
  await storageWork(prisma, id, versionId);
  const save = await prisma.workshopSave.findUnique({
    where: { workId_userId: { workId: id, userId: viewer.userId } },
  });
  return { data: save?.data ?? null };
}
export async function writeWorkshopSave(
  id: string,
  versionId: string,
  data: unknown,
  viewer: WorkshopViewer,
) {
  const bytes = workshopSaveBytes(data);
  return prisma.$transaction(async (tx) => {
    await lockWork(tx, id);
    await storageWork(tx, id, versionId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${20261013}::int, ${viewer.userId}::int)`;
    const [quota, existing] = await Promise.all([
      tx.workshopSave.aggregate({ where: { userId: viewer.userId }, _sum: { bytes: true } }),
      tx.workshopSave.findUnique({
        where: { workId_userId: { workId: id, userId: viewer.userId } },
        select: { bytes: true },
      }),
    ]);
    if ((quota._sum.bytes ?? 0) - (existing?.bytes ?? 0) + bytes > WORKSHOP_SAVE_ACCOUNT_BYTES)
      throw Errors.badRequest("工坊云存档总量已达到 2 MiB，请清理其他作品存档");
    const json = data === null ? Prisma.JsonNull : (data as Prisma.InputJsonValue);
    await tx.workshopSave.upsert({
      where: { workId_userId: { workId: id, userId: viewer.userId } },
      create: { workId: id, userId: viewer.userId, data: json, bytes },
      update: { data: json, bytes },
    });
    return { saved: true };
  });
}
export async function listWorkshopSaves(page: WorkshopPage, viewer: WorkshopViewer, db: Database = prisma) {
  const where = { userId: viewer.userId };
  const [saves, total] = await db.$transaction([
    db.workshopSave.findMany({
      where,
      select: {
        workId: true, bytes: true, updatedAt: true,
        work: { select: { slug: true, publishedVersion: { select: { name: true } } } },
      },
      orderBy: [{ updatedAt: "desc" }, { workId: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    db.workshopSave.count({ where }),
  ]);
  return {
    items: saves.map((save) => ({
      workId: save.workId, name: save.work.publishedVersion?.name || save.work.slug,
      bytes: save.bytes, updatedAt: save.updatedAt,
    })),
    pagination: workshopPagination(page, total),
  };
}

export async function deleteWorkshopSave(id: string, _versionId: string | undefined, viewer: WorkshopViewer, db: Database = prisma) {
  return db.$transaction(async (tx) => {
    // Serialize quota release with saves in any work; publication does not govern ownership.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${20261013}::int, ${viewer.userId}::int)`;
    await tx.workshopSave.deleteMany({ where: { workId: id, userId: viewer.userId } });
    return { deleted: true };
  });
}
