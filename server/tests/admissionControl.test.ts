import assert from "node:assert/strict";
import test from "node:test";
import { AdmissionController } from "../src/middleware/admissionControl";

const NOW = 1_000_000;

function send(controller: AdmissionController, path: string, count: number, identity: string | null = null, status = 200) {
  let admitted = 0;
  for (let index = 0; index < count; index += 1) {
    const decision = controller.admit(path, identity, NOW);
    if (!decision.admitted) continue;
    admitted += 1;
    decision.release(status);
  }
  return admitted;
}

// 用一秒一个 tick 模拟平时流量：话题列表每秒 20 次、登录每秒 5 次。
function warmed() {
  const controller = new AdmissionController({ tickMs: 1_000 });
  for (let tick = 0; tick < 30; tick += 1) {
    send(controller, "/api/topics?page=1", 20);
    send(controller, "/api/auth/login", 5);
    controller.tick(5);
  }
  return controller;
}

test("without overload nothing is ever rejected, however large the burst", () => {
  const controller = warmed();
  assert.equal(send(controller, "/api/topics", 50_000), 50_000);
  assert.equal(send(controller, "/api/topics", 50_000, "u:1"), 50_000);
  assert.equal(controller.pressure, false);
});

test("pressure needs consecutive overloaded ticks and clears only after a sustained recovery", () => {
  const controller = warmed();
  controller.tick(500);
  assert.equal(controller.pressure, false, "one GC pause is not an attack");
  controller.tick(5);
  controller.tick(500);
  controller.tick(500);
  assert.equal(controller.pressure, true);
  for (let tick = 0; tick < 9; tick += 1) controller.tick(5);
  assert.equal(controller.pressure, true);
  controller.tick(5);
  assert.equal(controller.pressure, false);
});

test("a flood on one API group only sheds that group's anonymous excess", () => {
  const controller = warmed();
  assert.ok(Math.abs(controller.baselineOf("topics") - 20) < 1);
  controller.tick(500);
  controller.tick(500);
  assert.equal(controller.pressure, true);

  const flooded = send(controller, "/api/topics", 5_000);
  assert.ok(flooded >= 20 && flooded <= 60, `topics admitted ${flooded}`);
  assert.equal(send(controller, "/api/auth/login", 5), 5, "login keeps working");
  assert.equal(send(controller, "/api/topics", 50, "u:7"), 50, "logged-in users are not in the anonymous group");
  const shed = controller.admit("/api/topics", null, NOW);
  assert.equal(shed.admitted, false);
  assert.equal(!shed.admitted && shed.status, 503);
});

test("the baseline is frozen while under pressure, so the flood cannot raise its own allowance", () => {
  const controller = warmed();
  controller.tick(500);
  controller.tick(500);
  for (let tick = 0; tick < 20; tick += 1) {
    send(controller, "/api/topics", 5_000);
    controller.tick(500);
  }
  assert.ok(controller.baselineOf("topics") < 25);
});

test("under pressure one account is capped by rate and by requests still waiting, other accounts are not", () => {
  const controller = warmed();
  controller.tick(500);
  controller.tick(500);
  assert.equal(send(controller, "/api/topics", 200, "u:1"), controller.options.userBurst);
  const rejected = controller.admit("/api/topics", "u:1", NOW);
  assert.equal(!rejected.admitted && rejected.status, 429);
  assert.equal(send(controller, "/api/topics", 20, "u:2"), 20);

  const held = Array.from({ length: 30 }, () => controller.admit("/api/jwxt/schedule", "u:3", NOW));
  assert.equal(held.filter((decision) => decision.admitted).length, controller.options.userMaxPending);
  for (const decision of held) if (decision.admitted) decision.release(200);
  assert.equal(controller.admit("/api/jwxt/schedule", "u:3", NOW).admitted, true);
});

test("made-up paths share one group and cannot fill the group table; group names ignore case", () => {
  const controller = new AdmissionController({ tickMs: 1_000, maxLanes: 4 });
  for (let index = 0; index < 100; index += 1) send(controller, `/api/junk${index}`, 1, null, 404);
  send(controller, "/api/Topics", 1);
  send(controller, "/api/topics", 20);
  controller.tick(5);
  assert.ok(controller.baselineOf("topics") >= 20, "upper- and lower-case paths count as one group");
  assert.equal(controller.baselineOf("junk1"), controller.baselineOf("never-seen"));
});

test("health checks are never shed", () => {
  const controller = new AdmissionController({ tickMs: 1_000 });
  controller.tick(500);
  controller.tick(500);
  assert.equal(send(controller, "/api/health", 1_000), 1_000);
  assert.equal(send(controller, "/api/ready?x=1", 1_000), 1_000);
  assert.equal(controller.pendingCount, 0);
});
