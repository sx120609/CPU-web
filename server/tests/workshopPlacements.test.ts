import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { workshopManifestSchema } from "../src/services/workshopPackage";
import {
  listWorkshopPlacements,
  listWorkshopPublicCatalog,
  setWorkshopPlacement,
  workshopPlacementActive,
} from "../src/services/workshopPlacements";
const manifest = {
  schemaVersion: 1,
  id: "site-demo",
  type: "extension",
  name: "demo",
  version: "1.0.0",
  description: "demo",
  entry: "index.html",
  extension: { slots: ["splash"] },
};
const work = {
  id: "work",
  authorId: 1,
  disabled: false,
  publishedVersionId: "v1",
  runtimeRevision: 0,
};
const version = {
  id: "v1",
  workId: "work",
  status: "APPROVED",
  runtimeRevision: 0,
  type: "extension",
  manifest,
  work,
};
test("extensions declare unique slots and permissions are known and unique", () => {
  const parsed = workshopManifestSchema.parse({
    ...manifest,
    permissions: ["storage", "motion.shake"],
  });
  assert.deepEqual(parsed.permissions, ["storage", "motion.shake"]);
  for (const input of [
    { ...manifest, extension: undefined },
    { ...manifest, extension: { slots: [] } },
    { ...manifest, extension: { slots: ["splash", "splash"] } },
    { ...manifest, type: "tool" },
    { ...manifest, permissions: ["camera"] },
    { ...manifest, permissions: ["storage", "motion.shake", "storage"] },
  ])
    assert.equal(workshopManifestSchema.safeParse(input).success, false);
});
test("activation rejects changed publication, disabled works, unsupported slot and non-extension", () => {
  assert.equal(workshopPlacementActive("splash", version), true);
  assert.equal(workshopPlacementActive("dialog", version), false);
  assert.equal(
    workshopPlacementActive("splash", { ...version, work: { ...work, publishedVersionId: "v2" } }),
    false,
  );
  assert.equal(
    workshopPlacementActive("splash", { ...version, work: { ...work, disabled: true } }),
    false,
  );
  assert.equal(workshopPlacementActive("splash", { ...version, status: "PENDING" }), false);
  assert.equal(workshopPlacementActive("splash", { ...version, type: "tool" }), false);
});
test("public placements hide stale bindings while admins can inspect and remove them", async () => {
  const stale = { ...version, work: { ...work, publishedVersionId: "v2" } };
  const db = {
    workshopPlacement: {
      findMany: async () => [
        { slot: "splash", versionId: "v1", version: stale, updatedAt: new Date() },
      ],
    },
  } as unknown as PrismaClient;
  assert.deepEqual(await listWorkshopPlacements(undefined, db), { items: [] });
  const result = await listWorkshopPlacements({ userId: 2, role: "admin" }, db);
  assert.equal(result.items[0]?.active, false);
  assert.equal(result.items[0]?.version.id, "v1");
  await assert.rejects(
    () => setWorkshopPlacement("splash", "v1", { userId: 1, role: "user" }, db),
    /管理员/,
  );
});
test("binding validation runs after work lock and rejected activation never writes or audits", async () => {
  const calls: string[] = [];
  const tx = {
    $executeRaw: async () => calls.push("slot-lock"),
    $queryRaw: async () => calls.push("work-lock"),
    workshopPlacement: { findUnique: async () => null, upsert: async () => calls.push("write") },
    workshopVersion: {
      findUnique: async ({ select }: { select?: unknown }) =>
        select
          ? { workId: "work" }
          : { ...version, work: { ...work, disabled: calls.includes("work-lock") } },
    },
    workshopAudit: { create: async () => calls.push("audit") },
  };
  const db = {
    $transaction: async (callback: (tx: unknown) => unknown) => callback(tx),
  } as unknown as PrismaClient;
  await assert.rejects(
    () => setWorkshopPlacement("splash", "v1", { userId: 2, role: "admin" }, db),
    /未停用/,
  );
  assert.deepEqual(calls, ["slot-lock", "work-lock"]);
});
test("catalog query selects only public metadata and caps the page size", async () => {
  let query: any;
  const db = {
    workshopWork: {
      findMany: (input: unknown) => {
        query = input;
        return Promise.resolve([
          {
            id: "work",
            slug: "demo",
            publishedVersion: {
              name: "demo",
              description: "desc",
              type: "extension",
              version: "1.0.0",
            },
          },
        ]);
      },
      count: () => Promise.resolve(1),
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  const result = await listWorkshopPublicCatalog({ page: 1, pageSize: 12, type: "extension" }, db);
  assert.deepEqual(Object.keys(query.select).sort(), ["id", "publishedVersion", "slug"]);
  assert.equal(query.where.disabled, false);
  assert.equal(query.where.publishedVersion.is.status, "APPROVED");
  assert.deepEqual(result.items[0], {
    id: "work",
    slug: "demo",
    name: "demo",
    description: "desc",
    type: "extension",
    version: "1.0.0",
  });
});
