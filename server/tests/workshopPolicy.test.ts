import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  assertWorkshopSubmission,
  canManageWorkshop,
  isWorkshopTicketCurrent,
  workshopSaveBytes,
  WORKSHOP_SAVE_MAX_BYTES,
  type WorkshopRuntimeTicket,
} from "../src/services/workshopPolicy";
import { resolveWorkshopReport, reviewWorkshopVersion, setWorkshopWorkState, submitWorkshopVersion } from "../src/services/workshop";
import { signWorkshopTicket, verifyWorkshopTicket } from "../src/services/workshopRuntime";

const owner = { userId: 1, role: "user" };
const admin = { userId: 2, role: "admin" };
const moderator = { userId: 3, role: "mod" };
const stranger = { userId: 4, role: "user" };
const workId = "ff134744-87b1-402f-a311-6341944bb10c";
const versionId = "dd134744-87b1-402f-a311-6341944bb10c";
const priorId = "aa134744-87b1-402f-a311-6341944bb10c";
function fixture(status = "DRAFT", publishedVersionId: string | null = priorId) {
  const work = {
    id: workId,
    authorId: owner.userId,
    disabled: false,
    publishedVersionId,
    runtimeRevision: 1,
  };
  const version = {
    id: versionId,
    workId,
    status,
    runtimeRevision: 1,
    manifest: { name: "reviewed" },
    packageKey: "immutable",
  };
  const audits: unknown[] = [];
  const mutations: unknown[] = [];
  let rejectCompareAndSwap = false;
  const tx = {
    $queryRaw: async () => [],
    workshopVersion: {
      findUnique: async ({ select }: { select?: unknown }) =>
        select ? { workId } : { ...version, work: { ...work } },
      count: async () => (version.status === "PENDING" ? 1 : 0),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, any> }) => {
        mutations.push({ where, data });
        if (
          rejectCompareAndSwap ||
          version.status !== where.status ||
          version.runtimeRevision !== where.runtimeRevision
        )
          return { count: 0 };
        version.status = data.status;
        version.runtimeRevision++;
        return { count: 1 };
      },
    },
    workshopWork: {
      findUnique: async () => ({ ...work }),
      update: async ({ data }: { data: Record<string, any> }) => {
        if ("publishedVersionId" in data) work.publishedVersionId = data.publishedVersionId;
        if ("disabled" in data) work.disabled = data.disabled;
        if (data.runtimeRevision) work.runtimeRevision++;
        return { ...work };
      },
    },
    workshopAudit: {
      create: async ({ data }: { data: unknown }) => {
        audits.push(data);
        return data;
      },
    },
  };
  // Represents DB serialization under the service's FOR UPDATE work lock.
  let tail: Promise<unknown> = Promise.resolve();
  const db = {
    $transaction: (callback: (tx: unknown) => unknown) => {
      const next = tail.then(() => callback(tx));
      tail = next.catch(() => undefined);
      return next;
    },
  } as unknown as PrismaClient;
  return {
    db,
    work,
    version,
    audits,
    mutations,
    rejectSwap: () => {
      rejectCompareAndSwap = true;
    },
  };
}

test("submission ownership and unpublished reapproval preserve current publication", async () => {
  const state = fixture();
  await assert.rejects(() => submitWorkshopVersion(versionId, stranger, state.db), /只有作者/u);
  await submitWorkshopVersion(versionId, owner, state.db);
  assert.equal(state.work.publishedVersionId, priorId);
  assert.equal(state.version.status, "PENDING");
  await assert.rejects(() => submitWorkshopVersion(versionId, owner, state.db), /提交审核/u);
  assert.equal(state.audits.length, 1);
  assert.equal(canManageWorkshop(state.work, moderator), false);
  assert.equal(canManageWorkshop(state.work, admin), true);
  const approved = fixture("APPROVED", null);
  await submitWorkshopVersion(versionId, owner, approved.db);
  assert.equal(approved.version.status, "PENDING");
  assert.throws(
    () =>
      assertWorkshopSubmission(
        { ...approved.work, publishedVersionId: priorId },
        { ...approved.version, status: "APPROVED" },
        owner,
      ),
    /提交审核/u,
  );
});

test("only main-site admin reviews; rejecting update keeps existing public package", async () => {
  const state = fixture("PENDING");
  await assert.rejects(
    () => reviewWorkshopVersion(versionId, { decision: "approve" }, owner, state.db),
    /只有管理员/u,
  );
  await assert.rejects(
    () => reviewWorkshopVersion(versionId, { decision: "approve" }, moderator, state.db),
    /只有管理员/u,
  );
  await reviewWorkshopVersion(versionId, { decision: "reject", reason: "请修改" }, admin, state.db);
  assert.equal(state.version.status, "REJECTED");
  assert.equal(state.work.publishedVersionId, priorId);
  assert.equal(state.work.runtimeRevision, 1);
  assert.deepEqual(state.version.manifest, { name: "reviewed" });
  assert.equal(state.version.packageKey, "immutable");
  assert.deepEqual(state.audits[0], { workId, versionId, actorId: 2, action: "reject", reason: "请修改" });
});

test("concurrent duplicate approval publishes once and records one exact-version audit", async () => {
  const state = fixture("PENDING");
  const results = await Promise.allSettled([
    reviewWorkshopVersion(versionId, { decision: "approve" }, admin, state.db),
    reviewWorkshopVersion(versionId, { decision: "approve" }, admin, state.db),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(state.work.publishedVersionId, versionId);
  assert.equal(state.work.runtimeRevision, 2);
  assert.equal(state.audits.length, 1);
  assert.deepEqual(state.version.manifest, { name: "reviewed" });
});

test("failed compare-and-swap never changes publication or audit", async () => {
  const state = fixture("PENDING");
  state.rejectSwap();
  await assert.rejects(
    () => reviewWorkshopVersion(versionId, { decision: "approve" }, admin, state.db),
    /状态已变化/u,
  );
  assert.equal(state.work.publishedVersionId, priorId);
  assert.equal(state.audits.length, 0);
});

test("unpublish, disable and re-enable revoke previous runtime tickets", async () => {
  const state = fixture("APPROVED", versionId);
  const ticket: WorkshopRuntimeTicket = {
    kind: "public",
    workId,
    versionId,
    workRevision: 1,
    versionRevision: 1,
    expires: Date.now() + 60_000,
  };
  assert.equal(isWorkshopTicketCurrent(ticket, state.work, state.version), true);
  await setWorkshopWorkState(workId, "disable", admin, state.db);
  assert.equal(isWorkshopTicketCurrent(ticket, state.work, state.version), false);
  await setWorkshopWorkState(workId, "enable", admin, state.db);
  assert.equal(isWorkshopTicketCurrent(ticket, state.work, state.version), false);
  const refreshed = { ...ticket, workRevision: state.work.runtimeRevision };
  assert.equal(isWorkshopTicketCurrent(refreshed, state.work, state.version), true);
  await setWorkshopWorkState(workId, "unpublish", admin, state.db);
  assert.equal(state.version.status, "APPROVED");
  assert.equal(isWorkshopTicketCurrent(refreshed, state.work, state.version), false);
  assert.equal(state.audits.length, 3);
});

test("private review preview requires the recorded owner/admin and current version revision", () => {
  const state = fixture("PENDING");
  const ticket: WorkshopRuntimeTicket = {
    kind: "preview",
    viewerId: owner.userId,
    workId,
    versionId,
    workRevision: 1,
    versionRevision: 1,
    expires: Date.now() + 60_000,
  };
  assert.equal(isWorkshopTicketCurrent(ticket, state.work, state.version, owner), true);
  assert.equal(isWorkshopTicketCurrent(ticket, state.work, state.version, stranger), false);
  assert.equal(
    isWorkshopTicketCurrent({ ...ticket, viewerId: admin.userId }, state.work, state.version, admin),
    true,
  );
  assert.equal(
    isWorkshopTicketCurrent({ ...ticket, viewerId: moderator.userId }, state.work, state.version, moderator),
    false,
  );
  assert.equal(
    isWorkshopTicketCurrent(ticket, state.work, { ...state.version, runtimeRevision: 2 }, owner),
    false,
  );
  assert.equal(isWorkshopTicketCurrent({ ...ticket, expires: 1 }, state.work, state.version, owner), false);
});

test("runtime signatures reject forged/expired/cross-secret ticket claims", () => {
  const claims = {
    kind: "public" as const,
    workId,
    versionId,
    workRevision: 1,
    versionRevision: 1,
    expires: 10000,
    frameOrigins: ["https://example.com"],
  };
  const ticket = signWorkshopTicket(claims, "test-secret");
  assert.deepEqual(verifyWorkshopTicket(ticket, "test-secret", 9000), claims);
  assert.throws(() => verifyWorkshopTicket(ticket, "other-secret", 9000), /无效/u);
  assert.throws(() => verifyWorkshopTicket(ticket, "test-secret", 10000), /过期/u);
  assert.throws(() => verifyWorkshopTicket(`${ticket.slice(0, -4)}abcd`, "test-secret", 9000), /无效/u);
});

test("save quotas measure encoded JSON bytes, including multibyte content", () => {
  assert.equal(workshopSaveBytes({ name: "药大" }), Buffer.byteLength(JSON.stringify({ name: "药大" })));
  assert.throws(() => workshopSaveBytes("中".repeat(WORKSHOP_SAVE_MAX_BYTES / 2)), /64 KiB/u);
  assert.equal(workshopSaveBytes(null), 4);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => workshopSaveBytes(cyclic), /JSON/u);
});


test("report resolution checks admin and explanation before database access", async () => {
  const db = { $transaction: () => { throw new Error("unexpected database access"); } } as unknown as PrismaClient;
  for (const viewer of [owner, moderator])
    await assert.rejects(() => resolveWorkshopReport(workId, "已核查", viewer, db), /只有管理员/u);
  for (const resolution of ["   ", "中".repeat(1001)])
    await assert.rejects(() => resolveWorkshopReport(workId, resolution, admin, db), /处理说明/u);
});

test("competing report resolutions accept one administrator and record one audit", async () => {
  const report = {
    id: priorId, workId, reason: "违规内容", createdAt: new Date(),
    resolvedAt: null as Date | null, resolution: null as string | null, resolvedById: null as number | null,
    resolvedBy: null as { id: number; nickname: string } | null,
    reporter: { id: owner.userId, nickname: "作者" },
    work: { id: workId, slug: "test-work", publishedVersion: null },
  };
  const audits: any[] = [];
  const tx = {
    workshopReport: {
      findUnique: async () => ({ ...report }),
      updateMany: async ({ data }: { data: { resolvedAt: Date; resolution: string; resolvedById: number } }) => {
        if (report.resolvedAt) return { count: 0 };
        Object.assign(report, data, { resolvedBy: { id: data.resolvedById, nickname: "管理员" } });
        return { count: 1 };
      },
    },
    workshopAudit: { create: async ({ data }: { data: any }) => { audits.push(data); } },
  };
  const db = { $transaction: (callback: (tx: unknown) => unknown) => callback(tx) } as unknown as PrismaClient;
  const results = await Promise.allSettled([
    resolveWorkshopReport(priorId, "  已核查并处理  ", admin, db),
    resolveWorkshopReport(priorId, "另一个处理决定", { userId: 5, role: "admin" }, db),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(report.resolution, "已核查并处理");
  assert.equal(report.resolvedById, admin.userId);
  assert.ok(report.resolvedAt);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "resolve_report");
  assert.equal(audits[0].actorId, admin.userId);
  assert.match(audits[0].reason, new RegExp(priorId));
  const success = results.find((result) => result.status === "fulfilled");
  assert.ok(success?.status === "fulfilled");
  assert.deepEqual(success.value.resolvedBy, { id: admin.userId, nickname: "管理员" });
});
