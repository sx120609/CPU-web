import { loadStorageConfig } from "../services/storageConfig";
import { prisma } from "../prisma";
import {
  downloadTencentCosFileBuffer,
  isTencentCosConfigured,
  listTencentCosFiles,
} from "../services/tencentCos";
import {
  isAliyunOssConfigured,
  headAliyunOssFile,
  listAliyunOssFiles,
  uploadAliyunOssFile,
} from "../services/aliyunOss";
import { runCosToOssMirror } from "../services/cosToOssMirror";

const concurrency = 4;
const dryRun = process.argv.includes("--dry-run");
const limit = readLimit(process.argv.find((value) => value.startsWith("--limit="))?.split("=", 2)[1]);

async function main() {
  await loadStorageConfig();
  const [sourceConfigured, destinationConfigured] = await Promise.all([
    isTencentCosConfigured(),
    isAliyunOssConfigured(),
  ]);
  if (!sourceConfigured || !destinationConfigured) {
    console.log(`[copy-cos-to-oss] skipped: COS=${sourceConfigured ? "configured" : "missing"}, OSS=${destinationConfigured ? "configured" : "missing"}`);
    return;
  }

  const summary = await runCosToOssMirror({
    listSourceFiles: listTencentCosFiles,
    listDestinationFiles: listAliyunOssFiles,
    downloadSourceFile: downloadTencentCosFileBuffer,
    uploadDestinationFile: uploadAliyunOssFile,
    headDestinationFile: headAliyunOssFile,
  }, { concurrency, dryRun, limit });

  console.log(`[copy-cos-to-oss] source=${summary.sourceCount}, destination=${summary.destinationCount}, pending=${summary.pendingCount}, selected=${summary.selectedCount}, copied=${summary.copiedCount}, reused=${summary.reusedCount}, conflicts=${summary.conflicts.length}, failed=${summary.failures.length}, bytes=${summary.copiedBytes}, dryRun=${summary.dryRun}`);
  for (const conflict of summary.conflicts.slice(0, 20)) {
    console.warn(`[copy-cos-to-oss] conflict ${conflict.source.relativePath}: ${conflict.reason}; destination retained`);
  }
  for (const failure of summary.failures.slice(0, 20)) {
    console.warn(`[copy-cos-to-oss] ${failure.relativePath}: ${failure.message}`);
  }
  if (summary.failures.length) process.exitCode = 2;
}

function readLimit(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error("--limit 必须是正整数");
  return Math.floor(parsed);
}

main()
  .catch((error) => {
    console.error(`[copy-cos-to-oss] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
