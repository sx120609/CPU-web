import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { prisma } from "../src/prisma";
import { errorHandler } from "../src/middleware/error";
import { jwxtRouter } from "../src/routes/jwxt";
import { signToken } from "../src/utils/jwt";

// 内存里的表顶替 prisma.userScheduleEdit 和 prisma.user，路由和校验是真实的。
function installFakeTables() {
  const rows = new Map<string, { payload: string }>();
  const key = (where: any) => `${where.userId_semester.userId}:${where.userId_semester.semester}`;
  const table = prisma.userScheduleEdit as any;
  table.findUnique = async ({ where }: any) => rows.get(key(where)) ?? null;
  table.upsert = async ({ where, create }: any) => {
    rows.set(key(where), { payload: create.payload });
    return rows.get(key(where));
  };
  (prisma.user as any).findUnique = async ({ where }: any) => ({
    id: where.id, username: `student-${where.id}`, role: "user", voiceHubRole: null, lostFoundRole: null,
    status: "active", blocksOwned: [],
  });
  return rows;
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
// 桌面端把 UA 里的 Electron/x 换成了自己的标记，靠网页带上的 X-CPU-Client 认出来。
const DESKTOP_UA = `${BROWSER_UA} CPUWebDesktopApp/1.4.0`;

const custom = [{
  id: "custom-1", day: 1, bigSlot: 1,
  course: { name: "药理学", weeks: "全部周", weekList: [], startSlot: 1, endSlot: 2 },
}];

test("the desktop client can save timetable edits; a plain browser cannot", async () => {
  const rows = installFakeTables();
  const app = express();
  app.use(express.json());
  app.use("/jwxt", jwxtRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, edits: unknown, userAgent: string, client?: string) => {
    const response = await fetch(`${origin}/jwxt/schedule-edits${method === "GET" ? "?semester=2026-2027-1" : ""}`, {
      method,
      headers: {
        "Content-Type": "application/json", "User-Agent": userAgent,
        ...(client ? { "X-CPU-Client": client } : {}),
        Authorization: `Bearer ${signToken({ userId: 7, studentId: "student-7", role: "user", campus: "" })}`,
      },
      body: method === "GET" ? undefined : JSON.stringify({ semester: "2026-2027-1", edits }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    for (const [userAgent, client] of [[BROWSER_UA, "web"], [BROWSER_UA, undefined], [DESKTOP_UA, "web"]] as const) {
      const refused = await call("PUT", { hidden: [], custom }, userAgent, client);
      assert.equal(refused.status, 403);
      assert.equal(refused.body.message, "课表编辑仅客户端可用");
    }
    assert.equal(rows.size, 0);

    const saved = await call("PUT", { hidden: [], custom, priority: { 药理学: 2 } }, DESKTOP_UA, "desktop");
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.edits.custom[0].course.name, "药理学");
    assert.deepEqual(saved.body.data.edits.priority, { 药理学: 2 });

    const loaded = await call("GET", undefined, DESKTOP_UA, "desktop");
    assert.equal(loaded.body.data.edits.custom.length, 1);
    assert.deepEqual(loaded.body.data.edits.priority, { 药理学: 2 });

    // 没有客户端头的原生 Electron UA 也算桌面端。
    const electron = await call("PUT", { hidden: [], custom: [] }, `${BROWSER_UA} Electron/33.0.0`);
    assert.equal(electron.status, 200);
    assert.deepEqual(electron.body.data.edits.priority, { 药理学: 2 });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
