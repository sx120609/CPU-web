import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createAndroidDownloadHandler, createAndroidPatchHandler, createAndroidReleaseHandler, LEGACY_ANDROID_DOWNLOAD_PATH } from "../src/routes/androidDownload";
import { publishedAndroidRelease } from "../src/services/androidRelease";

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

test("NEXT downloads and incremental patches come from the enterprise drive too", async (t) => {
  const sha = "c".repeat(64);
  const stable = publishedAndroidRelease;
  const next = {
    ...stable, versionCode: stable.versionCode + 1, versionName: "9.9.9", fileName: `CPU-Web-Android-V${stable.versionCode + 1}.apk`,
    notes: ["工作台"],
    patches: [{ fromVersionCode: stable.versionCode, fromSha256: sha, fileName: `CPU-Web-Android-V${stable.versionCode}-V${stable.versionCode + 1}.cpupatch`, size: 1234, sha256: sha }],
  };
  const releaseFor = (channel: "stable" | "beta") => channel === "beta" ? { release: next, channel } : { release: stable, channel };
  const files = new Map([
    [stable.fileName, { ...enterpriseFile }],
    [next.fileName, { ...enterpriseFile, url: "https://data.aliyunfile.com/share/next.apk?signature=t", name: next.fileName }],
    [next.patches[0].fileName, { ...enterpriseFile, url: "https://data.aliyunfile.com/share/next.cpupatch?signature=t", name: next.patches[0].fileName, size: 1234 }],
  ]);
  const dependencies = { hasShare: () => true, resolveDownload: async (name: string) => files.get(name)!, releaseFor };
  const app = express();
  app.get("/api/site/downloads/android-app", createAndroidDownloadHandler(dependencies));
  app.get("/api/site/downloads/android-patch", createAndroidPatchHandler(dependencies));
  app.get("/api/site/downloads/android", createAndroidReleaseHandler(async () => ({
    minimumVersionCode: 1, startsAt: new Date(0).toISOString(), deadlineAt: new Date(1).toISOString(), message: "更新",
  }), releaseFor, next, stable));
  const server = createServer(app);
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const download = await fetch(`${base}/api/site/downloads/android-app?channel=beta`, { redirect: "manual" });
  assert.equal(download.headers.get("location"), files.get(next.fileName)!.url);
  const stableDownload = await fetch(`${base}/api/site/downloads/android-app`, { redirect: "manual" });
  assert.equal(stableDownload.headers.get("location"), enterpriseFile.url);
  const patch = await fetch(`${base}/api/site/downloads/android-patch?channel=beta&from=${stable.versionCode}`, { redirect: "manual" });
  assert.equal(patch.status, 302);
  assert.equal(patch.headers.get("location"), files.get(next.patches[0].fileName)!.url);
  const missing = await fetch(`${base}/api/site/downloads/android-patch?channel=beta&from=1`, { redirect: "manual" });
  assert.equal(missing.status, 404);

  const beta = (await (await fetch(`${base}/api/site/downloads/android?channel=beta&from=${stable.versionCode}`)).json()).data;
  assert.equal(beta.channel, "beta");
  assert.equal(beta.versionCode, next.versionCode);
  assert.deepEqual(beta.notes, ["工作台"]);
  assert.equal(beta.downloadUrl, "/api/site/downloads/android-app?channel=beta");
  assert.equal(beta.patch.url, `/api/site/downloads/android-patch?channel=beta&from=${stable.versionCode}`);
  assert.equal(beta.patches, undefined);
  const plain = (await (await fetch(`${base}/api/site/downloads/android`)).json()).data;
  assert.equal(plain.channel, "stable");
  assert.equal(plain.versionCode, stable.versionCode);
  assert.equal(plain.patch, null);
  assert.equal(plain.beta.versionName, "9.9.9");
});
