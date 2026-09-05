import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { publishedAndroidRelease, validateAndroidRelease, verifyAndroidReleaseBytes } from "../src/services/androidRelease";

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
