import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConfig } from "../src/config.mjs";
import { createMonitor } from "../src/monitor.mjs";
import { createState } from "../src/state.mjs";

const up = { outcome: "up", elapsedMs: 40, reason: "", httpStatus: 200, version: null, certificates: [] };
const down = { outcome: "down", elapsedMs: 900, reason: "HTTP 502", httpStatus: 502, version: null, certificates: [] };

// 用极短的探测间隔跑真实的调度循环；间隔下限只约束配置文件，这里直接改写规范化后的值。
function harness({ outcomes, online = true }) {
  const config = normalizeConfig({
    defaults: { retryDelayMs: 0 },
    groups: [{ name: "主站", checks: [{ id: "api", name: "接口服务", url: "https://cputime.cn/api/health", critical: true }] }],
  });
  config.checks[0].intervalSeconds = 0;
  const state = createState();
  const pushed = [];
  const saved = [];
  const logs = [];
  const runs = [];
  const monitor = createMonitor({
    config,
    state,
    store: { save: async (value) => saved.push(JSON.parse(JSON.stringify(value))) },
    notifier: { push: (events) => pushed.push(...events) },
    logger: { info: (event) => logs.push(event), warn: (event) => logs.push(event), error: (event) => logs.push(event) },
    connectivity: { isOnline: async () => online },
    run: async () => {
      runs.push(Date.now());
      return outcomes[Math.min(runs.length - 1, outcomes.length - 1)];
    },
    sleep: async () => {},
  });
  return { monitor, state, pushed, saved, logs, runs };
}

const until = async (condition) => {
  for (let attempt = 0; attempt < 400 && !condition(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(condition(), "condition was not reached in time");
};

test("a failure is retried once and a successful retry counts as up", async () => {
  const { monitor, runs } = harness({ outcomes: [down, up] });
  const [{ check, sample }] = await monitor.runOnce();
  assert.equal(check.id, "api");
  assert.equal(sample.outcome, "up");
  assert.equal(runs.length, 2);
});

test("runOnce reports failures without touching state or sending notifications", async () => {
  const { monitor, state, pushed, saved } = harness({ outcomes: [down] });
  const [{ sample }] = await monitor.runOnce();
  assert.equal(sample.reason, "HTTP 502");
  assert.deepEqual(state, createState());
  assert.deepEqual(pushed, []);
  assert.deepEqual(saved, []);
});

test("the loop opens an incident after repeated failures, notifies once, and persists on stop", async () => {
  const { monitor, state, pushed, saved, logs } = harness({ outcomes: [up, up, down] });
  monitor.start();
  await until(() => state.checks.api?.status === "down");
  await monitor.stop();

  assert.deepEqual(pushed.map((event) => event.type), ["down"]);
  assert.equal(pushed[0].reason, "HTTP 502");
  assert.ok(logs.includes("check_failed") && logs.includes("status_down"));
  assert.ok(monitor.revision() >= 4);
  assert.equal(saved.at(-1).checks.api.status, "down");
  assert.equal(saved.at(-1).incidents.length, 1);
});

test("failures seen while the monitor has no connectivity are not blamed on the site", async () => {
  const { monitor, state, pushed, logs } = harness({ outcomes: [down], online: false });
  monitor.start();
  await until(() => logs.filter((event) => event === "monitor_offline").length >= 3);
  await monitor.stop();

  assert.equal(state.checks.api.status, "unknown");
  assert.deepEqual(state.checks.api.days, {});
  assert.deepEqual(state.incidents, []);
  assert.deepEqual(pushed, []);
});

test("the main site's release is remembered and certificates seen by probes are recorded", async () => {
  const sample = { ...up, version: "d42fb307258d29cfc68fb750cc750a2668680a4c", certificates: [{ host: "cputime.cn", expiresAt: Date.now() + 50 * 86400000 }] };
  const { monitor, state } = harness({ outcomes: [sample] });
  monitor.start();
  await until(() => state.release !== null);
  await monitor.stop();

  assert.equal(state.release.value, sample.version);
  assert.equal(state.certificates["cputime.cn"].expiresAt, sample.certificates[0].expiresAt);
});

test("no probe runs after stop", async () => {
  const { monitor, runs } = harness({ outcomes: [up] });
  monitor.start();
  await until(() => runs.length >= 1);
  await monitor.stop();
  const settled = runs.length;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(runs.length, settled);
});
