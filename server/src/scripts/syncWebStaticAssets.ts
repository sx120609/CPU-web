import path from "node:path";
import dotenv from "dotenv";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";

const projectRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(projectRoot, "server", ".env") });

const dryRun = process.argv.includes("--dry-run");
const distArgument = process.argv.slice(2).find((value) => value !== "--dry-run");
const distRoot = path.resolve(distArgument || path.join(projectRoot, "web", "dist"));
const assetsRoot = path.join(distRoot, "assets");
const concurrency = 8;

async function main() {
  const collectedFiles = await collectFiles(assetsRoot);
  const selection = await selectCurrentBuildFiles(distRoot, collectedFiles);
  const files = selection.files;
  const publicFiles = (await collectFiles(distRoot)).filter((file) => isPublicCdnAsset(file.relativePath));
  const uploadFiles = [...files, ...publicFiles];
  const totalBytes = uploadFiles.reduce((sum, item) => sum + item.size, 0);
  if (dryRun) {
    console.log(`[static-object] dry-run: ${files.length} build assets + ${publicFiles.length} public assets, ${formatBytes(totalBytes)}, selection=${selection.source}`);
    return;
  }
  if (!uploadFiles.length) {
    console.warn(`[static-object] no files found in ${distRoot}; keeping local static delivery`);
    return;
  }

  const [{ loadStorageConfig, getMediaStorageRuntimeConfig }, cos, oss, { prisma }, manifest] = await Promise.all([
    import("../services/storageConfig"),
    import("../services/tencentCos"),
    import("../services/aliyunOss"),
    import("../prisma"),
    import("../services/webStaticCos"),
  ]);

  try {
    await loadStorageConfig();
    const runtime = await getMediaStorageRuntimeConfig();
    const backend = runtime.effectiveImageProvider;
    if (backend !== "cos" && backend !== "oss") {
      console.warn(`[static-object] image backend is ${backend}; keeping local static delivery`);
      return;
    }
    const storage = backend === "oss"
      ? {
          isConfigured: oss.isAliyunOssConfigured,
          listFiles: oss.listAliyunOssFiles,
          uploadFile: oss.uploadAliyunOssFile,
          headFile: oss.headAliyunOssFile,
          resolveDeliveryUrl: oss.resolveAliyunOssDeliveryUrl,
        }
      : {
          isConfigured: cos.isTencentCosConfigured,
          listFiles: cos.listTencentCosFiles,
          uploadFile: cos.uploadTencentCosFile,
          headFile: cos.headTencentCosFile,
          resolveDeliveryUrl: cos.resolveTencentCosDeliveryUrl,
        };
    if (!(await storage.isConfigured())) {
      console.warn(`[static-${backend}] backend is not configured; keeping local static delivery`);
      return;
    }

    const remoteFiles = new Map(
      (await storage.listFiles())
        .filter((item) => item.relativePath.startsWith(`${manifest.WEB_STATIC_COS_PREFIX}/`))
        .map((item) => [item.relativePath, item]),
    );
    const pending = uploadFiles.filter((file) => {
      const remotePath = `${manifest.WEB_STATIC_COS_PREFIX}/${file.relativePath}`;
      return remoteFiles.get(remotePath)?.size !== file.size;
    });

    let uploaded = 0;
    const failures: Array<{ relativePath: string; message: string }> = [];
    await runInBatches(pending, concurrency, async (file) => {
      const remotePath = `${manifest.WEB_STATIC_COS_PREFIX}/${file.relativePath}`;
      try {
        const buffer = await readFile(file.absolutePath);
        await storage.uploadFile(remotePath, buffer, contentTypeFor(file.relativePath));
        const verified = await storage.headFile(remotePath);
        if (!verified.exists || verified.size !== file.size) throw new Error("上传后大小校验失败");
        uploaded += 1;
      } catch (error) {
        failures.push({
          relativePath: file.relativePath,
          message: String(error instanceof Error ? error.message : error || "上传失败").slice(0, 300),
        });
      }
    });

    if (failures.length) {
      console.warn(`[static-${backend}] ${failures.length} files failed; keeping the previous manifest and local fallback`);
      for (const failure of failures.slice(0, 10)) {
        console.warn(`[static-${backend}] ${failure.relativePath}: ${failure.message}`);
      }
      process.exitCode = 2;
      return;
    }

    const remoteAssetBaseUrl = await storage.resolveDeliveryUrl(manifest.WEB_STATIC_COS_PREFIX);
    await rewriteIndexHtml(distRoot, remoteAssetBaseUrl, manifest.rewriteWebStaticAssetUrls);
    await writeManifest(distRoot, manifest.WEB_STATIC_COS_MANIFEST, {
      version: 2,
      generatedAt: new Date().toISOString(),
      remotePrefix: manifest.WEB_STATIC_COS_PREFIX,
      backend,
      assets: files.map((file) => file.relativePath).sort((a, b) => a.localeCompare(b, "en")),
      publicAssets: publicFiles.map((file) => file.relativePath).sort((a, b) => a.localeCompare(b, "en")),
    });
    console.log(`[static-${backend}] ready: ${uploadFiles.length} files (${formatBytes(totalBytes)}), uploaded=${uploaded}, reused=${uploadFiles.length - uploaded}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function rewriteIndexHtml(root: string, remoteAssetBaseUrl: string, rewrite: (html: string, baseUrl: string) => string) {
  const target = path.join(root, "index.html");
  const current = await readFile(target, "utf8");
  const rewritten = rewrite(current, remoteAssetBaseUrl);
  if (rewritten === current) return;
  await writeTextAtomically(target, rewritten);
}

type CollectedFile = { absolutePath: string; relativePath: string; size: number };

async function selectCurrentBuildFiles(root: string, files: CollectedFile[]) {
  const viteManifestPath = path.join(root, ".vite", "manifest.json");
  try {
    const parsed = JSON.parse(await readFile(viteManifestPath, "utf8")) as Record<string, {
      file?: unknown;
      css?: unknown;
      assets?: unknown;
    }>;
    const selectedPaths = new Set<string>();
    for (const entry of Object.values(parsed || {})) {
      const candidates = [
        entry?.file,
        ...(Array.isArray(entry?.css) ? entry.css : []),
        ...(Array.isArray(entry?.assets) ? entry.assets : []),
      ];
      for (const candidate of candidates) {
        const normalized = String(candidate || "").replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
        if (normalized.startsWith("assets/")) selectedPaths.add(normalized.slice("assets/".length));
      }
    }
    if (!selectedPaths.size) throw new Error("Vite manifest does not contain assets");
    const selectedFiles = files.filter((file) => selectedPaths.has(file.relativePath));
    if (selectedFiles.length !== selectedPaths.size) {
      throw new Error(`Vite manifest references ${selectedPaths.size - selectedFiles.length} missing assets`);
    }
    return { files: selectedFiles, source: "vite-manifest" as const };
  } catch (error) {
    console.warn(`[static-object] current Vite manifest unavailable (${String(error instanceof Error ? error.message : error)}); scanning all hashed assets`);
    return { files, source: "asset-directory" as const };
  }
}

async function collectFiles(root: string) {
  const results: CollectedFile[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    const entries = await readdir(current, { withFileTypes: true }).catch((error: any) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const file = await stat(absolutePath);
      results.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
        size: file.size,
      });
    }
  }
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
}

async function runInBatches<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += limit) {
    await Promise.all(items.slice(index, index + limit).map(worker));
  }
}

async function writeManifest(root: string, fileName: string, value: unknown) {
  await mkdir(root, { recursive: true });
  const target = path.join(root, fileName);
  await writeTextAtomically(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomically(target: string, content: string) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

function contentTypeFor(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  return ({
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".apk": "application/vnd.android.package-archive",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function isPublicCdnAsset(relativePath: string) {
  const normalized = relativePath.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (!normalized || normalized.startsWith("assets/") || normalized.startsWith(".vite/")) return false;
  if (normalized.startsWith("splash/")) return /^splash\/ios-launch-v6-\d+x\d+\.png$/u.test(normalized);
  if (/^(?:brand|downloads)\//u.test(normalized)) return /\.(?:apk|avif|gif|jpe?g|png|svg|webp)$/iu.test(normalized);
  return /^(?:apple-touch-icon-v\d+|icon-(?:192|512)-v\d+|icon-huawei-standard-\d+|image-placeholder|wechat-service-qrcode)\.(?:png|svg)$/iu.test(normalized);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((error) => {
  console.error(`[static-object] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
