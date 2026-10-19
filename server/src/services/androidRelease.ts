import release from "../releases/android.json";
import nextRelease from "../releases/android-next.json";
import { createHash } from "node:crypto";

/** An incremental update from one installed version, stored on the enterprise drive like the APKs. */
export type AndroidPatch = {
  fromVersionCode: number;
  fromSha256: string;
  fileName: string;
  size: number;
  sha256: string;
};

export type AndroidRelease = {
  schemaVersion: number;
  versionCode: number;
  versionName: string;
  packageName: string;
  fileName: string;
  size: number;
  sha256: string;
  certificateSha256: string;
  sourceCommit: string;
  buildRun: number;
  /** What changed, shown by the 药大拾间 NEXT updater. */
  notes?: string[];
  patches?: AndroidPatch[];
};

/**
 * The stable app, or 药大拾间 NEXT: a separate test app (its own package, name
 * and icon) that installs beside the stable one.
 */
export type AndroidProduct = "stable" | "next";

export const ANDROID_RELEASE_CERTIFICATE = "c18b7adc4fc870f75fe3c6c33d643fa4233af54c254c96edf48fcca6743df744";
const HEX = /^[a-f0-9]{64}$/;

const PRODUCTS: Record<AndroidProduct, { packageName: string; filePrefix: string }> = {
  stable: { packageName: "cn.lizmt.cpuweb", filePrefix: "CPU-Web-Android-V" },
  next: { packageName: "cn.lizmt.cpuweb.next", filePrefix: "CPU-Web-Android-NEXT-V" },
};

export const androidApkFileName = (product: AndroidProduct, versionCode: number) =>
  `${PRODUCTS[product].filePrefix}${versionCode}.apk`;

export const androidPatchFileName = (product: AndroidProduct, fromVersionCode: number, versionCode: number) =>
  `${PRODUCTS[product].filePrefix}${fromVersionCode}-V${versionCode}.cpupatch`;

export function validateAndroidRelease<T extends AndroidRelease>(value: T, product: AndroidProduct = "stable"): T {
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1
    || value.packageName !== PRODUCTS[product].packageName || value.fileName !== androidApkFileName(product, value.versionCode)
    || !/^\d+\.\d+\.\d+$/.test(value.versionName) || !Number.isSafeInteger(value.size) || value.size < 65536
    || !HEX.test(value.sha256) || value.certificateSha256 !== ANDROID_RELEASE_CERTIFICATE
    || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !Number.isSafeInteger(value.buildRun) || value.buildRun <= 0) {
    throw new Error("安卓发布清单无效");
  }
  if (value.notes !== undefined && (!Array.isArray(value.notes) || value.notes.length > 20
    || value.notes.some((note) => typeof note !== "string" || !note.trim() || note.length > 200))) {
    throw new Error("安卓发布说明无效");
  }
  if (value.patches !== undefined) {
    const seen = new Set<number>();
    if (!Array.isArray(value.patches) || value.patches.length > 8) throw new Error("安卓增量包清单无效");
    for (const patch of value.patches) {
      if (!Number.isSafeInteger(patch.fromVersionCode) || patch.fromVersionCode < 1 || patch.fromVersionCode >= value.versionCode
        || seen.has(patch.fromVersionCode)
        || patch.fileName !== androidPatchFileName(product, patch.fromVersionCode, value.versionCode)
        || !Number.isSafeInteger(patch.size) || patch.size < 1 || patch.size >= value.size
        || !HEX.test(patch.sha256) || !HEX.test(patch.fromSha256)) {
        throw new Error("安卓增量包清单无效");
      }
      seen.add(patch.fromVersionCode);
    }
  }
  return value;
}

export function verifyAndroidReleaseBytes(bytes: Uint8Array, expected: AndroidRelease, product: AndroidProduct = "stable") {
  validateAndroidRelease(expected, product);
  if (bytes.length !== expected.size || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
    throw new Error("安装包大小或 SHA-256 与发布清单不一致");
  }
}

export function verifyAndroidPatchBytes(bytes: Uint8Array, patch: AndroidPatch) {
  if (bytes.length !== patch.size || createHash("sha256").update(bytes).digest("hex") !== patch.sha256) {
    throw new Error("增量包大小或 SHA-256 与发布清单不一致");
  }
}

export const publishedAndroidRelease = validateAndroidRelease(release as AndroidRelease);

/** The published 药大拾间 NEXT build, or null before its first release (`android-next.json` holds `null`). */
export const publishedAndroidNextRelease: AndroidRelease | null = nextRelease
  ? validateAndroidRelease(nextRelease as unknown as AndroidRelease, "next")
  : null;

export function androidPatchFrom(value: AndroidRelease, fromVersionCode: number): AndroidPatch | null {
  return value.patches?.find((patch) => patch.fromVersionCode === fromVersionCode) ?? null;
}
