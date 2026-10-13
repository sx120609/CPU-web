import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createAndroidUpdateRequirementLoader, ANDROID_UPDATE_START_KEY } from "../src/services/androidUpdateRequirement";
import { androidVersionFromUserAgent, createAndroidUpdateGate } from "../src/middleware/androidUpdate";
import { createAndroidReleaseHandler } from "../src/routes/androidDownload";
import { publishedAndroidRelease } from "../src/services/androidRelease";

test("rollout grants exactly 72 hours and survives concurrent reads and process restarts", async () => {
  let stored: string | undefined;
  let reads = 0;
  let now = Date.parse("2026-10-13T08:00:00Z");
  const dependencies = {
    now: () => now,
    async ensureStart(key: string, proposed: string) {
      reads += 1;
      assert.equal(key, ANDROID_UPDATE_START_KEY);
      stored ??= proposed;
      return stored;
    },
  };
  const load = createAndroidUpdateRequirementLoader(dependencies);
  const [first, second] = await Promise.all([load(), load()]);
  assert.deepEqual(first, second);
  assert.equal(reads, 1);
  assert.equal(Date.parse(first.deadlineAt) - Date.parse(first.startsAt), 72 * 3_600_000);
  assert.equal(first.minimumVersionCode, 59);
  now += 5 * 24 * 3_600_000;
  assert.deepEqual(await createAndroidUpdateRequirementLoader(dependencies)(), first);
});

test("failed initialization is retried without silently granting a new grace period", async () => {
  let attempts = 0;
  const load = createAndroidUpdateRequirementLoader({
    now: () => Date.parse("2026-10-13T08:00:00Z"),
    async ensureStart() {
      attempts += 1;
      if (attempts === 1) throw new Error("database unavailable");
      return "2026-10-12T08:00:00Z";
    },
  });
  await assert.rejects(load(), /database unavailable/);
  assert.equal((await load()).deadlineAt, "2026-10-15T08:00:00.000Z");
});

test("native version detection excludes other platforms and ordinary Android browsers", () => {
  assert.equal(androidVersionFromUserAgent("Android CPUWebScheduleApp/58 CPUWebScheduleAppVersion/4.0.17 CPUTimeNative/1"), 58);
  assert.equal(androidVersionFromUserAgent("CPUWebScheduleApp/59"), 59);
  assert.equal(androidVersionFromUserAgent("CPUWebScheduleApp/unknown"), 1);
  assert.equal(androidVersionFromUserAgent("CPUWebScheduleApp/0"), 1);
  assert.equal(androidVersionFromUserAgent("CPUWebScheduleApp/59junk"), 1);
  for (const ua of ["Mozilla/5.0 Android Chrome/140", "CPUWebIOSApp/414 CPUTimeNative/1", "CPUWebHarmonyApp/18 CPUTimeNative/1", "CPUWebDesktopApp/3", ""]) {
    assert.equal(androidVersionFromUserAgent(ua), null);
  }
});

test("old online clients are blocked at the deadline while bootstrap and install routes remain usable", async t => {
  let now = Date.parse("2026-10-16T08:00:00Z") - 1;
  const requirement = {
    minimumVersionCode: 59, startsAt: "2026-10-13T08:00:00Z",
    deadlineAt: "2026-10-16T08:00:00Z", message: "最新版修复了大量 Bug 和安全问题，请及时更新。",
  };
  const app = express();
  app.use("/api", createAndroidUpdateGate({ readRequirement: async () => requirement, now: () => now }));
  app.get("/api/site/downloads/android", createAndroidReleaseHandler(async () => requirement));
  app.use((_req, res) => res.json({ code: 0, data: "allowed" }));
  const server = createServer(app);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { "User-Agent": "Android CPUWebScheduleApp/58 CPUTimeNative/1", "X-CPU-Client": "ios" };
  assert.equal((await fetch(base + "/api/courses", { headers })).status, 200);
  now += 1;
  for (const method of ["GET", "POST"]) {
    const response = await fetch(base + "/api/courses", { headers, method });
    assert.equal(response.status, 426);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.code, 4260);
    assert.equal(body.data.reason, "ANDROID_UPDATE_REQUIRED");
    assert.equal(body.data.updateRequirement.deadlineAt, requirement.deadlineAt);
    assert.equal(body.data.release.versionCode, publishedAndroidRelease.versionCode);
  }
  for (const path of ["/api/site/downloads/android", "/api/site/downloads/android-app", "/api/site/downloads/android-app/", "/api/site/features", "/api/site/config", "/api/health", "/api/ready", "/api/privacy/delete", "/downloads/CPU-Web-V7.apk"]) {
    assert.equal((await fetch(base + path, { headers })).status, 200, path);
  }
  const manifest = await fetch(base + "/api/site/downloads/android", { headers });
  assert.equal(manifest.headers.get("cache-control"), "no-store");
  const body = await manifest.json();
  assert.deepEqual(body.data.updateRequirement, requirement);
  assert.ok(Number.isFinite(Date.parse(body.data.serverTime)));
  for (const ua of ["CPUWebScheduleApp/59", "CPUWebScheduleApp/60", "Android Chrome/140", "CPUWebIOSApp/414", "CPUWebHarmonyApp/18 CPUTimeNative/1"]) {
    assert.equal((await fetch(base + "/api/courses", { headers: { "User-Agent": ua } })).status, 200);
  }
  assert.equal((await fetch(base + "/api/courses", { method: "OPTIONS", headers })).status, 200);
});

test("a policy read failure reaches error handling instead of allowing old requests through", async () => {
  const failure = new Error("database unavailable");
  let result: unknown;
  await createAndroidUpdateGate({ readRequirement: async () => { throw failure; }, now: Date.now })(
    { get: () => "CPUWebScheduleApp/58", path: "/courses", method: "POST" } as any,
    {} as any,
    error => { result = error; },
  );
  assert.equal(result, failure);
});
