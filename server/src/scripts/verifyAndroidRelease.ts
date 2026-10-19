import { readFile, writeFile, mkdir, readdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  androidApkFileName,
  publishedAndroidNextRelease,
  publishedAndroidRelease,
  validateAndroidRelease,
  verifyAndroidPatchBytes,
  verifyAndroidReleaseBytes,
  type AndroidProduct,
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

async function verifyBuildRun(release: AndroidRelease, workflow: string) {
  const run = JSON.parse(execFileSync("gh", ["api", `repos/sx120609/CPU-web/actions/runs/${release.buildRun}`], { encoding: "utf8" }));
  if (run.head_sha !== release.sourceCommit || run.conclusion !== "success" || run.name !== workflow) {
    throw new Error("APK 来源提交的 GitHub Android 构建未成功");
  }
}

/** The release's APK as stored on the enterprise drive. */
async function enterpriseApk(release: AndroidRelease, product: AndroidProduct) {
  const file = await resolveAndroidDownload(release.fileName);
  if (file.name !== release.fileName || file.size !== release.size) throw new Error("企业盘文件名或大小不匹配");
  const enterprise = await readEnterprisePackage(file.url);
  verifyAndroidReleaseBytes(enterprise.bytes, release, product);
  return enterprise;
}

/**
 * Every listed patch, downloaded from the enterprise drive with its base APK,
 * must rebuild exactly the release's APK.
 */
async function verifyPatches(release: AndroidRelease, product: AndroidProduct) {
  const verified: { fromVersionCode: number; size: number }[] = [];
  for (const patch of release.patches ?? []) {
    const file = await resolveAndroidDownload(patch.fileName);
    if (file.name !== patch.fileName || file.size !== patch.size) throw new Error(`企业盘增量包缺失或大小不符：${patch.fileName}`);
    const bytes = (await readEnterprisePackage(file.url)).bytes;
    verifyAndroidPatchBytes(bytes, patch);
    const baseName = androidApkFileName(product, patch.fromVersionCode);
    const baseFile = await resolveAndroidDownload(baseName);
    const base = Buffer.from((await readEnterprisePackage(baseFile.url)).bytes);
    const rebuilt = applyApkDelta(base, Buffer.from(bytes));
    verifyAndroidReleaseBytes(rebuilt, release, product);
    verified.push({ fromVersionCode: patch.fromVersionCode, size: patch.size });
    console.log(`[android-release] patch ${patch.fileName} rebuilds ${release.fileName}`);
  }
  return verified;
}

/** NEXT builds are not kept in the repository: check the signature of the downloaded bytes. */
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

async function verifyPublic(site: string, product: AndroidProduct, release: AndroidRelease) {
  const origin = new URL(site).origin;
  const base = product === "next" ? "/api/site/downloads/android-next" : "/api/site/downloads/android";
  const response = await fetch(`${origin}${base}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("公开安卓版本接口不可用");
  const metadata = (await response.json() as { data?: AndroidRelease }).data;
  if (metadata?.versionCode !== release.versionCode || metadata?.sha256 !== release.sha256) throw new Error("公开版本清单尚未切换");
  const download = await readEnterprisePackage(`${origin}${base}-app`, origin);
  verifyAndroidReleaseBytes(download.bytes, release, product);
  return download.hosts;
}

async function main() {
  const candidate = arg("candidate");
  const product: AndroidProduct = arg("product") === "next" ? "next" : "stable";
  const explicitProduct = arg("product") !== undefined;
  const published = product === "next" ? publishedAndroidNextRelease : publishedAndroidRelease;
  const release: AndroidRelease | null = candidate ? JSON.parse(await readFile(path.resolve(candidate), "utf8")) : published;
  if (!release) throw new Error("药大拾间 NEXT 尚未发布");
  validateAndroidRelease(release, product);
  const publicOnly = process.argv.includes("--public-only");
  const apkArg = arg("apk");
  const repositoryApk = path.join(root, "web/public/downloads", release.fileName);
  if (!publicOnly) {
    if (apkArg || existsSync(repositoryApk) || product === "stable") await verifyPackage(path.resolve(apkArg || repositoryApk), release);
    await verifyBuildRun(release, product === "next" ? "Android NEXT release artifact" : "Android release artifact");
  }
  const enterprise = await enterpriseApk(release, product);
  if (!publicOnly && !apkArg && !existsSync(repositoryApk) && product === "next") await verifyDownloadedPackage(enterprise.bytes, release);
  const patches = publicOnly ? [] : await verifyPatches(release, product);
  const site = arg("site");
  const publicHosts = site ? await verifyPublic(site, product, release) : [];

  // The deployment check (no arguments) also covers the published 药大拾间 NEXT build.
  let next: unknown = null;
  if (!candidate && !explicitProduct && !publicOnly && publishedAndroidNextRelease) {
    await verifyBuildRun(publishedAndroidNextRelease, "Android NEXT release artifact");
    const nextApk = await enterpriseApk(publishedAndroidNextRelease, "next");
    await verifyDownloadedPackage(nextApk.bytes, publishedAndroidNextRelease);
    next = { release: publishedAndroidNextRelease, patches: await verifyPatches(publishedAndroidNextRelease, "next"), enterpriseHosts: nextApk.hosts };
  }

  const receipt = {
    verifiedAt: new Date().toISOString(), product, release, patches, enterpriseHosts: enterprise.hosts, publicHosts,
    packageChecked: !publicOnly, next,
  };
  const receiptPath = path.resolve(arg("receipt") || path.join(root, "output/android-release-verification.json"));
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  if (process.argv.includes("--promote")) {
    if (!candidate || publicOnly) throw new Error("发布提升必须提供候选清单并完成 APK 校验");
    if (product === "next") {
      if (publishedAndroidNextRelease && release.versionCode <= publishedAndroidNextRelease.versionCode) {
        throw new Error("药大拾间 NEXT 的版本号必须递增");
      }
      await writeFile(path.join(root, "server/src/releases/android-next.json"), `${JSON.stringify(release, null, 2)}\n`);
    } else {
      if (release.versionCode <= publishedAndroidRelease.versionCode) throw new Error("发布版本必须递增");
      await writeFile(path.join(root, "server/src/releases/android.json"), `${JSON.stringify(release, null, 2)}\n`);
    }
  }
  console.log(`[android-release] verified ${product} ${release.versionName}: ${release.fileName}, ${release.size} bytes, sha256=${release.sha256}`);
}

if (require.main === module) main().catch((error) => { console.error(`[android-release] ${error.message}`); process.exitCode = 1; });
