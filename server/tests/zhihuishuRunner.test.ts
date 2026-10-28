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
test("speed and default-on policy reach worker; changing policy stops active tasks", async t => {
  const r = setup(t);
  assert.deepEqual(r.getAnswerPolicy(), { autoAnswer: true, autoSubmit: true });
  assert.throws(() => r.setAnswerPolicy({ autoAnswer: false, autoSubmit: true }), /先启用/);
  r.login(1);
  await waitFor(() => r.snapshot(1).loggedIn);
  assert.throws(() => r.start(1, ["shared:one"], 100), /倍速/);
  r.start(1, ["shared:one"], 1.75);
  await waitFor(() => r.snapshot(1).state === "completed");
  assert.equal(r.snapshot(1).speed, 1.75);
  assert.equal(r.snapshot(1).current?.title, "speed=1.75;answer=True;submit=True");
  r.setAnswerPolicy({ autoAnswer: false, autoSubmit: false });
  r.start(1, ["hike:two"], 0.5);
  await waitFor(() => r.snapshot(1).current !== null);
  assert.equal(r.snapshot(1).current?.title, "speed=0.5;answer=False;submit=False");
  r.setAnswerPolicy({ autoAnswer: true, autoSubmit: true });
  assert.equal(r.snapshot(1).state, "stopped");
  assert.equal(r.snapshot(1).loggedIn, false);
});


test("background ownership follows all running users without snapshot polling", async t => {
  const changes: boolean[] = [];
  const r = new ZhihuishuRunner({ enabled: true, python, worker, onRunningChange: running => changes.push(running) });
  t.after(() => r.shutdown());
  r.login(1); r.login(2);
  await waitFor(() => r.snapshot(1).loggedIn && r.snapshot(2).loggedIn);
  assert.deepEqual(changes, []);
  r.start(1, ["hike:two"]); r.start(2, ["hike:two"]);
  assert.deepEqual(changes, [true]);
  r.stop(1); assert.deepEqual(changes, [true]);
  r.setAnswerPolicy({ autoAnswer: false, autoSubmit: false });
  assert.deepEqual(changes, [true, false]);
});

test("background ownership releases on natural completion and timeout", async t => {
  const changes: boolean[] = [];
  const r = new ZhihuishuRunner({ enabled: true, python, worker, taskTimeoutMs: 200, onRunningChange: running => changes.push(running) });
  t.after(() => r.shutdown());
  r.login(1); await waitFor(() => r.snapshot(1).loggedIn);
  r.start(1, ["shared:one"]);
  // The callback must fire even while nobody reads a snapshot.
  await waitFor(() => changes.length === 2);
  assert.deepEqual(changes, [true, false]);
  assert.equal(r.snapshot(1).state, "completed");
  r.start(1, ["hike:two"]);
  await waitFor(() => changes.length === 4);
  assert.deepEqual(changes, [true, false, true, false]);
  assert.equal(r.snapshot(1).state, "stopped");
});


test("captcha preserves stopped course/video context and stays isolated from other users", async t => {
  const r = setup(t);
  r.login(1); await waitFor(() => r.snapshot(1).loggedIn);
  r.start(1, ["shared:one"], 1.25);
  await waitFor(() => r.snapshot(1).state === "error");
  const snapshot = r.snapshot(1);
  assert.equal(snapshot.loggedIn, false);
  assert.deepEqual(snapshot.courses, []);
  assert.equal(snapshot.verification?.courseName, "测试课程");
  assert.equal(snapshot.verification?.videoTitle, "第一章 <视频>");
  assert.ok(snapshot.verification?.id);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(r.snapshot(1).verification, snapshot.verification, "polling and worker exit retain one stable event");
  r.login(2); await waitFor(() => r.snapshot(2).loggedIn);
  assert.equal(r.snapshot(2).verification, null);
  r.start(2, ["shared:one"], 0.75);
  await waitFor(() => r.snapshot(2).state === "error");
  assert.equal(r.snapshot(2).verification, null, "message keywords alone must not trigger captcha");
});
