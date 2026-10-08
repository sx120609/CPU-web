import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applySample, createState, createStore, HISTORY_DAYS, reconcile, recordCertificates } from "../src/state.mjs";
import { dayKey, formatDuration, recentDayKeys } from "../src/time.mjs";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const START = Date.UTC(2026, 9, 8, 4, 0, 0); // 北京时间 2026-10-08 12:00
const timezone = "Asia/Shanghai";
const check = { id: "api", name: "接口服务", critical: true, failureThreshold: 2 };
const up = { outcome: "up", elapsedMs: 40, reason: "" };
const down = { outcome: "down", elapsedMs: 10000, reason: "HTTP 502" };

test("one failed sample is counted but does not open an incident", () => {
  const state = createState();
  assert.deepEqual(applySample(state, check, up, { now: START, timezone }), []);
  assert.deepEqual(applySample(state, check, down, { now: START + MINUTE, timezone }), []);
  assert.equal(state.checks.api.status, "up");
  assert.deepEqual(state.checks.api.days["2026-10-08"], { up: 1, slow: 0, down: 1 });
  assert.equal(state.incidents.length, 0);
});

test("consecutive failures open one incident dated from the first failure, and the first success closes it", () => {
  const state = createState();
  applySample(state, check, up, { now: START, timezone });
  applySample(state, check, down, { now: START + MINUTE, timezone });
  const opened = applySample(state, check, down, { now: START + 2 * MINUTE, timezone });
  assert.deepEqual(opened, [{ type: "down", checkId: "api", name: "接口服务", critical: true, reason: "HTTP 502", startedAt: START + MINUTE }]);
  assert.equal(state.checks.api.status, "down");
  assert.equal(state.checks.api.since, START + MINUTE);

  assert.deepEqual(applySample(state, check, down, { now: START + 3 * MINUTE, timezone }), []);
  assert.equal(state.incidents.length, 1);

  const closed = applySample(state, check, up, { now: START + 7 * MINUTE, timezone });
  assert.deepEqual(closed, [{ type: "recovered", checkId: "api", name: "接口服务", startedAt: START + MINUTE, resolvedAt: START + 7 * MINUTE }]);
  assert.equal(state.checks.api.status, "up");
  assert.equal(state.incidents[0].resolvedAt, START + 7 * MINUTE);
  assert.equal(state.checks.api.reason, "");
});

test("samples taken while the monitor itself is offline change nothing but the sample time", () => {
  const state = createState();
  applySample(state, check, up, { now: START, timezone });
  for (let minute = 1; minute <= 5; minute += 1) {
    assert.deepEqual(applySample(state, check, { ...down, outcome: "unknown" }, { now: START + minute * MINUTE, timezone }), []);
  }
  assert.equal(state.checks.api.status, "up");
  assert.equal(state.checks.api.failures, 0);
  assert.equal(state.checks.api.lastKnownAt, START);
  assert.equal(state.checks.api.lastSampleAt, START + 5 * MINUTE);
  assert.deepEqual(state.checks.api.days["2026-10-08"], { up: 1, slow: 0, down: 0 });
});

test("slow responses need the same streak before the status changes and clear on the first fast one", () => {
  const state = createState();
  const slow = { outcome: "slow", elapsedMs: 4200, reason: "" };
  applySample(state, check, slow, { now: START, timezone });
  assert.equal(state.checks.api.status, "up");
  applySample(state, check, slow, { now: START + MINUTE, timezone });
  assert.equal(state.checks.api.status, "slow");
  assert.equal(state.checks.api.since, START + MINUTE);
  applySample(state, check, up, { now: START + 2 * MINUTE, timezone });
  assert.equal(state.checks.api.status, "up");
  assert.equal(state.incidents.length, 0);
});

test("daily buckets follow the configured timezone and only the last 90 days are kept", () => {
  const state = createState();
  // 北京时间 10 月 8 日 23:59 和 10 月 9 日 00:01 分属两天，尽管 UTC 日期相同。
  applySample(state, check, up, { now: Date.UTC(2026, 9, 8, 15, 59), timezone });
  applySample(state, check, up, { now: Date.UTC(2026, 9, 8, 16, 1), timezone });
  assert.deepEqual(Object.keys(state.checks.api.days), ["2026-10-08", "2026-10-09"]);

  for (let day = 2; day < 120; day += 1) applySample(state, check, up, { now: START + day * DAY, timezone });
  const keys = Object.keys(state.checks.api.days).sort();
  assert.equal(keys.length, HISTORY_DAYS);
  assert.equal(keys.at(-1), dayKey(START + 119 * DAY, timezone));
});

test("recent day keys are consecutive calendar days ending today", () => {
  assert.deepEqual(recentDayKeys(Date.UTC(2026, 2, 1, 16, 30), timezone, 3), ["2026-02-28", "2026-03-01", "2026-03-02"]);
});

test("certificate reminders fire once per threshold and reset after renewal", () => {
  const state = createState();
  const expiresAt = START + 20 * DAY;
  const record = (now, expiry = expiresAt) => recordCertificates(state, [{ host: "cputime.cn", expiresAt: expiry }], { now, warnDays: 14 });

  assert.deepEqual(record(START), []);
  assert.deepEqual(record(START + 6 * DAY + MINUTE), [{ type: "certificate", host: "cputime.cn", expiresAt, daysLeft: 13 }]);
  assert.deepEqual(record(START + 7 * DAY), []);
  assert.equal(record(START + 13 * DAY + MINUTE).at(0).daysLeft, 6);
  assert.equal(record(START + 17 * DAY + MINUTE).at(0).daysLeft, 2);
  assert.deepEqual(record(START + 17 * DAY + 2 * MINUTE), []);

  const renewed = START + 107 * DAY;
  assert.deepEqual(record(START + 18 * DAY, renewed), []);
  assert.equal(state.certificates["cputime.cn"].warnedLevel, null);
});

test("reconcile closes incidents of removed checks and forgets certificates that are no longer probed", () => {
  const state = createState();
  applySample(state, check, down, { now: START, timezone });
  applySample(state, check, down, { now: START + MINUTE, timezone });
  recordCertificates(state, [{ host: "old.example", expiresAt: START + 60 * DAY }], { now: START, warnDays: 14 });

  reconcile(state, [check], START + 2 * MINUTE);
  assert.equal(state.incidents[0].resolvedAt, null);
  assert.ok(state.certificates["old.example"]);

  reconcile(state, [], START + 8 * DAY);
  assert.equal(state.incidents[0].resolvedAt, START + 8 * DAY);
  assert.equal(state.certificates["old.example"], undefined);
});

test("the store round-trips state and quarantines a corrupt file instead of failing to start", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "status-monitor-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const errors = [];
  const store = createStore({ dataDir: path.join(dataDir, "nested"), logger: { error: (event) => errors.push(event) } });

  assert.deepEqual(await store.load(), createState());
  const state = createState();
  applySample(state, check, up, { now: START, timezone });
  await store.save(state);
  assert.deepEqual(await store.load(), state);
  assert.deepEqual(JSON.parse(await readFile(store.file, "utf8")), state);

  await writeFile(store.file, "{ not json");
  assert.deepEqual(await store.load(), createState());
  assert.deepEqual(errors, ["state_unreadable"]);
  assert.ok((await readdir(path.dirname(store.file))).some((name) => name.startsWith("state.json.corrupt-")));
});

test("durations read naturally", () => {
  assert.equal(formatDuration(20 * 1000), "不到 1 分钟");
  assert.equal(formatDuration(6 * MINUTE), "6 分钟");
  assert.equal(formatDuration(125 * MINUTE), "2 小时 5 分钟");
  assert.equal(formatDuration(26 * 60 * MINUTE), "1 天 2 小时");
});
