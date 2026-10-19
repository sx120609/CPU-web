import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { applyApkDelta, createApkDelta } from "../services/androidDelta";
import {
  androidPatchFileName,
  validateAndroidRelease,
  type AndroidPatch,
  type AndroidProduct,
  type AndroidRelease,
} from "../services/androidRelease";

/**
 * Builds the incremental update from an older signed APK to the new signed
 * APK, checks that it rebuilds the new APK byte for byte, and (with
 * `--candidate=`) records it in the candidate release manifest.
 *
 *   node --import ./server/node_modules/tsx/dist/loader.mjs server/src/scripts/buildAndroidDelta.ts --product=next \
 *     --from=<CPU-Web-Android-NEXT-V1001.apk> --from-version=1001 --to=<CPU-Web-Android-NEXT-V1002.apk> \
 *     --candidate=output/android-next-1002/candidate.json --out=output/android-next-1002
 *
 * The patch file is uploaded to the same enterprise-drive folder as the APKs.
 */
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const fromPath = arg("from");
  const toPath = arg("to");
  const fromVersion = Number(arg("from-version"));
  if (!fromPath || !toPath || !Number.isSafeInteger(fromVersion) || fromVersion < 1) {
    throw new Error("用法：--from=<旧版 APK> --from-version=<旧版 versionCode> --to=<新版 APK> [--to-version=] [--candidate=] [--out=]");
  }
  const product: AndroidProduct = arg("product") === "next" ? "next" : "stable";
  const candidatePath = arg("candidate");
  const candidate: AndroidRelease | null = candidatePath ? JSON.parse(await readFile(path.resolve(candidatePath), "utf8")) : null;
  if (candidate) validateAndroidRelease(candidate, product);
  const toVersion = candidate?.versionCode ?? Number(arg("to-version"));
  if (!Number.isSafeInteger(toVersion) || toVersion <= fromVersion) throw new Error("新版 versionCode 必须高于旧版");

  const old = await readFile(path.resolve(fromPath));
  const next = await readFile(path.resolve(toPath));
  if (candidate && (next.length !== candidate.size || sha256(next) !== candidate.sha256)) {
    throw new Error("新版 APK 与候选清单的大小或 SHA-256 不一致，请先签名再生成增量包");
  }
  const started = Date.now();
  const { patch, stats } = createApkDelta(old, next);
  const rebuilt = applyApkDelta(old, patch);
  if (!rebuilt.equals(next)) throw new Error("增量包没能还原新版 APK");
  const ratio = patch.length / next.length;
  console.log(`[android-delta] V${fromVersion} → V${toVersion}: ${patch.length} bytes (${(ratio * 100).toFixed(1)}% of ${next.length}), ` +
    `copied ${stats.copied}, diffed ${stats.diffed} (${stats.diffedEntries.join(", ") || "none"}), literal ${stats.literal}, ` +
    `${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (ratio > 0.8) {
    console.log("[android-delta] 增量包没有明显小于完整安装包，不必发布；这个版本的用户会下载完整安装包。");
    return;
  }

  const fileName = androidPatchFileName(product, fromVersion, toVersion);
  const outDirectory = path.resolve(arg("out") || path.dirname(path.resolve(toPath)));
  await mkdir(outDirectory, { recursive: true });
  await writeFile(path.join(outDirectory, fileName), patch);
  const entry: AndroidPatch = { fromVersionCode: fromVersion, fromSha256: sha256(old), fileName, size: patch.length, sha256: sha256(patch) };
  console.log(JSON.stringify(entry, null, 2));
  if (candidate && candidatePath) {
    const patches = [...(candidate.patches ?? []).filter((item) => item.fromVersionCode !== fromVersion), entry]
      .sort((a, b) => b.fromVersionCode - a.fromVersionCode);
    const updated = validateAndroidRelease({ ...candidate, patches }, product);
    await writeFile(path.resolve(candidatePath), `${JSON.stringify(updated, null, 2)}\n`);
    console.log(`[android-delta] recorded in ${candidatePath}`);
  }
}

if (require.main === module) main().catch((error) => { console.error(`[android-delta] ${error.message}`); process.exitCode = 1; });
