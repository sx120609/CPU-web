import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { prisma } from "../src/prisma";
import { authRequired } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/error";
import { coupleRouter } from "../src/routes/couple";
import { deleteCoupleDataForUser } from "../src/services/coupleSchedule";
import { signToken } from "../src/utils/jwt";

// 需要一个隔离的 PostgreSQL：COUPLE_INTEGRATION_TEST=1 DATABASE_URL=postgresql://...@127.0.0.1/...
test("couple schedule lifecycle on isolated PostgreSQL", { skip: process.env.COUPLE_INTEGRATION_TEST !== "1" }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL || "http://invalid").hostname, "127.0.0.1");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/couple", authRequired, coupleRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const suffix = randomUUID().slice(0, 8);
  const users = await Promise.all(["a", "b", "c"].map((name) => prisma.user.create({
    data: { username: `couple-${name}-${suffix}`, passwordHash: "test", nickname: `用户${name.toUpperCase()}` },
  })));
  const [alice, bob, carol] = users;
  const call = async (user: { id: number; username: string }, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${origin}/couple${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken({ userId: user.id, studentId: user.username, role: "user", campus: "" })}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const snapshot = (name: string) => ({
    semester: "2026-2027-1",
    schedule: { scope: "semester", semesters: [], weeks: [], currentSemester: "2026-2027-1", currentWeek: "1", cells: [{ day: 1, bigSlot: 1, courses: [{ name, weeks: "1-16周", weekList: [1] }] }] },
    calendar: { currentWeek: 1, semesterStart: "2026-09-07", semesterEnd: "2027-01-17", weeks: [] },
  });

  try {
    assert.equal((await call(alice, "GET", "/")).body.data.status, "none");
    assert.equal((await call(alice, "PUT", "/schedule", snapshot("药理学"))).status, 404, "unbound users cannot upload");

    const invite = (await call(alice, "POST", "/invite")).body.data;
    assert.equal(invite.status, "pending");
    assert.match(invite.invite.code, /^[A-Z2-9]{6}$/u);
    assert.equal((await call(alice, "POST", "/accept", { code: invite.invite.code })).status, 400, "cannot accept own invite");
    assert.equal((await call(bob, "POST", "/accept", { code: "ZZZZZZ" })).status, 404);

    // Bob 自己的待接受邀请在接受 Alice 的邀请后作废。
    await call(bob, "POST", "/invite");
    const accepted = await call(bob, "POST", "/accept", { code: invite.invite.code.toLowerCase() });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.data.status, "active");
    assert.equal(accepted.body.data.partner.id, alice.id);
    assert.equal(await prisma.coupleLink.count({ where: { members: { some: { userId: { in: [alice.id, bob.id] } } } } }), 1);
    assert.equal((await prisma.notification.findFirst({ where: { userId: alice.id, source: "情侣课表" } }))?.title, "情侣课表绑定成功");

    assert.equal((await call(carol, "POST", "/accept", { code: invite.invite.code })).status, 404, "invite code is single use");
    assert.equal((await call(alice, "POST", "/invite")).status, 409);

    const first = await call(alice, "PUT", "/schedule", snapshot("药理学"));
    assert.equal(first.body.data.changed, true);
    const same = await call(alice, "PUT", "/schedule", snapshot("药理学"));
    assert.equal(same.body.data.changed, false);
    assert.equal((await call(alice, "PUT", "/schedule", { ...snapshot("x"), schedule: { cells: [{ courses: [{}] }] } })).status, 400);

    const seenByBob = (await call(bob, "GET", "/schedules")).body.data;
    assert.equal(seenByBob.partner.schedule.cells[0].courses[0].name, "药理学");
    assert.equal(seenByBob.me, null);
    assert.equal((await call(carol, "GET", "/schedules")).status, 404, "outsiders cannot read");

    assert.equal((await call(bob, "PATCH", "/", { anniversary: "2099-01-01" })).status, 400);
    assert.equal((await call(bob, "PATCH", "/", { anniversary: "2025-05-20" })).body.data.anniversary, "2025-05-20");
    assert.equal((await call(alice, "GET", "/")).body.data.anniversary, "2025-05-20");
    let colors = (await call(alice, "GET", "/")).body.data;
    assert.deepEqual([colors.me.color, colors.partner.color], ["blue", "pink"]);
    // Bob（接受方）把自己设成蓝色，双方看到的配色同时互换，纪念日不受影响。
    assert.equal((await call(bob, "PATCH", "/", { myColor: "blue" })).body.data.me.color, "blue");
    colors = (await call(alice, "GET", "/")).body.data;
    assert.deepEqual([colors.me.color, colors.partner.color, colors.anniversary], ["pink", "blue", "2025-05-20"]);
    assert.equal((await call(bob, "PATCH", "/", { myColor: "rainbow" })).status, 400);
    // 每人选自己的颜色；选了对方正在用的就是互换。
    assert.equal((await call(bob, "PATCH", "/", { myColor: "teal" })).body.data.me.color, "teal");
    colors = (await call(alice, "GET", "/")).body.data;
    assert.deepEqual([colors.me.color, colors.partner.color], ["pink", "teal"]);
    colors = (await call(alice, "PATCH", "/", { myColor: "teal" })).body.data;
    assert.deepEqual([colors.me.color, colors.partner.color], ["teal", "pink"]);

    assert.equal((await call(bob, "DELETE", "/")).body.data.status, "none");
    assert.equal((await call(alice, "GET", "/")).body.data.status, "none");
    assert.equal(await prisma.coupleScheduleSnapshot.count({ where: { userId: { in: [alice.id, bob.id] } } }), 0, "unbinding deletes snapshots");

    // 注销账号时整条关系一并删除。
    const again = (await call(alice, "POST", "/invite")).body.data;
    await call(carol, "POST", "/accept", { code: again.invite.code });
    await prisma.$transaction((tx) => deleteCoupleDataForUser(tx, carol.id));
    assert.equal((await call(alice, "GET", "/")).body.data.status, "none");
  } finally {
    server.close();
    await prisma.coupleLink.deleteMany({ where: { members: { some: { userId: { in: users.map((user) => user.id) } } } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await prisma.$disconnect();
  }
});
