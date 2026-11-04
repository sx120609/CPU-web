import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/prisma";

test.afterEach(() => { canteenCorrectionAi.decide = originalDecide; });
import {
  BASE_CANTEEN_INDEX,
  applyCanteenPatch,
  buildCanteenCatalog,
  parseCanteenPatch,
} from "../src/shared/canteenCatalog";
import {
  CANTEEN_CORRECTION_THRESHOLD,
  canteenCorrectionAi,
  getCanteenCatalog,
  invalidateCanteenCatalog,
  processApprovedCanteenCorrections,
  voteCanteenCorrection,
} from "../src/services/canteenCorrections";

const originalDecide = canteenCorrectionAi.decide;

test("catalog patches rename, move, retag, add and remove shops and keep old ids findable", () => {
  const catalog = buildCanteenCatalog([
    { op: "rename", shopId: "1.1::张良麻辣烫", name: "张亮麻辣烫" },
    { op: "move", shopId: "1.1::宿莱堡", floorCode: "1.3" },
    { op: "retag", shopId: "2.1::塔斯汀", tags: ["western", "snack"] },
    { op: "add", floorCode: "1.3", name: "新开的面馆", tags: ["noodle"] },
    { op: "remove", shopId: "2.2::喜掌柜" },
  ]);
  const renamed = catalog.find("1.1::张良麻辣烫");
  assert.equal(renamed?.id, "1.1::张亮麻辣烫");
  assert.deepEqual(renamed?.formerIds, ["1.1::张良麻辣烫"]);
  const moved = catalog.find("1.1::宿莱堡");
  assert.equal(moved?.floorCode, "1.3");
  assert.equal(moved?.level, 3);
  assert.deepEqual(catalog.find("2.1::塔斯汀")?.tags, ["western", "snack"]);
  assert.equal(catalog.find("1.3::新开的面馆")?.canteenName, "一食堂");
  assert.equal(catalog.find("2.2::喜掌柜"), undefined);
  assert.equal(catalog.shops.length, BASE_CANTEEN_INDEX.shops.length);
  // The base catalog is never mutated.
  assert.ok(BASE_CANTEEN_INDEX.find("1.1::张良麻辣烫")?.formerIds.length === 0);
});

test("invalid patches are refused with a reason", () => {
  const base = BASE_CANTEEN_INDEX.canteens;
  assert.match((applyCanteenPatch(base, { op: "rename", shopId: "1.1::张良麻辣烫", name: "东北风味" }) as any).error, /同名/);
  assert.match((applyCanteenPatch(base, { op: "move", shopId: "1.1::张良麻辣烫", floorCode: "9.9" }) as any).error, /楼层/);
  assert.match((applyCanteenPatch(base, { op: "remove", shopId: "nope" }) as any).error, /不存在/);
  assert.match((applyCanteenPatch(base, { op: "add", floorCode: "1.1", name: "x", tags: ["noodle"] }) as any).error, /长度/);
  assert.equal(parseCanteenPatch({ op: "retag", shopId: "1.1::张良麻辣烫", tags: ["hotpot"] }), null);
  assert.equal(parseCanteenPatch({ op: "drop-table" }), null);
  assert.deepEqual(parseCanteenPatch('{"op":"remove","shopId":" 2.2::喜掌柜 "}'), { op: "remove", shopId: "2.2::喜掌柜" });
});

type Row = Record<string, any>;

function fakeStore() {
  const corrections = new Map<string, Row>();
  const votes = new Map<string, Row>();
  const users = new Map<number, Row>();
  const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some((item) => matches(row, item));
    if (key === "user") return !(value.status?.notIn || []).includes(users.get(row.userId)?.status);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("in" in value) return value.in.includes(row[key]);
      if ("lt" in value) return row[key] && row[key] < value.lt;
      if ("not" in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
  const correction = {
    findMany: async ({ where }: Row = {}) => [...corrections.values()].filter((row) => matches(row, where)).sort((a, b) => (a.resolvedAt?.getTime() ?? 0) - (b.resolvedAt?.getTime() ?? 0)),
    findUnique: async ({ where }: Row) => corrections.get(where.id) ?? null,
    findFirst: async ({ where }: Row) => [...corrections.values()].find((row) => matches(row, where)) ?? null,
    update: async ({ where, data }: Row) => {
      const row = corrections.get(where.id)!;
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }: Row) => {
      const rows = [...corrections.values()].filter((row) => matches(row, where));
      for (const row of rows) {
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in (value as Row) ? row[key] + (value as Row).increment : value;
      }
      return { count: rows.length };
    },
  };
  const vote = {
    upsert: async ({ create, update }: Row) => {
      const key = `${create.correctionId}:${create.userId}`;
      votes.set(key, { ...(votes.get(key) || create), ...update });
    },
    count: async ({ where }: Row) => [...votes.values()].filter((row) => row.correctionId === where.correctionId && row.agree === where.agree && matches(row, { user: where.user })).length,
  };
  const user = { findUnique: async ({ where }: Row) => users.get(where.id) ?? null };
  return { corrections, users, tx: { canteenCorrection: correction, canteenCorrectionVote: vote, user, $executeRaw: async () => 1 } };
}

test("the sixth agreeing voter hands the correction to the AI, whose validated patch goes live", async () => {
  const store = fakeStore();
  for (let id = 1; id <= 10; id += 1) store.users.set(id, { status: "active", mutedUntil: null });
  store.corrections.set("c1", {
    id: "c1", userId: 1, shopId: "2.2::喜掌柜", kind: "店名不对", content: "现在叫喜掌柜米饭", status: "voting",
    agreeCount: 0, disagreeCount: 0, patch: "", aiNote: "", attempts: 0, lockedAt: null, resolvedAt: null, updatedAt: new Date(),
  });
  const saved = { transaction: prisma.$transaction, correction: prisma.canteenCorrection, vote: prisma.canteenCorrectionVote };
  prisma.$transaction = (async (fn: any) => fn(store.tx)) as any;
  (prisma as any).canteenCorrection = store.tx.canteenCorrection;
  (prisma as any).canteenCorrectionVote = store.tx.canteenCorrectionVote;
  invalidateCanteenCatalog();
  try {
    await assert.rejects(voteCanteenCorrection("c1", true, { userId: 1 }), /自己/);
    let asked = 0;
    canteenCorrectionAi.decide = async () => {
      asked += 1;
      return { decision: "apply", patch: { op: "rename", shopId: "2.2::喜掌柜", name: "喜掌柜米饭" }, note: "店名改为喜掌柜米饭" };
    };
    for (let voter = 2; voter <= CANTEEN_CORRECTION_THRESHOLD + 2; voter += 1) {
      const result = await voteCanteenCorrection("c1", true, { userId: voter });
      assert.equal(result.status, voter <= CANTEEN_CORRECTION_THRESHOLD + 1 ? "voting" : "approved");
    }
    // The vote that crossed the line started processing in the background; this joins that run.
    await processApprovedCanteenCorrections();
    const row = store.corrections.get("c1")!;
    assert.equal(row.agreeCount, CANTEEN_CORRECTION_THRESHOLD + 1);
    assert.equal(row.status, "applied");
    assert.equal(row.shopId, "2.2::喜掌柜米饭");
    invalidateCanteenCatalog();
    const { index, version } = await getCanteenCatalog();
    assert.equal(index.find("2.2::喜掌柜")?.name, "喜掌柜米饭");
    assert.notEqual(version, "base");
    assert.equal(asked, 1);
  } finally {
    prisma.$transaction = saved.transaction;
    (prisma as any).canteenCorrection = saved.correction;
    (prisma as any).canteenCorrectionVote = saved.vote;
    invalidateCanteenCatalog();
  }
});

test("an AI patch aimed at a different shop is refused", async () => {
  const store = fakeStore();
  store.corrections.set("c2", {
    id: "c2", userId: 1, shopId: "1.1::粥员外", kind: "删除门店", content: "粥员外关门了", status: "approved",
    agreeCount: 6, disagreeCount: 0, patch: "", aiNote: "", attempts: 0, lockedAt: null, resolvedAt: null, updatedAt: new Date(),
  });
  const saved = prisma.canteenCorrection;
  (prisma as any).canteenCorrection = store.tx.canteenCorrection;
  invalidateCanteenCatalog();
  try {
    canteenCorrectionAi.decide = async () => ({ decision: "apply", patch: { op: "remove", shopId: "1.1::张良麻辣烫" } });
    await processApprovedCanteenCorrections();
    const row = store.corrections.get("c2")!;
    assert.equal(row.status, "rejected");
    assert.match(row.aiNote, /不是这家店/);
  } finally {
    (prisma as any).canteenCorrection = saved;
    invalidateCanteenCatalog();
  }
});
