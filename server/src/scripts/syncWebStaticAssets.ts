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
  const files = await collectFiles(assetsRoot);
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
  if (dryRun) {
    console.log(`[static-cos] dry-run: ${files.length} files, ${formatBytes(totalBytes)}, source=${assetsRoot}`);
    return;
  }
  if (!files.length) {
    console.warn(`[static-cos] no files found in ${assetsRoot}; keeping local static delivery`);
    return;
  }

  const [{ loadStorageConfig }, cos, { prisma }, manifest] = await Promise.all([
    import("../services/storageConfig"),
    import("../services/tencentCos"),
    import("../prisma"),
    import("../services/webStaticCos"),
  ]);

  try {
    await loadStorageConfig();
    if (!(await cos.isTencentCosConfigured())) {
      console.warn("[static-cos] Tencent COS is not configured; keeping local static delivery");
      return;
    }

    const remoteFiles = new Map(
      (await cos.listTencentCosFiles())
        .filter((item) => item.relativePath.startsWith(`${manifest.WEB_STATIC_COS_PREFIX}/`))
        .map((item) => [item.relativePath, item]),
    );
    const pending = files.filter((file) => {
      const remotePath = `${manifest.WEB_STATIC_COS_PREFIX}/${file.relativePath}`;
      return remoteFiles.get(remotePath)?.size !== file.size;
    });

    let uploaded = 0;
    const failures: Array<{ relativePath: string; message: string }> = [];
    await runInBatches(pending, concurrency, async (file) => {
      const remotePath = `${manifest.WEB_STATIC_COS_PREFIX}/${file.relativePath}`;
      try {
        const buffer = await readFile(file.absolutePath);
        await cos.uploadTencentCosFile(remotePath, buffer, contentTypeFor(file.relativePath));
        const verified = await cos.headTencentCosFile(remotePath);
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
      console.warn(`[static-cos] ${failures.length} files failed; keeping the previous manifest and local fallback`);
      for (const failure of failures.slice(0, 10)) {
        console.warn(`[static-cos] ${failure.relativePath}: ${failure.message}`);
      }
      process.exitCode = 2;
      return;
    }

    await writeManifest(distRoot, manifest.WEB_STATIC_COS_MANIFEST, {
      version: 1,
      generatedAt: new Date().toISOString(),
      remotePrefix: manifest.WEB_STATIC_COS_PREFIX,
      assets: files.map((file) => file.relativePath).sort((a, b) => a.localeCompare(b, "en")),
    });
    console.log(`[static-cos] ready: ${files.length} files (${formatBytes(totalBytes)}), uploaded=${uploaded}, reused=${files.length - uploaded}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function collectFiles(root: string) {
  const results: Array<{ absolutePath: string; relativePath: string; size: number }> = [];
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
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((error) => {
  console.error(`[static-cos] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
