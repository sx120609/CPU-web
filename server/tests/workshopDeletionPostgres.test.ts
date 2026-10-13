import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

test("workshop account erasure revokes tickets, removes owned records and retries package cleanup on PostgreSQL", {
  skip: !process.env.WORKSHOP_TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const url = new URL(process.env.WORKSHOP_TEST_DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/cpu_apns_regression");
  assert.equal(url.searchParams.get("schema"), "workshop_test");
  const serverRoot = path.resolve(__dirname, "..");
  await promisify(execFile)(process.execPath, [
    path.join(serverRoot, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", path.join(serverRoot, "prisma/schema.prisma"),
  ], { cwd: serverRoot, env: { ...process.env, DATABASE_URL: url.href } });
  const root = await mkdtemp(path.join(tmpdir(), "workshop-account-deletion-"));
  const originalStorage = process.env.WORKSHOP_STORAGE_ROOT;
  const originalDatabase = process.env.DATABASE_URL;
  process.env.WORKSHOP_STORAGE_ROOT = root;
  process.env.DATABASE_URL = url.href;
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  (globalThis as any).prisma = db;
  const users: number[] = [];
  try {
    const { requestAccountDeletion, processAccountDeletion } = await import("../src/services/accountDeletion");
    const { signWorkshopTicket, loadWorkshopRuntime } = await import("../src/services/workshopRuntime");
    const { removeWorkshopPackage } = await import("../src/services/workshopPackage");
    const { deleteWorkshopSave, listWorkshopSaves, createWorkshopDraft } = await import("../src/services/workshop");
    const { listWorkshopPlacements } = await import("../src/services/workshopPlacements");
    const owner = await db.user.create({ data: { username: `workshop-delete-${randomUUID()}`, passwordHash: "test", nickname: "Owner" } });
    const other = await db.user.create({ data: { username: `workshop-other-${randomUUID()}`, passwordHash: "test", nickname: "Other" } });
    users.push(owner.id, other.id);
    const makeWork = async (authorId: number, type = "tool") => {
      const work = await db.workshopWork.create({ data: { slug: `work-${randomUUID()}`, authorId } });
      const packageKey = randomUUID();
      await mkdir(path.join(root, packageKey));
      await writeFile(path.join(root, packageKey, "index.html"), "private authored content");
      const version = await db.workshopVersion.create({ data: {
        workId: work.id, version: "1.0.0", name: "Test work", description: "Test", type,
        manifest: {
          schemaVersion: 1, id: work.slug, type, name: "Test work", description: "Test", version: "1.0.0", entry: "index.html", permissions: ["storage"],
          ...(type === "extension" ? { extension: { slots: ["dialog"] } } : {}),
        }, files: ["index.html"], packageKey, totalBytes: 24, status: "APPROVED",
      } });
      await db.workshopWork.update({ where: { id: work.id }, data: { publishedVersionId: version.id } });
      return { work, version, packageKey };
    };
    const owned = await makeWork(owner.id, "extension"), untouched = await makeWork(other.id);
    await db.workshopPlacement.create({ data: { slot: "dialog", versionId: owned.version.id } });
    await db.workshopSave.createMany({ data: [
      { workId: owned.work.id, userId: owner.id, data: { private: "owner" }, bytes: 20 },
      { workId: owned.work.id, userId: other.id, data: { private: "other" }, bytes: 20 },
      { workId: untouched.work.id, userId: owner.id, data: { private: "owner elsewhere" }, bytes: 30 },
      { workId: untouched.work.id, userId: other.id, data: { private: "keep" }, bytes: 20 },
    ] });
    await db.workshopFavorite.create({ data: { workId: untouched.work.id, userId: owner.id } });
    await db.workshopReport.create({ data: { workId: untouched.work.id, reporterId: owner.id, reason: "private report" } });
    const otherReport = await db.workshopReport.create({ data: { workId: untouched.work.id, reporterId: other.id, reason: "keep", resolvedById: owner.id, resolution: "private resolution", resolvedAt: new Date() } });
    const audit = await db.workshopAudit.create({ data: { workId: untouched.work.id, actorId: owner.id, action: "review", reason: "private audit" } });
    await db.workshopVersion.update({ where: { id: untouched.version.id }, data: { reviewerId: owner.id, reviewReason: "private review" } });
    const ticket = signWorkshopTicket({ kind: "public", workId: owned.work.id, versionId: owned.version.id, workRevision: 0, versionRevision: 0, expires: Date.now() + 60_000, frameOrigins: ["https://cputime.cn"] });
    await loadWorkshopRuntime(ticket);
    assert.equal((await listWorkshopPlacements()).items.length, 1);
    const deletion = await requestAccountDeletion(owner.id);
    await assert.rejects(loadWorkshopRuntime(ticket), /撤销/);
    assert.equal((await listWorkshopPlacements()).items.length, 0);
    assert.equal((await db.workshopWork.findUniqueOrThrow({ where: { id: owned.work.id } })).disabled, true);
    await assert.rejects(createWorkshopDraft({ manifest: owned.version.manifest as any, files: [], totalBytes: 0, packageKey: "unused" }, { userId: owner.id, role: "user" }), /账户已停止访问/);
    let failPackage = true;
    const dependencies = {
      deleteSessions: async () => {}, deleteMedia: async () => {}, deleteVoiceHub: async () => {},
      deleteWorkshopPackage: async (packageKey: string) => {
        if (failPackage) throw new Error("temporary disk failure");
        await removeWorkshopPackage(packageKey);
      },
    };
    await processAccountDeletion(deletion.id, dependencies);
    let job = await db.accountDeletionJob.findUniqueOrThrow({ where: { id: deletion.id } });
    assert.equal(job.status, "retry"); assert.equal(job.phase, "external"); assert.equal(job.lastError, "workshop");
    assert.equal(job.completedAt, null); assert.ok(job.encryptedPayload);
    assert.equal(await db.workshopWork.count({ where: { authorId: owner.id } }), 0);
    assert.equal(await db.workshopPlacement.count({ where: { versionId: owned.version.id } }), 0);
    assert.equal(await db.workshopSave.count({ where: { userId: owner.id } }), 0);
    assert.equal(await db.workshopFavorite.count({ where: { userId: owner.id } }), 0);
    assert.equal(await db.workshopReport.count({ where: { reporterId: owner.id } }), 0);
    const cleanedAudit = await db.workshopAudit.findUniqueOrThrow({ where: { id: audit.id } });
    assert.equal(cleanedAudit.actorId, null); assert.equal(cleanedAudit.reason, null);
    const cleanedVersion = await db.workshopVersion.findUniqueOrThrow({ where: { id: untouched.version.id } });
    assert.equal(cleanedVersion.reviewerId, null); assert.equal(cleanedVersion.reviewReason, null);
    const cleanedReport = await db.workshopReport.findUniqueOrThrow({ where: { id: otherReport.id } });
    assert.equal(cleanedReport.resolvedById, null); assert.equal(cleanedReport.resolution, null); assert.equal(cleanedReport.reason, "keep");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).status, "deleted");
    await access(path.join(root, owned.packageKey, "index.html"));
    failPackage = false;
    await processAccountDeletion(deletion.id, dependencies);
    job = await db.accountDeletionJob.findUniqueOrThrow({ where: { id: deletion.id } });
    assert.equal(job.status, "completed"); assert.equal(job.encryptedPayload, null);
    await assert.rejects(access(path.join(root, owned.packageKey)));
    await access(path.join(root, untouched.packageKey, "index.html"));
    assert.equal(await db.workshopWork.count({ where: { authorId: other.id } }), 1);
    assert.equal(await db.workshopSave.count({ where: { userId: other.id } }), 1);
    await db.workshopWork.update({ where: { id: untouched.work.id }, data: { disabled: true, publishedVersionId: null } });
    const summaries = await listWorkshopSaves({ page: 1, pageSize: 12 }, { userId: other.id, role: "user" });
    assert.equal(summaries.items[0].workId, untouched.work.id);
    await deleteWorkshopSave(untouched.work.id, undefined, { userId: owner.id, role: "user" });
    assert.equal(await db.workshopSave.count({ where: { userId: other.id } }), 1);
    await deleteWorkshopSave(untouched.work.id, undefined, { userId: other.id, role: "user" });
    assert.equal(await db.workshopSave.count({ where: { userId: other.id } }), 0);
  } finally {
    await db.accountDeletionJob.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
    await rm(root, { recursive: true, force: true });
    if (originalStorage === undefined) delete process.env.WORKSHOP_STORAGE_ROOT;
    else process.env.WORKSHOP_STORAGE_ROOT = originalStorage;
    if (originalDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabase;
    delete (globalThis as any).prisma;
  }
});
