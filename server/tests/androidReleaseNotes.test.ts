import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { publishedAndroidRelease } from "../src/services/androidRelease";

// Every official Android version tells users what it changes: in the update
// dialogs before installing and in 更新完成 afterwards. The notes are written in
// android/release-notes.json, keyed by versionCode, and copied into the manifest.
const root = path.resolve(__dirname, "../..");
const notesByVersion = JSON.parse(readFileSync(path.join(root, "android/release-notes.json"), "utf8")) as Record<string, unknown>;
const candidateVersion = Number(
  /versionCode\s+(\d+)/.exec(readFileSync(path.join(root, "android/app/build.gradle"), "utf8"))?.[1],
);

function assertNotes(value: unknown, label: string) {
  assert.ok(Array.isArray(value), `${label}: 缺少更新说明（android/release-notes.json）`);
  assert.ok(value.length >= 1 && value.length <= 20, `${label}: 更新说明需要 1 到 20 条`);
  for (const note of value) {
    assert.equal(typeof note, "string", `${label}: 每条更新说明都是文字`);
    assert.ok(note.trim().length > 0 && note.length <= 200, `${label}: 每条更新说明 1 到 200 字`);
  }
}

test("the version being built has release notes", () => {
  assert.ok(Number.isSafeInteger(candidateVersion), "android/app/build.gradle 里读不到 versionCode");
  assertNotes(notesByVersion[String(candidateVersion)], `V${candidateVersion}`);
});

test("the published manifest carries the notes written for its version", () => {
  const label = `V${publishedAndroidRelease.versionCode}`;
  assertNotes(publishedAndroidRelease.notes, `${label} 发布清单`);
  assert.deepEqual(publishedAndroidRelease.notes, notesByVersion[String(publishedAndroidRelease.versionCode)],
    `${label}: 发布清单的 notes 要和 android/release-notes.json 一致`);
});
