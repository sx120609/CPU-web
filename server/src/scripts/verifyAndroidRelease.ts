import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { publishedAndroidRelease, validateAndroidRelease, verifyAndroidReleaseBytes, type AndroidRelease } from "../services/androidRelease";
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

async function main() {
  const candidate = arg("candidate");
  const release: AndroidRelease = candidate ? JSON.parse(await readFile(path.resolve(candidate), "utf8")) : publishedAndroidRelease;
  validateAndroidRelease(release);
  const publicOnly = process.argv.includes("--public-only");
  if (!publicOnly) {
    await verifyPackage(path.resolve(arg("apk") || path.join(root, "web/public/downloads", release.fileName)), release);
    const run = JSON.parse(execFileSync("gh", ["api", `repos/sx120609/CPU-web/actions/runs/${release.buildRun}`], { encoding: "utf8" }));
    if (run.head_sha !== release.sourceCommit || run.conclusion !== "success" || run.name !== "Android release artifact") {
      throw new Error("APK 来源提交的 GitHub Android 构建未成功");
    }
  }
  const file = await resolveAndroidDownload(release.fileName);
  if (file.name !== release.fileName || file.size !== release.size) throw new Error("企业盘文件名或大小不匹配");
  const enterprise = await readEnterprisePackage(file.url);
  verifyAndroidReleaseBytes(enterprise.bytes, release);
  const site = arg("site");
  let publicHosts: string[] = [];
  if (site) {
    const origin = new URL(site).origin;
    const response = await fetch(`${origin}/api/site/downloads/android`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("公开安卓版本接口不可用");
    const metadata = (await response.json() as { data?: AndroidRelease }).data;
    if (metadata?.versionCode !== release.versionCode || metadata?.sha256 !== release.sha256) throw new Error("公开版本清单尚未切换");
    const download = await readEnterprisePackage(`${origin}/api/site/downloads/android-app`, origin);
    verifyAndroidReleaseBytes(download.bytes, release);
    publicHosts = download.hosts;
  }
  const receipt = { verifiedAt: new Date().toISOString(), release, enterpriseHosts: enterprise.hosts, publicHosts, packageChecked: !publicOnly };
  const receiptPath = path.resolve(arg("receipt") || path.join(root, "output/android-release-verification.json"));
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  if (process.argv.includes("--promote")) {
    if (!candidate || publicOnly) throw new Error("发布提升必须提供候选清单并完成 APK 校验");
    if (release.versionCode <= publishedAndroidRelease.versionCode) throw new Error("发布版本必须递增");
    await writeFile(path.join(root, "server/src/releases/android.json"), `${JSON.stringify(release, null, 2)}\n`);
  }
  console.log(`[android-release] verified ${release.versionName}: ${release.fileName}, ${release.size} bytes, sha256=${release.sha256}`);
}

if (require.main === module) main().catch((error) => { console.error(`[android-release] ${error.message}`); process.exitCode = 1; });
