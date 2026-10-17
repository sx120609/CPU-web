import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { zhihuishuRouter } from "../src/routes/zhihuishu";
import { getZhihuishuRunner } from "../src/services/zhihuishuRunner";

test("settings require authenticated admin role and task body cannot override policy", async t => {
  const app = express();
  app.use(express.json());
  // Test-only role injection; production's authRequired hydrates roles from the DB.
  app.use((req, _res, next) => { (req as any).user = { userId: 1, role: req.headers["x-test-role"] }; next(); });
  app.use(zhihuishuRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.close(); getZhihuishuRunner().setAnswerPolicy({ autoAnswer: false, autoSubmit: false }); });
  const port = (server.address() as import("node:net").AddressInfo).port;
  const call = (url: string, role: string, body?: unknown) => fetch(`http://127.0.0.1:${port}${url}`, { method: body ? "POST" : "GET", headers: { "x-test-role": role, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const initial = await (await call("/settings", "user")).json();
  assert.deepEqual(initial.data, { historyScope: "user-1", canAdmin: false, autoAnswer: false, autoSubmit: false });
  for (const role of ["user", "mod", ""]) assert.equal((await call("/settings", role, { autoAnswer: true, autoSubmit: true })).status, 403);
  assert.equal((await call("/settings", "admin", { autoAnswer: false, autoSubmit: true })).status, 400);
  assert.equal((await call("/settings", "admin", { autoAnswer: true, autoSubmit: true })).status, 200);
  assert.equal((await call("/tasks", "user", { keys: ["shared:one"], autoAnswer: true })).status, 400);
  assert.equal((await call("/tasks", "user", { keys: ["shared:one"], speed: 99 })).status, 400);
});
