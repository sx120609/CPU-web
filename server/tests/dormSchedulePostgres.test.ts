import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

test("dorm membership, snapshots and concurrency on isolated PostgreSQL", {
  skip: !process.env.DORM_TEST_DATABASE_URL,
  timeout: 120_000,
}, async (t) => {
  const url = new URL(process.env.DORM_TEST_DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.searchParams.get("schema"), "dorm_test");
  const serverRoot = path.resolve(__dirname, "..");
  await promisify(execFile)(process.execPath, [
    path.join(serverRoot, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", path.join(serverRoot, "prisma/schema.prisma"),
  ], { cwd: serverRoot, env: { ...process.env, DATABASE_URL: url.href } });
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.href;
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  (globalThis as any).prisma = db;
  const users: number[] = [];
  const links: number[] = [];
  const user = async () => {
    const row = await db.user.create({ data: { username: `dorm-${randomUUID()}`, nickname: "室友", passwordHash: "test" } });
    users.push(row.id);
    return row.id;
  };
  const snapshot = {
    semester: "2026-2027-1",
    schedule: { scope: "semester", semesters: [], weeks: [], currentSemester: "2026-2027-1", currentWeek: "1", cells: [{ day: 1, bigSlot: 1, courses: [{ name: "药理学", weeks: "1-16周", weekList: [1] }] }] },
    calendar: { currentWeek: 1, semesterStart: "2026-09-07", semesterEnd: "2027-01-17", weeks: [] },
  };
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };
  async function waitForDormWaiters(count: number) {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'
        AND (query LIKE '%DormLink%' OR query LIKE '%DormMember%')`;
      if (Number(row.count) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("operations must reach the database lock barrier");
  }
  // Force both operations to wait on the same dorm, rather than hoping that a
  // race appears on a fast test machine. This also fails the old count/insert
  // implementation: both inserts pass their capacity check before waiting.
  async function raceAtDorm<T>(linkId: number, operations: (() => Promise<T>)[]) {
    const locked = deferred();
    const release = deferred();
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "DormLink" WHERE "id" = ${linkId} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const results = Promise.allSettled(operations.map((operation) => operation()));
    try {
      await waitForDormWaiters(operations.length);
    } finally {
      release.resolve();
      await holder;
    }
    return results;
  }
  try {
    const dorm = await import("../src/services/dormSchedule");
    const create = async (ownerId: number) => {
      const status = await dorm.createDormInvite(ownerId);
      assert.equal(status.status, "active");
      if (status.status !== "active") throw new Error("missing dorm");
      links.push(status.id);
      assert.ok(status.invite?.code);
      return { id: status.id, code: status.invite.code! };
    };

    await t.test("only one concurrent join gets the last place, and full invites expire", async () => {
      const owner = await user();
      const house = await create(owner);
      for (let i = 0; i < dorm.DORM_MEMBER_LIMIT - 2; i++) await dorm.joinDorm(await user(), house.code);
      const a = await user();
      const b = await user();
      const outcomes = await raceAtDorm(house.id, [() => dorm.joinDorm(a, house.code), () => dorm.joinDorm(b, house.code)]);
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(await db.dormMember.count({ where: { linkId: house.id } }), dorm.DORM_MEMBER_LIMIT);
      assert.equal((await db.dormLink.findUniqueOrThrow({ where: { id: house.id } })).inviteCode, null);
    });

    await t.test("a cancelled code is rechecked after waiting for the dorm lock", async () => {
      const owner = await user();
      const house = await create(owner);
      const entrant = await user();
      const locked = deferred();
      const release = deferred();
      const holder = db.$transaction(async (tx) => {
        await tx.dormLink.update({ where: { id: house.id }, data: { inviteCode: null, inviteExpiresAt: null } });
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      const joining = dorm.joinDorm(entrant, house.code);
      const rejected = assert.rejects(joining, /不存在或已过期/u);
      try {
        // The old code is visible until the cancellation commits.
        await waitForDormWaiters(1);
      } finally {
        release.resolve();
        await holder;
      }
      await rejected;
      assert.equal(await db.dormMember.count({ where: { userId: entrant } }), 0);
    });

    await t.test("one account racing to join two dorms only joins one", async () => {
      const first = await create(await user());
      const second = await create(await user());
      const entrant = await user();
      const outcomes = await Promise.allSettled([dorm.joinDorm(entrant, first.code), dorm.joinDorm(entrant, second.code)]);
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(await db.dormMember.count({ where: { userId: entrant } }), 1);
    });

    await t.test("a final departure racing a join never leaves an ownerless dorm", async () => {
      const owner = await user();
      const house = await create(owner);
      const entrant = await user();
      await raceAtDorm(house.id, [() => dorm.leaveDorm(owner), () => dorm.joinDorm(entrant, house.code)]);
      const remaining = await db.dormMember.findMany({ where: { linkId: house.id } });
      assert.equal(await db.dormMember.count({ where: { userId: owner } }), 0);
      if (remaining.length) assert.deepEqual(remaining.map((member) => [member.userId, member.role]), [[entrant, "owner"]]);
      else assert.equal(await db.dormLink.count({ where: { id: house.id } }), 0);
    });

    await t.test("owner and successor can leave together without losing the remaining owner", async () => {
      const owner = await user();
      const house = await create(owner);
      const second = await user();
      const third = await user();
      await dorm.joinDorm(second, house.code);
      await dorm.joinDorm(third, house.code);
      const outcomes = await raceAtDorm(house.id, [() => dorm.leaveDorm(owner), () => dorm.leaveDorm(second)]);
      assert.ok(outcomes.every((result) => result.status === "fulfilled"));
      const remaining = await db.dormMember.findMany({ where: { linkId: house.id } });
      assert.deepEqual(remaining.map((member) => [member.userId, member.role]), [[third, "owner"]]);
      await db.$transaction((tx) => dorm.deleteDormDataForUser(tx, third));
      assert.equal(await db.dormLink.count({ where: { id: house.id } }), 0);
    });

    await t.test("permissions, snapshot deletion, transfer and atomic settings", async () => {
      const owner = await user();
      const house = await create(owner);
      const member = await user();
      const outsider = await user();
      await dorm.joinDorm(member, house.code);
      await assert.rejects(dorm.getDormSchedules(outsider), /还没有加入/u);
      await assert.rejects(dorm.saveDormScheduleSnapshot(outsider, snapshot), /还没有加入/u);
      await assert.rejects(dorm.removeDormMember(member, owner), /只有舍长/u);
      await assert.rejects(dorm.updateDormSettings(member, { name: "越权" }), /只有舍长/u);
      await assert.rejects(dorm.createDormInvite(member), /只有舍长/u);
      await assert.rejects(dorm.cancelDormInvite(member), /只有舍长/u);
      await assert.rejects(dorm.updateDormSettings(owner, { name: "不能保存", myColor: "rainbow" }), /没有这种颜色/u);
      assert.equal((await db.dormLink.findUniqueOrThrow({ where: { id: house.id } })).name, null);
      assert.equal((await dorm.saveDormScheduleSnapshot(member, snapshot)).changed, true);
      assert.equal((await dorm.saveDormScheduleSnapshot(member, snapshot)).changed, false);
      const view = await dorm.getDormSchedules(owner);
      assert.equal(view.members.find((row) => row.id === member)?.snapshot?.schedule.cells[0].courses[0].name, "药理学");
      const colors = await dorm.updateDormSettings(member, { myColor: "blue" });
      assert.equal(colors.status, "active");
      if (colors.status === "active") {
        assert.equal(colors.me.color, "blue");
        assert.equal(new Set(colors.members.map((row) => row.color)).size, 2);
        assert.equal(colors.invite, null);
      }
      await dorm.removeDormMember(owner, member);
      assert.equal(await db.dormScheduleSnapshot.count({ where: { userId: member } }), 0);
      await assert.rejects(dorm.getDormSchedules(member), /还没有加入/u);
      const otherHouse = await create(outsider);
      await dorm.joinDorm(member, otherHouse.code);
      await assert.rejects(dorm.removeDormMember(owner, member), /不在你的宿舍/u);
      assert.equal((await db.dormMember.findUniqueOrThrow({ where: { userId: member } })).linkId, otherHouse.id);
      await db.$transaction((tx) => dorm.deleteDormDataForUser(tx, outsider));
      assert.equal((await db.dormMember.findUniqueOrThrow({ where: { userId: member } })).role, "owner");
    });
  } finally {
    await db.dormLink.deleteMany({ where: { id: { in: links } } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
