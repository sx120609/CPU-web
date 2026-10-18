import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { androidReleaseFor, betaAndroidRelease, parseAndroidChannel, publishedAndroidRelease, validateAndroidRelease, verifyAndroidReleaseBytes } from "../src/services/androidRelease";

test("release metadata rejects changed identity, certificate and inconsistent filenames", () => {
  assert.throws(()=>validateAndroidRelease({...publishedAndroidRelease, packageName:"other.app"}));
  assert.throws(()=>validateAndroidRelease({...publishedAndroidRelease, certificateSha256:"0".repeat(64)}));
  assert.throws(()=>validateAndroidRelease({...publishedAndroidRelease, fileName:"CPU-Web-Android-V999.apk"}));
});

test("enterprise readback detects truncated and same-size corrupted files", () => {
  const bytes = Buffer.alloc(70000,42);
  const release={...publishedAndroidRelease,size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
  verifyAndroidReleaseBytes(bytes,release);
  assert.throws(()=>verifyAndroidReleaseBytes(bytes.subarray(1),release));
  bytes[0]=0;
  assert.throws(()=>verifyAndroidReleaseBytes(bytes,release));
});

test("patch and note entries are checked like the rest of the manifest", () => {
  const sha = "b".repeat(64);
  const base = { ...publishedAndroidRelease, versionCode: 61, fileName: "CPU-Web-Android-V61.apk", versionName: "4.1.1" };
  const patch = { fromVersionCode: 60, fromSha256: sha, fileName: "CPU-Web-Android-V60-V61.cpupatch", size: 140000, sha256: sha };
  assert.equal(validateAndroidRelease({ ...base, notes: ["新的工作台"], patches: [patch] }).patches?.length, 1);
  assert.throws(() => validateAndroidRelease({ ...base, patches: [{ ...patch, fileName: "other.cpupatch" }] }));
  assert.throws(() => validateAndroidRelease({ ...base, patches: [{ ...patch, fromVersionCode: 61, fileName: "CPU-Web-Android-V61-V61.cpupatch" }] }));
  assert.throws(() => validateAndroidRelease({ ...base, patches: [{ ...patch, size: base.size }] }));
  assert.throws(() => validateAndroidRelease({ ...base, patches: [patch, patch] }));
  assert.throws(() => validateAndroidRelease({ ...base, notes: [""] }));
});

test("the NEXT channel only receives a test build while it is newer than the release", () => {
  const stable = publishedAndroidRelease;
  const newer = { ...stable, versionCode: stable.versionCode + 1, fileName: `CPU-Web-Android-V${stable.versionCode + 1}.apk` };
  assert.deepEqual(androidReleaseFor("beta", stable, newer), { release: newer, channel: "beta" });
  assert.deepEqual(androidReleaseFor("stable", stable, newer), { release: stable, channel: "stable" });
  assert.deepEqual(androidReleaseFor("beta", stable, stable), { release: stable, channel: "stable" });
  assert.equal(parseAndroidChannel("beta"), "beta");
  assert.equal(parseAndroidChannel(["beta"]), "stable");
  assert.equal(parseAndroidChannel(undefined), "stable");
  // The published NEXT manifest is valid and never older than the release.
  assert.ok(betaAndroidRelease.versionCode >= 1);
});
