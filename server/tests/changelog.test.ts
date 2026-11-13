import assert from "node:assert/strict";
import test from "node:test";
import { publishedAndroidRelease } from "../src/services/androidRelease";
import { changelogEntries, listChangelog, type ChangelogEntry } from "../src/services/changelog";
import { compareAppVersions } from "../src/services/iosAppUpdate";

// /changelog shows users what every released version brought. The entries are
// written by hand in server/src/releases/changelog.json.

test("every entry is complete and each platform runs newest first", () => {
  for (const [platform, entries] of Object.entries(changelogEntries)) {
    assert.ok(entries.length > 0, `${platform}: 没有任何版本`);
    entries.forEach((entry, index) => {
      const label = `${platform} ${entry.version}`;
      assert.match(entry.version, /^\d+(\.\d+){1,3}$/, `${label}: 版本号`);
      assert.ok(Number.isSafeInteger(entry.build) && entry.build > 0, `${label}: build`);
      if (entry.date !== undefined) assert.match(entry.date, /^\d{4}-\d{2}(-\d{2})?$/, `${label}: 日期写成 2026-11-13 或 2026-11`);
      assert.ok(entry.notes.length >= 1 && entry.notes.length <= 20, `${label}: 更新内容需要 1 到 20 条`);
      for (const note of entry.notes) {
        assert.ok(note.trim().length > 0 && note.length <= 200, `${label}: 每条更新内容 1 到 200 字`);
      }
      const older = entries[index + 1];
      if (!older) return;
      assert.ok(entry.build > older.build, `${label}: 要排在 ${older.version} 前面，build 也更大`);
      assert.ok(compareAppVersions(entry.version, older.version) > 0, `${label}: 版本号要比 ${older.version} 新`);
    });
  }
});

test("the published Android version is in the changelog", () => {
  const entry = changelogEntries.android.find(item => item.build === publishedAndroidRelease.versionCode);
  assert.ok(entry, `V${publishedAndroidRelease.versionCode}: 发布安卓新版时在 server/src/releases/changelog.json 里补上这一版`);
  assert.equal(entry.version, publishedAndroidRelease.versionName);
  assert.ok(entry.date, "安卓版本写上发布日期");
});

const entries: Record<"android" | "harmony" | "ios", ChangelogEntry[]> = {
  android: [
    { version: "99.0.0", build: publishedAndroidRelease.versionCode + 1, notes: ["还没发布"] },
    { version: "1.0.0", build: 1, date: "2026-01-01", notes: ["已发布"] },
  ],
  harmony: [
    { version: "3.3.0", build: 35, pending: true, notes: ["审核中"] },
    { version: "3.2.0", build: 33, notes: ["在售"] },
  ],
  ios: [
    { version: "4.20", build: 83, pending: true, notes: ["审核中"] },
    { version: "4.19", build: 82, notes: ["在售"] },
    { version: "4.9", build: 60, notes: ["更早"] },
  ],
};

const versions = (list: Array<{ version: string }>) => list.map(item => item.version);

test("a version shows up only once it is published or on sale", () => {
  const listed = listChangelog({
    harmony: { version: "3.2.0", versionCode: 33, notes: [] },
    ios: { version: "4.19", notes: [] },
  }, entries);
  assert.deepEqual(versions(listed.android), ["1.0.0"]);
  assert.deepEqual(versions(listed.harmony), ["3.2.0"]);
  assert.deepEqual(versions(listed.ios), ["4.19", "4.9"]);
  assert.ok(!("pending" in listed.harmony[0]));

  const approved = listChangelog({
    harmony: { version: "3.3.0", versionCode: 35, notes: [] },
    ios: { version: "4.20", notes: [] },
  }, entries);
  assert.deepEqual(versions(approved.harmony), ["3.3.0", "3.2.0"]);
  assert.deepEqual(versions(approved.ios), ["4.20", "4.19", "4.9"]);
});

test("when a store cannot be reached, versions still awaiting it stay hidden", () => {
  const listed = listChangelog({ harmony: null, ios: null }, entries);
  assert.deepEqual(versions(listed.harmony), ["3.2.0"]);
  assert.deepEqual(versions(listed.ios), ["4.19", "4.9"]);
});
