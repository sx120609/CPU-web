import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createAndroidDownloadHandler, LEGACY_ANDROID_DOWNLOAD_PATH } from "../src/routes/androidDownload";
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
