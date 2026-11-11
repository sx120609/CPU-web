import assert from "node:assert/strict";
import test from "node:test";
import { compareAppVersions, getAppStoreVersion, isMarketingVersion, parseAppStoreLookup, parseAppStoreRelease, resetAppStoreVersionCache } from "../src/services/iosAppUpdate";

test("marketing versions compare part by part", () => {
  assert.equal(compareAppVersions("4.13", "4.15"), -1);
  assert.equal(compareAppVersions("4.9", "4.15"), -1);
  assert.equal(compareAppVersions("4.15", "4.15.0"), 0);
  assert.equal(compareAppVersions("4.15.1", "4.15"), 1);
  assert.equal(compareAppVersions("5.0", "4.15"), 1);
});

test("the lookup must describe this app and carry a dotted version", () => {
  assert.equal(parseAppStoreLookup({ results: [{ trackId: 6811073406, version: "4.15" }] }), "4.15");
  assert.equal(parseAppStoreLookup({ results: [{ trackId: 1, version: "4.15" }] }), null);
  assert.equal(parseAppStoreLookup({ results: [{ trackId: 6811073406, version: "beta" }] }), null);
  assert.equal(parseAppStoreLookup({ results: [] }), null);
});

test("the App Store version is cached and survives a failed lookup", async () => {
  resetAppStoreVersionCache();
  let calls = 0;
  let fail = false;
  const fetcher = (async () => {
    calls += 1;
    if (fail) throw new Error("offline");
    return new Response(JSON.stringify({ results: [{ trackId: 6811073406, version: "4.15" }] }));
  }) as typeof fetch;
  const start = 1_000_000_000;
  assert.equal(await getAppStoreVersion(fetcher, start), "4.15");
  assert.equal(await getAppStoreVersion(fetcher, start + 60_000), "4.15");
  assert.equal(calls, 1);
  fail = true;
  assert.equal(await getAppStoreVersion(fetcher, start + 31 * 60_000), "4.15");
  assert.equal(calls, 2);
  // A failure waits five minutes, not the full half hour, before retrying.
  assert.equal(await getAppStoreVersion(fetcher, start + 33 * 60_000), "4.15");
  assert.equal(calls, 2);
  assert.equal(await getAppStoreVersion(fetcher, start + 37 * 60_000), "4.15");
  assert.equal(calls, 3);
  resetAppStoreVersionCache();
});

test("App Store release notes become plain lines", () => {
  const release = parseAppStoreRelease({
    results: [{ trackId: 6811073406, version: "4.18", releaseNotes: "· 登录时可以选择学校。\n\n· 新增找共同空闲。\r\n1. 修复问题" }],
  });
  assert.deepEqual(release, { version: "4.18", notes: ["登录时可以选择学校。", "新增找共同空闲。", "修复问题"] });
  assert.equal(isMarketingVersion("4.18"), true);
  assert.equal(isMarketingVersion("4.18; drop"), false);
  assert.equal(isMarketingVersion(["4.18"]), false);
});
