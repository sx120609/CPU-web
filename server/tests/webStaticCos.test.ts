import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadWebStaticCosManifest,
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

test("static COS manifest is accepted only for the expected version and prefix", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpu-web-static-cos-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await writeFile(path.join(directory, WEB_STATIC_COS_MANIFEST), JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    remotePrefix: WEB_STATIC_COS_PREFIX,
    assets: ["main.abc123.js", "fonts/app.woff2", "../secret.js"],
  }));
  assert.deepEqual(
    Array.from(loadWebStaticCosManifest(directory)).sort(),
    ["fonts/app.woff2", "main.abc123.js"],
  );

  await writeFile(path.join(directory, WEB_STATIC_COS_MANIFEST), JSON.stringify({
    version: 2,
    remotePrefix: WEB_STATIC_COS_PREFIX,
    assets: ["main.abc123.js"],
  }));
  assert.equal(loadWebStaticCosManifest(directory).size, 0);
});

test("index asset tags are rewritten directly to COS without touching unrelated text", () => {
  const html = '<script src="/assets/main.js"></script><link href="/assets/main.css"><script>const example = "/assets/local-only"</script>';
  assert.equal(
    rewriteWebStaticAssetUrls(html, "https://static.example/root/assets/"),
    '<script src="https://static.example/root/assets/main.js?v=dual-origin-cors-v2"></script><link href="https://static.example/root/assets/main.css?v=dual-origin-cors-v2"><script>const example = "/assets/local-only"</script>',
  );
});

test("already rewritten index assets receive the current cache revision idempotently", () => {
  const html = '<script src="https://static.example/root/assets/main.js?v=old"></script>';
  assert.equal(
    rewriteWebStaticAssetUrls(html, "https://static.example/root/assets"),
    '<script src="https://static.example/root/assets/main.js?v=dual-origin-cors-v2"></script>',
  );
});
