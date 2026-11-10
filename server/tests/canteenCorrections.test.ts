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
  submitCanteenCorrection,
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
    count: async ({ where }: Row) => [...corrections.values()].filter((row) => matches(row, where)).length,
    create: async ({ data }: Row) => {
      const row = {
        id: `n${corrections.size + 1}`, shopId: "", patch: "", aiNote: "", status: "voting", agreeCount: 0, disagreeCount: 0,
        attempts: 0, lockedAt: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date(), ...data,
      };
      corrections.set(row.id, row);
      return row;
    },
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

test("one correction can split a listing into two shops on the same floor, but not add shops elsewhere", async () => {
  const store = fakeStore();
  const row = (id: string) => ({
    id, userId: 1, shopId: "2.1::掉渣饼卫孔记", kind: "其他", content: "掉渣饼和卫孔记面馆，是两家店", status: "approved",
    agreeCount: 6, disagreeCount: 0, patch: "", aiNote: "", attempts: 0, lockedAt: null, resolvedAt: null, updatedAt: new Date(),
  });
  store.corrections.set("s1", row("s1"));
  const saved = prisma.canteenCorrection;
  (prisma as any).canteenCorrection = store.tx.canteenCorrection;
  invalidateCanteenCatalog();
  try {
    canteenCorrectionAi.decide = async () => ({ decision: "apply", patches: [
      { op: "rename", shopId: "2.1::掉渣饼卫孔记", name: "掉渣饼" },
      { op: "add", floorCode: "2.1", name: "卫孔记面馆", tags: ["noodle"] },
    ] });
    await processApprovedCanteenCorrections();
    const done = store.corrections.get("s1")!;
    assert.equal(done.status, "applied");
    assert.equal(done.shopId, "2.1::掉渣饼");
    assert.match(done.aiNote, /改名为「掉渣饼」；二食堂一楼新增「卫孔记面馆」/);
    invalidateCanteenCatalog();
    const { index } = await getCanteenCatalog();
    assert.equal(index.find("2.1::掉渣饼卫孔记")?.name, "掉渣饼");
    assert.deepEqual(index.find("2.1::卫孔记面馆")?.tags, ["noodle"]);

    store.corrections.set("s2", { ...row("s2"), shopId: "2.1::掉渣饼" });
    canteenCorrectionAi.decide = async () => ({ decision: "apply", patches: [
      { op: "rename", shopId: "2.1::掉渣饼", name: "掉渣饼老店" },
      { op: "add", floorCode: "1.3", name: "另一家店", tags: ["rice"] },
    ] });
    await processApprovedCanteenCorrections();
    assert.equal(store.corrections.get("s2")!.status, "rejected");
  } finally {
    (prisma as any).canteenCorrection = saved;
    invalidateCanteenCatalog();
  }
});

function useStore(store: ReturnType<typeof fakeStore>) {
  const saved = { transaction: prisma.$transaction, correction: prisma.canteenCorrection, vote: prisma.canteenCorrectionVote };
  prisma.$transaction = (async (fn: any) => fn(store.tx)) as any;
  (prisma as any).canteenCorrection = store.tx.canteenCorrection;
  (prisma as any).canteenCorrectionVote = store.tx.canteenCorrectionVote;
  invalidateCanteenCatalog();
  return () => {
    prisma.$transaction = saved.transaction;
    (prisma as any).canteenCorrection = saved.correction;
    (prisma as any).canteenCorrectionVote = saved.vote;
    invalidateCanteenCatalog();
  };
}

test("a new shop with floor, name and category goes live after the vote without asking the AI", async () => {
  const store = fakeStore();
  for (let id = 1; id <= 10; id += 1) store.users.set(id, { status: "active", mutedUntil: null });
  const restore = useStore(store);
  try {
    await assert.rejects(submitCanteenCorrection({ kind: "新增门店", floorCode: "2.3", name: "姬小满韩式拌饭", tags: [] }, { userId: 1 }), /卖什么/);
    await assert.rejects(submitCanteenCorrection({ kind: "新增门店", floorCode: "9.9", name: "姬小满韩式拌饭", tags: ["rice"] }, { userId: 1 }), /楼层/);
    await assert.rejects(submitCanteenCorrection({ kind: "新增门店", floorCode: "2.3", name: "手工馄饨", tags: ["soup"] }, { userId: 1 }), /已经有这家店/);
    const { id } = await submitCanteenCorrection({ kind: "新增门店", floorCode: "2.3", name: "姬小满韩式拌饭", tags: ["rice", "regional"] }, { userId: 1 });
    await assert.rejects(submitCanteenCorrection({ kind: "新增门店", floorCode: "2.3", name: "姬小满韩式拌饭", tags: ["rice"] }, { userId: 2 }), /投一票/);
    let asked = 0;
    canteenCorrectionAi.decide = async () => { asked += 1; return { decision: "reject", note: "不该问 AI" }; };
    for (let voter = 2; voter <= CANTEEN_CORRECTION_THRESHOLD + 2; voter += 1) await voteCanteenCorrection(id, true, { userId: voter });
    await processApprovedCanteenCorrections();
    const row = store.corrections.get(id)!;
    assert.equal(row.status, "applied");
    assert.equal(row.shopId, "2.3::姬小满韩式拌饭");
    assert.match(row.aiNote, /二食堂三楼新增「姬小满韩式拌饭」/);
    assert.equal(asked, 0);
    invalidateCanteenCatalog();
    const { index } = await getCanteenCatalog();
    assert.deepEqual(index.find("2.3::姬小满韩式拌饭")?.tags, ["rice", "regional"]);
  } finally {
    restore();
  }
});

test("a written new-shop request without a shop is added by the AI on the floor it names", async () => {
  const store = fakeStore();
  store.corrections.set("a1", {
    id: "a1", userId: 1, shopId: "", kind: "新增门店", content: "二食堂三楼新开了一家姬小满韩式拌饭。", status: "approved",
    agreeCount: 6, disagreeCount: 0, patch: "", aiNote: "", attempts: 0, lockedAt: null, resolvedAt: null, updatedAt: new Date(),
  });
  const restore = useStore(store);
  try {
    let seen: any = null;
    canteenCorrectionAi.decide = async (row, index) => {
      seen = { shopId: row.shopId, floors: index.canteens.length };
      return { decision: "apply", patches: [{ op: "add", floorCode: "2.3", name: "姬小满韩式拌饭", tags: ["rice"] }] };
    };
    await processApprovedCanteenCorrections();
    assert.equal(seen.shopId, "");
    assert.equal(store.corrections.get("a1")!.status, "applied");

    // 新增门店不能顺手删别的店。
    store.corrections.set("a2", { ...store.corrections.get("a1")!, id: "a2", status: "approved", shopId: "", patch: "", content: "一食堂一楼新开了老王拌面" });
    canteenCorrectionAi.decide = async () => ({ decision: "apply", patches: [{ op: "remove", shopId: "1.1::粥员外" }] });
    await processApprovedCanteenCorrections();
    assert.equal(store.corrections.get("a2")!.status, "rejected");
  } finally {
    restore();
  }
});

test("more than the threshold of disagreeing votes closes the correction", async () => {
  const store = fakeStore();
  for (let id = 1; id <= 10; id += 1) store.users.set(id, { status: "active", mutedUntil: null });
  store.corrections.set("d1", {
    id: "d1", userId: 1, shopId: "1.1::粥员外", kind: "删除门店", content: "关门了", status: "voting",
    agreeCount: 0, disagreeCount: 0, patch: "", aiNote: "", attempts: 0, lockedAt: null, resolvedAt: null, updatedAt: new Date(),
  });
  const restore = useStore(store);
  try {
    let last;
    for (let voter = 2; voter <= CANTEEN_CORRECTION_THRESHOLD + 2; voter += 1) last = await voteCanteenCorrection("d1", false, { userId: voter });
    assert.equal(last!.status, "rejected");
    assert.match(store.corrections.get("d1")!.aiNote, /认为不对/);
  } finally {
    restore();
  }
});
