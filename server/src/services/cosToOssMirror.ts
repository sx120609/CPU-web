import { createHash } from "node:crypto";

export type StorageMirrorFile = {
  relativePath: string;
  size: number | null;
  etag?: string;
};

export type StorageMirrorHead = {
  exists: boolean;
  size: number | null;
  etag?: string;
};

export type CosToOssMirrorDependencies = {
  listSourceFiles: () => Promise<StorageMirrorFile[]>;
  listDestinationFiles: () => Promise<StorageMirrorFile[]>;
  downloadSourceFile: (relativePath: string) => Promise<Buffer>;
  uploadDestinationFile: (
    relativePath: string,
    buffer: Buffer,
    contentType: string,
    options: { forbidOverwrite: true },
  ) => Promise<unknown>;
  headDestinationFile: (relativePath: string) => Promise<StorageMirrorHead>;
};

export type CosToOssMirrorPlan = {
  pending: StorageMirrorFile[];
  reused: StorageMirrorFile[];
  conflicts: Array<{
    source: StorageMirrorFile;
    destination: StorageMirrorFile;
    reason: "size" | "etag";
  }>;
};

export type CosToOssMirrorFailure = {
  relativePath: string;
  message: string;
};

export type CosToOssMirrorSummary = {
  sourceCount: number;
  destinationCount: number;
  pendingCount: number;
  selectedCount: number;
  reusedCount: number;
  conflicts: CosToOssMirrorPlan["conflicts"];
  copiedCount: number;
  copiedBytes: number;
  failures: CosToOssMirrorFailure[];
  dryRun: boolean;
};

export function planCosToOssMirror(
  sourceFiles: StorageMirrorFile[],
  destinationFiles: StorageMirrorFile[],
): CosToOssMirrorPlan {
  const destinationByPath = new Map(destinationFiles.map((file) => [file.relativePath, file]));
  const pending: StorageMirrorFile[] = [];
  const reused: StorageMirrorFile[] = [];
  const conflicts: CosToOssMirrorPlan["conflicts"] = [];

  for (const source of [...sourceFiles].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    const destination = destinationByPath.get(source.relativePath);
    if (!destination) {
      pending.push(source);
      continue;
    }
    if (source.size !== null && destination.size !== null && source.size !== destination.size) {
      conflicts.push({ source, destination, reason: "size" });
      continue;
    }
    const sourceMd5 = simpleMd5Etag(source.etag);
    const destinationMd5 = simpleMd5Etag(destination.etag);
    if (sourceMd5 && destinationMd5 && sourceMd5 !== destinationMd5) {
      conflicts.push({ source, destination, reason: "etag" });
      continue;
    }
    reused.push(source);
  }

  return { pending, reused, conflicts };
}

export async function runCosToOssMirror(
  dependencies: CosToOssMirrorDependencies,
  options: { dryRun?: boolean; limit?: number; concurrency?: number } = {},
): Promise<CosToOssMirrorSummary> {
  const [sourceFiles, destinationFiles] = await Promise.all([
    dependencies.listSourceFiles(),
    dependencies.listDestinationFiles(),
  ]);
  const plan = planCosToOssMirror(sourceFiles, destinationFiles);
  const limit = normalizePositiveInteger(options.limit, Number.POSITIVE_INFINITY);
  const concurrency = normalizePositiveInteger(options.concurrency, 4);
  const selected = Number.isFinite(limit) ? plan.pending.slice(0, limit) : plan.pending;
  const failures: CosToOssMirrorFailure[] = [];
  let copiedCount = 0;
  let copiedBytes = 0;

  if (!options.dryRun) {
    await runInBatches(selected, concurrency, async (file) => {
      try {
        const buffer = await dependencies.downloadSourceFile(file.relativePath);
        if (file.size !== null && buffer.length !== file.size) {
          throw new Error("从 COS 下载后的文件大小不一致");
        }
        const bufferMd5 = createHash("md5").update(buffer).digest("hex");
        const sourceMd5 = simpleMd5Etag(file.etag);
        if (sourceMd5 && sourceMd5 !== bufferMd5) {
          throw new Error("从 COS 下载后的文件哈希不一致");
        }
        await dependencies.uploadDestinationFile(
          file.relativePath,
          buffer,
          contentTypeFor(file.relativePath),
          { forbidOverwrite: true },
        );
        const verified = await dependencies.headDestinationFile(file.relativePath);
        if (!verified.exists || verified.size !== buffer.length) {
          throw new Error("上传 OSS 后的文件大小校验失败");
        }
        const destinationMd5 = simpleMd5Etag(verified.etag);
        if (destinationMd5 && destinationMd5 !== bufferMd5) {
          throw new Error("上传 OSS 后的文件哈希校验失败");
        }
        copiedCount += 1;
        copiedBytes += buffer.length;
      } catch (error) {
        failures.push({
          relativePath: file.relativePath,
          message: String(error instanceof Error ? error.message : error || "复制失败").slice(0, 300),
        });
      }
    });
  }

  return {
    sourceCount: sourceFiles.length,
    destinationCount: destinationFiles.length,
    pendingCount: plan.pending.length,
    selectedCount: selected.length,
    reusedCount: plan.reused.length,
    conflicts: plan.conflicts,
    copiedCount,
    copiedBytes,
    failures,
    dryRun: Boolean(options.dryRun),
  };
}

export function contentTypeFor(relativePath: string) {
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

function simpleMd5Etag(value: string | undefined) {
  const normalized = String(value || "").trim().replace(/^"|"$/gu, "").toLowerCase();
  return /^[a-f0-9]{32}$/u.test(normalized) ? normalized : "";
}

async function runInBatches<T>(items: T[], batchSize: number, worker: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(worker));
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) throw new Error("镜像数量参数必须是正整数");
  return Math.floor(value);
}
