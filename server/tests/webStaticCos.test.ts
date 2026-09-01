import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadWebStaticCosManifest,
  loadWebStaticCosPublicManifest,
  normalizeWebStaticAssetPath,
  rewriteWebStaticAssetUrls,
  WEB_STATIC_COS_MANIFEST,
  WEB_STATIC_COS_PREFIX,
} from "../src/services/webStaticCos";

test("static asset paths reject traversal and normalize separators", () => {
  assert.equal(normalizeWebStaticAssetPath("/chunks/main.js/"), "chunks/main.js");
  assert.equal(normalizeWebStaticAssetPath("fonts\\app.woff2"), "fonts/app.woff2");
  assert.equal(normalizeWebStaticAssetPath("../secret.js"), "");
  assert.equal(normalizeWebStaticAssetPath("chunks/./main.js"), "");
});

test("static object-storage manifest accepts legacy COS and current provider-aware versions", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpu-web-static-cos-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await writeFile(path.join(directory, WEB_STATIC_COS_MANIFEST), JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    remotePrefix: WEB_STATIC_COS_PREFIX,
    assets: ["main.abc123.js", "fonts/app.woff2", "../secret.js"],
    publicAssets: ["splash/launch.png", "downloads/app.apk", "../ignored.png"],
  }));
  assert.deepEqual(
    Array.from(loadWebStaticCosManifest(directory)).sort(),
    ["fonts/app.woff2", "main.abc123.js"],
  );
  assert.deepEqual(
    Array.from(loadWebStaticCosPublicManifest(directory)).sort(),
    ["downloads/app.apk", "splash/launch.png"],
  );

  await writeFile(path.join(directory, WEB_STATIC_COS_MANIFEST), JSON.stringify({
    version: 2,
    remotePrefix: WEB_STATIC_COS_PREFIX,
    backend: "oss",
    assets: ["main.abc123.js"],
    publicAssets: ["downloads/app.apk"],
  }));
  assert.deepEqual(Array.from(loadWebStaticCosManifest(directory)), ["main.abc123.js"]);
  assert.deepEqual(Array.from(loadWebStaticCosPublicManifest(directory)), ["downloads/app.apk"]);

  await writeFile(path.join(directory, WEB_STATIC_COS_MANIFEST), JSON.stringify({
    version: 3,
    remotePrefix: WEB_STATIC_COS_PREFIX,
    assets: ["main.abc123.js"],
  }));
  assert.equal(loadWebStaticCosManifest(directory).size, 0);
});

test("index asset tags are rewritten to the current delivery origin without touching unrelated text", () => {
  const html = '<script src="/assets/main.js"></script><link href="/assets/main.css"><script>const example = "/assets/local-only"</script>';
  assert.equal(
    rewriteWebStaticAssetUrls(html, "https://static.example/root/assets/"),
    '<script src="https://static.example/root/assets/main.js"></script><link href="https://static.example/root/assets/main.css"><script>const example = "/assets/local-only"</script>',
  );
});

test("index asset tags migrate from a previous remote origin to the current CDN", () => {
  const html = [
    '<script src="https://old-cos.example/cpu-web-media/web-static/assets/dual-origin-v2/main.js"></script>',
    '<link href="https://old-cdn.example/cpu-web-media/web-static/assets/dual-origin-v2/main.css">',
    '<img src="https://old-cos.example/cpu-web-media/forum/unrelated.png">',
  ].join("");
  assert.equal(
    rewriteWebStaticAssetUrls(html, "https://static.cputime.cn/cpu-web-media/web-static/assets/dual-origin-v2"),
    [
      '<script src="https://static.cputime.cn/cpu-web-media/web-static/assets/dual-origin-v2/main.js"></script>',
      '<link href="https://static.cputime.cn/cpu-web-media/web-static/assets/dual-origin-v2/main.css">',
      '<img src="https://old-cos.example/cpu-web-media/forum/unrelated.png">',
    ].join(""),
  );
});
