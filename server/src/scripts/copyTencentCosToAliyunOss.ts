import { loadStorageConfig } from "../services/storageConfig";
import { prisma } from "../prisma";
import {
  downloadTencentCosFileBuffer,
  isTencentCosConfigured,
  listTencentCosFiles,
} from "../services/tencentCos";
import {
  headAliyunOssFile,
  isAliyunOssConfigured,
  listAliyunOssFiles,
  uploadAliyunOssFile,
} from "../services/aliyunOss";

const concurrency = 4;
const dryRun = process.argv.includes("--dry-run");
const limit = readLimit(process.argv.find((value) => value.startsWith("--limit="))?.split("=", 2)[1]);

async function main() {
  await loadStorageConfig();
  if (!(await isTencentCosConfigured())) throw new Error("腾讯云 COS 尚未配置");
  if (!(await isAliyunOssConfigured())) throw new Error("阿里云 OSS 尚未配置");

  const [sourceFiles, destinationFiles] = await Promise.all([
    listTencentCosFiles(),
    listAliyunOssFiles(),
  ]);
  const destinationByPath = new Map(destinationFiles.map((file) => [file.relativePath, file]));
  const pending = sourceFiles.filter((file) => destinationByPath.get(file.relativePath)?.size !== file.size);
  const selected = Number.isFinite(limit) ? pending.slice(0, limit) : pending;
  if (dryRun) {
    console.log(`[copy-cos-to-oss] source=${sourceFiles.length}, destination=${destinationFiles.length}, pending=${pending.length}, selected=${selected.length}`);
    return;
  }

  let copied = 0;
  let bytes = 0;
  const failures: Array<{ relativePath: string; message: string }> = [];
  await runInBatches(selected, concurrency, async (file) => {
    try {
      const buffer = await downloadTencentCosFileBuffer(file.relativePath);
      if (file.size !== null && buffer.length !== file.size) throw new Error("从 COS 下载后的文件大小不一致");
      await uploadAliyunOssFile(file.relativePath, buffer, contentTypeFor(file.relativePath));
      const verified = await headAliyunOssFile(file.relativePath);
      if (!verified.exists || verified.size !== buffer.length) throw new Error("上传 OSS 后的文件大小校验失败");
      copied += 1;
      bytes += buffer.length;
    } catch (error) {
      failures.push({
        relativePath: file.relativePath,
        message: String(error instanceof Error ? error.message : error || "复制失败").slice(0, 300),
      });
    }
  });

  console.log(`[copy-cos-to-oss] copied=${copied}, reused=${sourceFiles.length - pending.length}, failed=${failures.length}, bytes=${bytes}`);
  for (const failure of failures.slice(0, 20)) {
    console.warn(`[copy-cos-to-oss] ${failure.relativePath}: ${failure.message}`);
  }
  if (failures.length) process.exitCode = 2;
}

async function runInBatches<T>(items: T[], batchSize: number, worker: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(worker));
  }
}

function readLimit(value: string | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("--limit 必须是正整数");
  return Math.floor(parsed);
}

function contentTypeFor(relativePath: string) {
  const extension = relativePath.split(".").at(-1)?.toLowerCase() || "";
  return ({
    avif: "image/avif",
    css: "text/css; charset=utf-8",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "application/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    m4v: "video/x-m4v",
    mjs: "application/javascript; charset=utf-8",
    mov: "video/quicktime",
    mp4: "video/mp4",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    webm: "video/webm",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

main()
  .catch((error) => {
    console.error(`[copy-cos-to-oss] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
