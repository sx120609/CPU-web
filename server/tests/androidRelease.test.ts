import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { publishedAndroidNextRelease, publishedAndroidRelease, validateAndroidRelease, verifyAndroidReleaseBytes } from "../src/services/androidRelease";
import { androidNextAccess, canSeeAndroidNext, inviteCodeHash, validateAndroidNextAccess } from "../src/services/androidNextAccess";

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

test("药大拾间 NEXT is its own product: package, file names and patches never pass as the stable app", () => {
  const sha = "d".repeat(64);
  const next = {
    ...publishedAndroidRelease, packageName: "cn.lizmt.cpuweb.next", versionCode: 1002, versionName: "1.0.1",
    fileName: "CPU-Web-Android-NEXT-V1002.apk", notes: ["工作台"],
    patches: [{ fromVersionCode: 1001, fromSha256: sha, fileName: "CPU-Web-Android-NEXT-V1001-V1002.cpupatch", size: 9000, sha256: sha }],
  };
  assert.equal(validateAndroidRelease(next, "next").versionCode, 1002);
  assert.throws(() => validateAndroidRelease(next));
  assert.throws(() => validateAndroidRelease({ ...next, packageName: "cn.lizmt.cpuweb" }, "next"));
  assert.throws(() => validateAndroidRelease({ ...next, fileName: "CPU-Web-Android-V1002.apk" }, "next"));
  assert.throws(() => validateAndroidRelease({ ...next, patches: [{ ...next.patches[0], fileName: "CPU-Web-Android-V1001-V1002.cpupatch" }] }, "next"));
  assert.throws(() => validateAndroidRelease(publishedAndroidRelease, "next"));
  // Before its first release the NEXT manifest is empty.
  assert.ok(publishedAndroidNextRelease === null || publishedAndroidNextRelease.packageName === "cn.lizmt.cpuweb.next");
});

test("NEXT access rules keep invitation codes out of the repository and reject malformed policies", () => {
  const policy = validateAndroidNextAccess({ mode: "invite", inviteCodeSha256: [inviteCodeHash("Q7XKD2MPR9TA")] });
  assert.ok(canSeeAndroidNext(policy, { invite: "q7xkd2mpr9ta" }));
  assert.ok(!canSeeAndroidNext(policy, { invite: "Q7XKD2MPR9TB" }));
  assert.ok(!canSeeAndroidNext(policy, { invite: ["Q7XKD2MPR9TA"] }));
  assert.ok(canSeeAndroidNext(policy, { userAgent: "x CPUWebNextApp/1001" }));
  assert.ok(!canSeeAndroidNext(policy, { userAgent: "x CPUWebScheduleApp/59" }));
  assert.ok(canSeeAndroidNext({ mode: "public", inviteCodeSha256: [] }, {}));
  assert.throws(() => validateAndroidNextAccess({ mode: "everyone" as "public", inviteCodeSha256: [] }));
  assert.throws(() => validateAndroidNextAccess({ mode: "invite", inviteCodeSha256: ["Q7XKD2MPR9TA"] }));
  // The committed policy only holds hashes.
  assert.ok(androidNextAccess.inviteCodeSha256.every((hash) => /^[a-f0-9]{64}$/.test(hash)));
});
