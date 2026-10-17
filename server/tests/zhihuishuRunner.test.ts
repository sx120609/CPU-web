import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ZhihuishuRunner, ZhsRunnerError } from "../src/services/zhihuishuRunner";

const worker = path.resolve(__dirname, "fixtures/zhihuishu-worker.py");
const python = process.env.ZHS_TEST_PYTHON || "python3";
async function waitFor(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) { if (Date.now() > end) throw new Error("state deadline exceeded"); await new Promise(r => setTimeout(r, 20)); }
}
function setup(t: test.TestContext, options: Record<string, number> = {}) {
  const runner = new ZhihuishuRunner({ enabled: true, python, worker, ...options });
  t.after(() => runner.shutdown());
  return runner;
}
test("separate users cannot see each other's login, courses or control their tasks", async t => {
  const r = setup(t);
  r.login(1);
  await waitFor(() => r.snapshot(1).loggedIn);
  assert.equal(r.snapshot(2).state, "offline");
  assert.throws(() => r.start(2, ["shared:one"]), ZhsRunnerError);
  r.stop(2);
  assert.equal(r.snapshot(1).state, "ready");
  assert.throws(() => r.start(1, ["shared:forged"]), /不属于/);
  assert.throws(() => r.start(1, ["shared:one", "shared:one"]), /请选择/);
  r.start(1, ["shared:one"]);
  await waitFor(() => r.snapshot(1).state === "completed");
  const s = r.snapshot(1);
  assert.equal(s.completed, 1);
  assert.equal(s.current?.percent, 25);
  assert.match(s.activity?.message || "", /等待智慧树响应/);
  assert.ok(Number.isFinite(Date.parse(s.activity!.updatedAt)));
  assert.ok(s.logs.some(log => log.kind === "skipped" && log.message.includes("未提交")));
  assert.equal(new Set(s.logs.map(log => log.id)).size, s.logs.length);
  assert.ok(!JSON.stringify(s).includes("DO_NOT_EXPOSE_THIS"));
  s.courses.length = 0;
  assert.equal(r.snapshot(1).courses.length, 2);
});
test("concurrent actions rejected; stopping destroys the process and session", async t => {
  const r = setup(t, { maxSessions: 1 });
  r.login(1);
  assert.throws(() => r.login(2), /人数已满/);
  assert.throws(() => r.login(1), /断开/);
  await waitFor(() => r.snapshot(1).loggedIn);
  r.start(1, ["hike:two"]);
  assert.throws(() => r.start(1, ["shared:one"]), /正在进行/);
  r.stop(1);
  assert.equal(r.snapshot(1).loggedIn, false);
  assert.equal(r.snapshot(1).courses.length, 0);
  assert.equal(r.snapshot(1).qr, null);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(r.snapshot(1).state, "stopped");
});
test("task deadline releases credentials and stops execution", async t => {
  const r = setup(t, { taskTimeoutMs: 50 });
  r.login(1);
  await waitFor(() => r.snapshot(1).loggedIn);
  r.start(1, ["hike:two"]);
  await waitFor(() => r.snapshot(1).state === "stopped");
  assert.equal(r.snapshot(1).loggedIn, false);
});
test("missing Python is a visible error, never a successful connection", async t => {
  const r = new ZhihuishuRunner({ enabled: true, python: "/missing/python", worker });
  t.after(() => r.shutdown());
  r.login(1);
  await waitFor(() => r.snapshot(1).state === "error");
  assert.match(r.snapshot(1).message, /Python/);
});
test("disabled service launches nothing", () => {
  const r = new ZhihuishuRunner({ enabled: false, python, worker });
  assert.equal(r.snapshot(1).enabled, false);
  assert.throws(() => r.login(1), /尚未启用/);
});
test("course refresh remains exclusive and does not lose login", async t => {
  const r = setup(t);
  r.login(1);
  await waitFor(() => r.snapshot(1).loggedIn);
  r.refresh(1);
  assert.throws(() => r.start(1, ["shared:one"]), /正在进行/);
  await waitFor(() => r.snapshot(1).state === "ready");
  assert.equal(r.snapshot(1).courses.length, 2);
});
test("speed and default-off policy reach worker; changing policy stops active tasks", async t => {
  const r = setup(t);
  assert.deepEqual(r.getAnswerPolicy(), { autoAnswer: false, autoSubmit: false });
  assert.throws(() => r.setAnswerPolicy({ autoAnswer: false, autoSubmit: true }), /先启用/);
  r.login(1);
  await waitFor(() => r.snapshot(1).loggedIn);
  assert.throws(() => r.start(1, ["shared:one"], 100), /倍速/);
  r.start(1, ["shared:one"], 1.75);
  await waitFor(() => r.snapshot(1).state === "completed");
  assert.equal(r.snapshot(1).speed, 1.75);
  assert.equal(r.snapshot(1).current?.title, "speed=1.75;answer=False;submit=False");
  r.setAnswerPolicy({ autoAnswer: true, autoSubmit: true });
  r.start(1, ["hike:two"], 0.5);
  await waitFor(() => r.snapshot(1).current !== null);
  assert.equal(r.snapshot(1).current?.title, "speed=0.5;answer=True;submit=True");
  r.setAnswerPolicy({ autoAnswer: false, autoSubmit: false });
  assert.equal(r.snapshot(1).state, "stopped");
  assert.equal(r.snapshot(1).loggedIn, false);
});
