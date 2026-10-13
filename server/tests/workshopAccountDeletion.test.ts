import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { revokeWorkshopAccountWorks, eraseWorkshopAccountData } from "../src/services/workshopAccountDeletion";
import { createWorkshopDraft, deleteWorkshopSave, listWorkshopSaves } from "../src/services/workshop";
import { isWorkshopTicketCurrent } from "../src/services/workshopPolicy";

test("account deletion revokes published, preview and placement eligibility before erasure", async () => {
  const work = { id: "work", authorId: 7, disabled: false, publishedVersionId: "version", runtimeRevision: 1 };
  const version = { id: "version", workId: work.id, status: "APPROVED", runtimeRevision: 1 };
  const ticket = { kind: "public" as const, workId: work.id, versionId: version.id, workRevision: 1, versionRevision: 1, expires: Date.now() + 60_000 };
  const tx = {
    $executeRaw: async () => 1,
    workshopWork: { updateMany: async ({ where, data }: any) => {
      assert.equal(where.authorId, work.authorId);
      Object.assign(work, { disabled: data.disabled, publishedVersionId: data.publishedVersionId, runtimeRevision: work.runtimeRevision + data.runtimeRevision.increment });
    } },
  } as unknown as Prisma.TransactionClient;
  assert.equal(isWorkshopTicketCurrent(ticket, work, version), true);
  await revokeWorkshopAccountWorks(tx, 7);
  assert.equal(isWorkshopTicketCurrent(ticket, work, version), false);
  assert.equal(isWorkshopTicketCurrent({ ...ticket, kind: "preview", viewerId: 7 }, work, version, { userId: 7, role: "user" }), false);
  assert.equal(work.publishedVersionId, null);
});

test("erasure captures every package before deleting rows and scopes personal cleanup to the subject", async () => {
  const calls: [string, any][] = [];
  let captured = false;
  const record = (label: string) => async (args: any) => { calls.push([label, args]); return { count: 1 }; };
  const tx = {
    $executeRaw: async () => 1,
    workshopVersion: {
      findMany: async (args: any) => { assert.deepEqual(args.where, { work: { authorId: 7 } }); captured = true; return [{ packageKey: "published" }, { packageKey: "draft" }]; },
      updateMany: record("reviews"),
    },
    workshopSave: { deleteMany: record("saves") }, workshopFavorite: { deleteMany: record("favorites") },
    workshopReport: { deleteMany: record("reports"), updateMany: record("resolutions") },
    workshopAudit: { updateMany: record("audits") },
    workshopWork: { updateMany: record("revoke"), deleteMany: async (args: any) => {
      assert.equal(captured, true); return record("works")(args);
    } },
  } as unknown as Prisma.TransactionClient;
  assert.deepEqual(await eraseWorkshopAccountData(tx, 7), ["published", "draft"]);
  for (const [label, args] of calls) {
    const key = ({ revoke: "authorId", works: "authorId", saves: "userId", favorites: "userId", reports: "reporterId", resolutions: "resolvedById", audits: "actorId", reviews: "reviewerId" } as Record<string, string>)[label];
    assert.deepEqual(args.where, { [key]: 7 });
  }
});

for (const status of ["deleting", "deleted", "banned"]) {
  test(`an admitted upload cannot create a draft once its author becomes ${status}`, async () => {
    let locked = false;
    const db = { $transaction: async (callback: any) => callback({
      $executeRaw: async () => { locked = true; },
      user: { findUnique: async () => { assert.equal(locked, true); return { status }; } },
    }) } as unknown as PrismaClient;
    await assert.rejects(createWorkshopDraft({ manifest: {} as any, files: [], totalBytes: 0, packageKey: "unused" }, { userId: 7, role: "user" }, db), /账户已停止访问/);
  });
}

test("save deletion releases only the caller's data without depending on work publication or version", async () => {
  const saves = [{ workId: "retired", userId: 7 }, { workId: "retired", userId: 8 }];
  const tx = {
    $executeRaw: async () => 1,
    workshopSave: { deleteMany: async ({ where }: any) => {
      for (let index = saves.length - 1; index >= 0; index--) if (saves[index].workId === where.workId && saves[index].userId === where.userId) saves.splice(index, 1);
    } },
  };
  const db = { $transaction: (callback: any) => callback(tx) } as unknown as PrismaClient;
  await deleteWorkshopSave("retired", undefined, { userId: 7, role: "user" }, db);
  assert.deepEqual(saves, [{ workId: "retired", userId: 8 }]);
  await deleteWorkshopSave("retired", "old-version", { userId: 7, role: "user" }, db);
  assert.equal(saves.length, 1);
});

test("save summaries are paginated per user and omit document and private-version contents", async () => {
  const updatedAt = new Date();
  const db = {
    $transaction: (queries: any[]) => Promise.all(queries),
    workshopSave: {
      findMany: async (query: any) => {
        assert.deepEqual(query.where, { userId: 7 });
        assert.equal(query.skip, 12); assert.equal(query.take, 12);
        assert.equal(query.select.data, undefined);
        assert.deepEqual(query.select.work.select, { slug: true, publishedVersion: { select: { name: true } } });
        return [{ workId: "retired", bytes: 64, updatedAt, work: { slug: "retired", publishedVersion: null } }];
      },
      count: async ({ where }: any) => { assert.deepEqual(where, { userId: 7 }); return 13; },
    },
  } as unknown as PrismaClient;
  const page = await listWorkshopSaves({ page: 2, pageSize: 12 }, { userId: 7, role: "user" }, db);
  assert.deepEqual(page.items, [{ workId: "retired", name: "retired", bytes: 64, updatedAt }]);
  assert.equal(page.pagination.totalPages, 2);
});
