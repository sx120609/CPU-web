import assert from "node:assert/strict";
import test from "node:test";
import { getAppGalleryRelease, parseAppGalleryRelease, resetAppGalleryReleaseCache } from "../src/services/harmonyAppUpdate";

const onSale = {
  pkgName: "cn.lizmt.cpuweb",
  version: "3.1.1",
  versionCode: 32,
  isShelves: 1,
  newFeatures: "1. 启动更快。\n2. 课表卡片可以添加到锁屏。",
};

test("the AppGallery answer must describe this app on sale", () => {
  assert.deepEqual(parseAppGalleryRelease(onSale), {
    version: "3.1.1",
    versionCode: 32,
    notes: ["启动更快。", "课表卡片可以添加到锁屏。"],
  });
  assert.equal(parseAppGalleryRelease({ ...onSale, pkgName: "other.app" }), null);
  assert.equal(parseAppGalleryRelease({ ...onSale, isShelves: 0 }), null);
  assert.equal(parseAppGalleryRelease({ ...onSale, versionCode: "x" }), null);
  assert.equal(parseAppGalleryRelease(null), null);
});

test("the AppGallery release is cached and survives a failed lookup", async () => {
  resetAppGalleryReleaseCache();
  let calls = 0;
  let fail = false;
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    calls += 1;
    assert.equal(init?.method, "POST");
    if (fail) throw new Error("offline");
    return new Response(JSON.stringify(onSale));
  }) as typeof fetch;
  const start = 1_000_000_000;
  assert.equal((await getAppGalleryRelease(fetcher, start))?.versionCode, 32);
  assert.equal((await getAppGalleryRelease(fetcher, start + 60_000))?.versionCode, 32);
  assert.equal(calls, 1);
  fail = true;
  assert.equal((await getAppGalleryRelease(fetcher, start + 31 * 60_000))?.versionCode, 32);
  assert.equal(calls, 2);
  resetAppGalleryReleaseCache();
});
