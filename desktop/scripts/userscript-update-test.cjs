#!/usr/bin/env node

const assert = require("node:assert/strict");
const { readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { mkdtemp } = require("node:fs/promises");
const {
  checkUserScriptUpdate,
  parseUserScriptIdentity,
  readCachedUserScript,
  sha256Text,
  USER_SCRIPT_MANIFEST_PATH,
  USER_SCRIPT_SOURCE_PATH,
  validateUserScriptRelease,
} = require("../dist/electron/userscript-update.js");

const scriptPath = path.join(__dirname, "..", "assets", "userscripts", "monkey.js");

async function main() {
  const source = await readFile(scriptPath, "utf8");
  const identity = parseUserScriptIdentity(source);
  const manifest = {
    ...identity,
    sha256: sha256Text(source),
    size: Buffer.byteLength(source, "utf8"),
    sourceUrl: USER_SCRIPT_SOURCE_PATH,
  };
  assert.deepEqual(identity, { name: "药大拾间·学习通助手", version: "2.2.1" });
  assert.doesNotThrow(() => validateUserScriptRelease(source, manifest));
  assert.throws(
    () => validateUserScriptRelease(`${source}\n// tampered`, manifest),
    /大小校验失败|SHA-256 校验失败/,
  );

  const cacheDirectory = await mkdtemp(path.join(tmpdir(), "cpu-userscript-test-"));
  try {
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(String(url));
      if (new URL(url).pathname === USER_SCRIPT_MANIFEST_PATH) {
        return new Response(JSON.stringify({ code: 0, data: manifest, message: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (new URL(url).pathname === USER_SCRIPT_SOURCE_PATH) {
        return new Response(source, {
          status: 200,
          headers: {
            "content-type": "application/javascript",
            "content-length": String(manifest.size),
          },
        });
      }
      return new Response("", { status: 404 });
    };

    const olderSource = source.replace("// @version      2.2.1", "// @version      2.1.9");
    const updated = await checkUserScriptUpdate({
      origin: "https://cpu.lizmt.cn",
      cacheDirectory,
      currentSource: olderSource,
      validateSource: () => undefined,
      fetchImpl,
    });
    assert.equal(updated.status, "updated");
    assert.equal(requests.length, 2);

    const cached = await readCachedUserScript(cacheDirectory, () => undefined);
    assert.equal(cached?.manifest.version, "2.2.1");
    assert.equal(cached?.source, source);

    requests.length = 0;
    const current = await checkUserScriptUpdate({
      origin: "https://cpu.lizmt.cn",
      cacheDirectory,
      currentSource: source,
      validateSource: () => undefined,
      fetchImpl,
    });
    assert.equal(current.status, "current");
    assert.equal(requests.length, 1, "脚本未变化时不应重复下载正文");
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }

  console.log("学习通助手脚本热更新：版本、哈希、缓存与免重复下载检查通过。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
