import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isPublicCdnAsset } from "../src/utils/webStaticAssets";
import {
  createWebStaticIndexHandler,
  loadWebStaticCosManifest,
  loadWebStaticCosPublicManifest,
  normalizeWebStaticAssetPath,
  resolveWebStaticBackend,
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

test("runtime static provider overrides the deployment manifest with a safe fallback", () => {
  assert.equal(resolveWebStaticBackend("oss", "cos"), "oss");
  assert.equal(resolveWebStaticBackend("cos", "oss"), "cos");
  assert.equal(resolveWebStaticBackend("local", "cos"), "cos");
});

test("static sync excludes Android packages while retaining webpage images", () => {
  assert.equal(isPublicCdnAsset("downloads/CPU-Web-Android-V37.apk"), false);
  assert.equal(isPublicCdnAsset("downloads\\CPU-Web-Android-V37.APK"), false);
  assert.equal(isPublicCdnAsset("downloads/tutorial.png"), true);
  assert.equal(isPublicCdnAsset("brand/logo.svg"), true);
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
    ["splash/launch.png"],
  );

  await writeFile(path.join(directory, WEB_STATIC_COS_MANIFEST), JSON.stringify({
    version: 2,
    remotePrefix: WEB_STATIC_COS_PREFIX,
    backend: "oss",
    assets: ["main.abc123.js"],
    publicAssets: ["downloads/app.apk"],
  }));
  assert.deepEqual(Array.from(loadWebStaticCosManifest(directory)), ["main.abc123.js"]);
  assert.deepEqual(Array.from(loadWebStaticCosPublicManifest(directory)), []);

  await writeFile(path.join(directory, WEB_STATIC_COS_MANIFEST), JSON.stringify({
    version: 3,
    remotePrefix: WEB_STATIC_COS_PREFIX,
    assets: ["main.abc123.js"],
  }));
  assert.equal(loadWebStaticCosManifest(directory).size, 0);
});

test("index asset tags are rewritten to the current delivery origin without touching unrelated text", () => {
  const html = '<script src="./assets/main.js"></script><link href="/assets/main.css"><script>const example = "/assets/local-only"</script>';
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

test("index handler emits entry modules on one direct CDN origin", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpu-web-static-index-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "index.html"),
    '<script type="module" src="./assets/main.js"></script><link rel="modulepreload" href="./assets/vendor.js">',
  );

  let body = "";
  const headers = new Map<string, string>();
  const handler = createWebStaticIndexHandler(
    directory,
    async () => "https://static.example/cpu-web-media/web-static/assets/dual-origin-v2",
  );
  await handler({} as any, {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    type() {
      return this;
    },
    send(value: string) {
      body = value;
      return this;
    },
  } as any, () => undefined);

  assert.equal(headers.get("Cache-Control"), "no-cache, must-revalidate");
  assert.equal(
    body,
    '<script type="module" src="https://static.example/cpu-web-media/web-static/assets/dual-origin-v2/main.js"></script><link rel="modulepreload" href="https://static.example/cpu-web-media/web-static/assets/dual-origin-v2/vendor.js">',
  );
});

test("an existing index handler observes atomic frontend updates and rollback without a process restart", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpu-hot-index-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const index = path.join(directory, "index.html");
  await writeFile(index, '<script src="./assets/old.js"></script>');
  const handler = createWebStaticIndexHandler(directory, async () => "https://static.example/assets");
  let body = "";
  const response = { setHeader() {}, type() { return this; }, send(value: string) { body = value; return this; } };
  await handler({} as any, response as any, () => {});
  assert.match(body, /old\.js/);
  await writeFile(`${index}.next`, '<script src="./assets/new.js"></script>');
  await rename(`${index}.next`, index);
  await handler({} as any, response as any, () => {});
  assert.match(body, /new\.js/);
  await writeFile(`${index}.next`, '<script src="./assets/old.js"></script>');
  await rename(`${index}.next`, index);
  await handler({} as any, response as any, () => {});
  assert.match(body, /old\.js/);
});
