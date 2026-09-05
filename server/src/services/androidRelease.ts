import release from "../releases/android.json";
import { createHash } from "node:crypto";

export type AndroidRelease = typeof release;
export const ANDROID_RELEASE_CERTIFICATE = "c18b7adc4fc870f75fe3c6c33d643fa4233af54c254c96edf48fcca6743df744";

export function validateAndroidRelease(value: AndroidRelease) {
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1
    || value.packageName !== "cn.lizmt.cpuweb" || value.fileName !== `CPU-Web-Android-V${value.versionCode}.apk`
    || !/^\d+\.\d+\.\d+$/.test(value.versionName) || !Number.isSafeInteger(value.size) || value.size < 65536
    || !/^[a-f0-9]{64}$/.test(value.sha256) || value.certificateSha256 !== ANDROID_RELEASE_CERTIFICATE
    || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !Number.isSafeInteger(value.buildRun) || value.buildRun <= 0) {
    throw new Error("安卓发布清单无效");
  }
  return value;
}

export function verifyAndroidReleaseBytes(bytes: Uint8Array, expected: AndroidRelease) {
  validateAndroidRelease(expected);
  if (bytes.length !== expected.size || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
    throw new Error("安装包大小或 SHA-256 与发布清单不一致");
  }
}

export const publishedAndroidRelease = validateAndroidRelease(release);
