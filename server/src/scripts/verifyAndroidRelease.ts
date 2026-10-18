import { readFile, writeFile, mkdir, readdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  betaAndroidRelease,
  publishedAndroidRelease,
  validateAndroidRelease,
  verifyAndroidPatchBytes,
  verifyAndroidReleaseBytes,
  type AndroidRelease,
} from "../services/androidRelease";
import { applyApkDelta } from "../services/androidDelta";
import { resolveAndroidDownload } from "../services/pdsShare";

const root = path.resolve(__dirname, "../../..");
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

export async function readEnterprisePackage(url: string, allowedSiteOrigin?: string) {
  const hosts: string[] = [];
  for (let step = 0; step < 5; step += 1) {
    const target = new URL(url);
    const siteEntry = step === 0 && allowedSiteOrigin === target.origin;
    if (target.protocol !== "https:" || (!siteEntry && !target.hostname.endsWith(".aliyunfile.com"))) {
      throw new Error("安卓安装包未通过企业盘分发");
    }
    hosts.push(target.hostname);
    const response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(60000) });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = new URL(location, target).toString();
      continue;
    }
    if (!response.ok || siteEntry) throw new Error(`安装包下载返回异常状态 ${response.status}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), hosts };
  }
  throw new Error("企业盘下载重定向次数过多");
}

async function verifyPackage(apkPath: string, release: AndroidRelease) {
  const bytes = await readFile(apkPath);
  verifyAndroidReleaseBytes(bytes, release);
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("签名校验需要 ANDROID_HOME");
  const versions = (await readdir(path.join(sdk, "build-tools"))).sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const buildTools = versions.map((version) => path.join(sdk, "build-tools", version))
    .find((directory) => existsSync(path.join(directory, "lib", "apksigner.jar")));
  if (!buildTools) throw new Error("未找到 Android build-tools");
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java";
  const certificate = execFileSync(java, ["-jar", path.join(buildTools, "lib", "apksigner.jar"), "verify", "--print-certs", apkPath], { encoding: "utf8" });
  if (!certificate.includes(`certificate SHA-256 digest: ${release.certificateSha256}`)) throw new Error("APK 发布签名不匹配");
  const badging = execFileSync(path.join(buildTools, process.platform === "win32" ? "aapt.exe" : "aapt"), ["dump", "badging", apkPath], { encoding: "utf8" });
  if (!badging.includes(`name='${release.packageName}' versionCode='${release.versionCode}' versionName='${release.versionName}'`)) {
    throw new Error("APK 包名或版本与发布清单不一致");
  }
}

async function verifyBuildRun(release: AndroidRelease) {
  const run = JSON.parse(execFileSync("gh", ["api", `repos/sx120609/CPU-web/actions/runs/${release.buildRun}`], { encoding: "utf8" }));
  if (run.head_sha !== release.sourceCommit || run.conclusion !== "success" || run.name !== "Android release artifact") {
    throw new Error("APK 来源提交的 GitHub Android 构建未成功");
  }
}

/** The release's APK as stored on the enterprise drive. */
async function enterpriseApk(release: AndroidRelease) {
  const file = await resolveAndroidDownload(release.fileName);
  if (file.name !== release.fileName || file.size !== release.size) throw new Error("企业盘文件名或大小不匹配");
  const enterprise = await readEnterprisePackage(file.url);
  verifyAndroidReleaseBytes(enterprise.bytes, release);
  return enterprise;
}

/**
 * Every listed patch, downloaded from the enterprise drive with its base APK,
 * must rebuild exactly the release's APK.
 */
async function verifyPatches(release: AndroidRelease) {
  const verified: { fromVersionCode: number; size: number }[] = [];
  for (const patch of release.patches ?? []) {
    const file = await resolveAndroidDownload(patch.fileName);
    if (file.name !== patch.fileName || file.size !== patch.size) throw new Error(`企业盘增量包缺失或大小不符：${patch.fileName}`);
    const bytes = (await readEnterprisePackage(file.url)).bytes;
    verifyAndroidPatchBytes(bytes, patch);
    const baseName = `CPU-Web-Android-V${patch.fromVersionCode}.apk`;
    const baseFile = await resolveAndroidDownload(baseName);
    const base = Buffer.from((await readEnterprisePackage(baseFile.url)).bytes);
    const rebuilt = applyApkDelta(base, Buffer.from(bytes));
    verifyAndroidReleaseBytes(rebuilt, release);
    verified.push({ fromVersionCode: patch.fromVersionCode, size: patch.size });
    console.log(`[android-release] patch ${patch.fileName} rebuilds ${release.fileName}`);
  }
  return verified;
}

/** A NEXT build is not kept in the repository: check its signature from the downloaded bytes. */
async function verifyDownloadedPackage(bytes: Uint8Array, release: AndroidRelease) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cpu-android-"));
  try {
    const file = path.join(directory, release.fileName);
    await writeFile(file, bytes);
    await verifyPackage(file, release);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyPublic(site: string, channel: "stable" | "beta", release: AndroidRelease) {
  const origin = new URL(site).origin;
  const query = channel === "beta" ? "?channel=beta" : "";
  const response = await fetch(`${origin}/api/site/downloads/android${query}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("公开安卓版本接口不可用");
  const metadata = (await response.json() as { data?: AndroidRelease }).data;
  if (metadata?.versionCode !== release.versionCode || metadata?.sha256 !== release.sha256) throw new Error("公开版本清单尚未切换");
  const download = await readEnterprisePackage(`${origin}/api/site/downloads/android-app${query}`, origin);
  verifyAndroidReleaseBytes(download.bytes, release);
  return download.hosts;
}

async function main() {
  const candidate = arg("candidate");
  const channel = arg("channel") === "beta" ? "beta" : "stable";
  const explicitChannel = arg("channel") !== undefined;
  const release: AndroidRelease = candidate
    ? JSON.parse(await readFile(path.resolve(candidate), "utf8"))
    : channel === "beta" ? betaAndroidRelease : publishedAndroidRelease;
  validateAndroidRelease(release);
  const publicOnly = process.argv.includes("--public-only");
  const apkArg = arg("apk");
  const repositoryApk = path.join(root, "web/public/downloads", release.fileName);
  if (!publicOnly) {
    if (apkArg || existsSync(repositoryApk) || channel === "stable") await verifyPackage(path.resolve(apkArg || repositoryApk), release);
    await verifyBuildRun(release);
  }
  const enterprise = await enterpriseApk(release);
  if (!publicOnly && !apkArg && !existsSync(repositoryApk) && channel === "beta") await verifyDownloadedPackage(enterprise.bytes, release);
  const patches = publicOnly ? [] : await verifyPatches(release);
  const site = arg("site");
  const publicHosts = site ? await verifyPublic(site, channel, release) : [];

  // The deployment check (no arguments) also covers a NEXT build that is out.
  let beta: unknown = null;
  if (!candidate && !explicitChannel && !publicOnly && betaAndroidRelease.versionCode > publishedAndroidRelease.versionCode) {
    await verifyBuildRun(betaAndroidRelease);
    const betaApk = await enterpriseApk(betaAndroidRelease);
    await verifyDownloadedPackage(betaApk.bytes, betaAndroidRelease);
    beta = { release: betaAndroidRelease, patches: await verifyPatches(betaAndroidRelease), enterpriseHosts: betaApk.hosts };
  }

  const receipt = {
    verifiedAt: new Date().toISOString(), channel, release, patches, enterpriseHosts: enterprise.hosts, publicHosts,
    packageChecked: !publicOnly, beta,
  };
  const receiptPath = path.resolve(arg("receipt") || path.join(root, "output/android-release-verification.json"));
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  if (process.argv.includes("--promote")) {
    if (!candidate || publicOnly) throw new Error("发布提升必须提供候选清单并完成 APK 校验");
    if (channel === "beta") {
      if (release.versionCode <= Math.max(publishedAndroidRelease.versionCode, betaAndroidRelease.versionCode)) {
        throw new Error("测试版版本号必须高于当前正式版和测试版");
      }
      await writeFile(path.join(root, "server/src/releases/android-beta.json"), `${JSON.stringify(release, null, 2)}\n`);
    } else {
      if (release.versionCode <= publishedAndroidRelease.versionCode) throw new Error("发布版本必须递增");
      await writeFile(path.join(root, "server/src/releases/android.json"), `${JSON.stringify(release, null, 2)}\n`);
    }
  }
  console.log(`[android-release] verified ${channel} ${release.versionName}: ${release.fileName}, ${release.size} bytes, sha256=${release.sha256}`);
}

if (require.main === module) main().catch((error) => { console.error(`[android-release] ${error.message}`); process.exitCode = 1; });
