import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  createAndroidDownloadHandler,
  createAndroidNextDownloadHandler,
  createAndroidNextPatchHandler,
  createAndroidNextReleaseHandler,
  createAndroidReleaseHandler,
  LEGACY_ANDROID_DOWNLOAD_PATH,
} from "../src/routes/androidDownload";
import { publishedAndroidRelease } from "../src/services/androidRelease";
import { inviteCodeHash, type AndroidNextAccess } from "../src/services/androidNextAccess";

const enterpriseFile = {
  url: "https://data.aliyunfile.com/share/v37.apk?signature=temporary",
  name: publishedAndroidRelease.fileName,
  size: publishedAndroidRelease.size,
  expiresAt: Date.now() + 3600000,
  contentHash: "",
  contentHashName: "",
};

test("Android download entry and legacy APK links redirect to enterprise storage", async (t) => {
  const app = express();
  const handler = createAndroidDownloadHandler({ hasShare: () => true, resolveDownload: async () => enterpriseFile });
  app.get(["/api/site/downloads/android-app", LEGACY_ANDROID_DOWNLOAD_PATH], handler);
  app.use((_req, res) => res.redirect("https://static.cputime.cn/should-not-be-used.apk"));
  const server = createServer(app);
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const pathname of ["/api/site/downloads/android-app", "/downloads/CPU-Web-Android-V37.apk", "/downloads/CPU-Web-V7.apk"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(base + pathname, { method, redirect: "manual" });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), enterpriseFile.url);
      assert.equal(response.headers.get("cache-control"), "no-store");
      await response.arrayBuffer();
    }
  }
});

test("missing or unavailable enterprise storage never falls back to a bundled APK", async (t) => {
  t.mock.method(console, "error", () => undefined);
  for (const hasShare of [false, true]) {
    const headers = new Map<string, unknown>();
    let status = 0;
    let body: any;
    const handler = createAndroidDownloadHandler({
      hasShare: () => hasShare,
      resolveDownload: async () => { throw new Error("PDS unavailable"); },
    });
    await handler({} as any, {
      setHeader: (name: string, value: unknown) => headers.set(name, value),
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
      redirect() { assert.fail("must not use an alternative download source"); },
    } as any, () => assert.fail("must not fall through to static file delivery"));
    assert.equal(status, 503);
    assert.equal(body.code, 503);
    assert.equal(headers.get("Cache-Control"), "no-store");
  }
});

test("药大拾间 NEXT has its own release, APK and patch entries, all on the enterprise drive", async (t) => {
  const sha = "c".repeat(64);
  const next = {
    ...publishedAndroidRelease, packageName: "cn.lizmt.cpuweb.next", versionCode: 1002, versionName: "1.0.1",
    fileName: "CPU-Web-Android-NEXT-V1002.apk", notes: ["工作台"],
    patches: [{ fromVersionCode: 1001, fromSha256: sha, fileName: "CPU-Web-Android-NEXT-V1001-V1002.cpupatch", size: 1234, sha256: sha }],
  };
  const files = new Map([
    [publishedAndroidRelease.fileName, { ...enterpriseFile }],
    [next.fileName, { ...enterpriseFile, url: "https://data.aliyunfile.com/share/next.apk?signature=t", name: next.fileName }],
    [next.patches[0].fileName, { ...enterpriseFile, url: "https://data.aliyunfile.com/share/next.cpupatch?signature=t", name: next.patches[0].fileName, size: 1234 }],
  ]);
  const dependencies = { hasShare: () => true, resolveDownload: async (name: string) => files.get(name)! };
  const requirement = async () => ({
    minimumVersionCode: 1, startsAt: new Date(0).toISOString(), deadlineAt: new Date(1).toISOString(), message: "更新",
  });
  const open: AndroidNextAccess = { mode: "public", inviteCodeSha256: [] };
  const app = express();
  app.get("/api/site/downloads/android", createAndroidReleaseHandler(requirement, next, open));
  app.get("/api/site/downloads/android-app", createAndroidDownloadHandler(dependencies));
  app.get("/api/site/downloads/android-next", createAndroidNextReleaseHandler(next, open));
  app.get("/api/site/downloads/android-next-app", createAndroidNextDownloadHandler(dependencies, next, open));
  app.get("/api/site/downloads/android-next-patch", createAndroidNextPatchHandler(dependencies, next, open));
  app.get("/unpublished", createAndroidNextReleaseHandler(null, open));
  app.get("/unpublished-app", createAndroidNextDownloadHandler(dependencies, null, open));
  const server = createServer(app);
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const stable = (await (await fetch(`${base}/api/site/downloads/android`)).json()).data;
  assert.equal(stable.versionCode, publishedAndroidRelease.versionCode);
  assert.equal(stable.downloadUrl, "/api/site/downloads/android-app");
  assert.deepEqual(stable.next, { versionCode: 1002, versionName: "1.0.1", notes: ["工作台"] });
  assert.equal((await fetch(`${base}/api/site/downloads/android-app`, { redirect: "manual" })).headers.get("location"), enterpriseFile.url);

  const release = (await (await fetch(`${base}/api/site/downloads/android-next?from=1001`)).json()).data;
  assert.equal(release.packageName, "cn.lizmt.cpuweb.next");
  assert.equal(release.downloadUrl, "/api/site/downloads/android-next-app");
  assert.equal(release.patch.url, "/api/site/downloads/android-next-patch?from=1001");
  assert.equal(release.patches, undefined);
  assert.equal((await (await fetch(`${base}/api/site/downloads/android-next?from=7`)).json()).data.patch, null);
  const apk = await fetch(`${base}/api/site/downloads/android-next-app`, { redirect: "manual" });
  assert.equal(apk.headers.get("location"), files.get(next.fileName)!.url);
  const patch = await fetch(`${base}/api/site/downloads/android-next-patch?from=1001`, { redirect: "manual" });
  assert.equal(patch.status, 302);
  assert.equal(patch.headers.get("location"), files.get(next.patches[0].fileName)!.url);
  assert.equal((await fetch(`${base}/api/site/downloads/android-next-patch?from=1`, { redirect: "manual" })).status, 404);

  assert.equal((await fetch(`${base}/unpublished`)).status, 404);
  assert.equal((await fetch(`${base}/unpublished-app`, { redirect: "manual" })).status, 404);
});

test("an invite-only NEXT is hidden from the download page and from anyone without the app or an invitation", async (t) => {
  const next = {
    ...publishedAndroidRelease, packageName: "cn.lizmt.cpuweb.next", versionCode: 1001, versionName: "1.0.0",
    fileName: "CPU-Web-Android-NEXT-V1001.apk",
  };
  const access: AndroidNextAccess = { mode: "invite", inviteCodeSha256: [inviteCodeHash("ABCDEFGH2345")] };
  const file = { ...enterpriseFile, url: "https://data.aliyunfile.com/share/next.apk?signature=t", name: next.fileName };
  const dependencies = { hasShare: () => true, resolveDownload: async () => file };
  const requirement = async () => ({
    minimumVersionCode: 1, startsAt: new Date(0).toISOString(), deadlineAt: new Date(1).toISOString(), message: "更新",
  });
  const app = express();
  app.get("/api/site/downloads/android", createAndroidReleaseHandler(requirement, next, access));
  app.get("/api/site/downloads/android-next", createAndroidNextReleaseHandler(next, access));
  app.get("/api/site/downloads/android-next-app", createAndroidNextDownloadHandler(dependencies, next, access));
  const server = createServer(app);
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  assert.equal((await (await fetch(`${base}/api/site/downloads/android`)).json()).data.next, null);
  assert.equal((await fetch(`${base}/api/site/downloads/android-next`)).status, 404);
  assert.equal((await fetch(`${base}/api/site/downloads/android-next?invite=WRONGCODE234`)).status, 404);
  assert.equal((await fetch(`${base}/api/site/downloads/android-next-app`, { redirect: "manual" })).status, 404);

  // An invitation link, in any letter case, reads the release and downloads it.
  const invited = (await (await fetch(`${base}/api/site/downloads/android-next?invite=abcdefgh2345`)).json()).data;
  assert.equal(invited.versionName, "1.0.0");
  assert.equal(invited.downloadUrl, "/api/site/downloads/android-next-app?invite=abcdefgh2345");
  const download = await fetch(`${base}${invited.downloadUrl}`, { redirect: "manual" });
  assert.equal(download.status, 302);
  assert.equal(download.headers.get("location"), file.url);

  // The installed NEXT app keeps updating without an invitation.
  const app_ = { headers: { "user-agent": "Mozilla/5.0 CPUWebScheduleApp/1001 CPUTimeNative/1 CPUWebNextApp/1001" } };
  const fromApp = (await (await fetch(`${base}/api/site/downloads/android-next?from=1000`, app_)).json()).data;
  assert.equal(fromApp.downloadUrl, "/api/site/downloads/android-next-app");
  assert.equal((await fetch(`${base}/api/site/downloads/android-next-app`, { ...app_, redirect: "manual" })).status, 302);
});
