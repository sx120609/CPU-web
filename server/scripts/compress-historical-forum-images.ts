import { readFile, rm, stat } from "node:fs/promises";
import { prisma } from "../src/prisma";
import { FORUM_IMAGE_ARCHIVE_MIN_BYTES, buildOptimizedForumImagePath, replaceForumImageReference } from "../src/services/forumImageArchive";
import { normalizeForumImageUpload } from "../src/services/forumImageCompression";
import { prepareMediaLocalFileForProcessing, saveMediaAsset } from "../src/services/mediaStorage";
import { loadStorageConfig } from "../src/services/storageConfig";

const apply = process.argv.includes("--apply");
const limit = readNumberArg("--limit", 500, 1, 5000);
const minBytes = Math.round(readNumberArg("--min-mb", FORUM_IMAGE_ARCHIVE_MIN_BYTES / 1024 / 1024, .5, 64) * 1024 * 1024);

async function main() {
  await loadStorageConfig();
  const assets = await prisma.forumImageAsset.findMany({
    where: {
      url: { startsWith: "/uploads/forum/" },
      OR: [{ fileSize: null }, { fileSize: { gte: minBytes } }],
    },
    orderBy: [{ id: "asc" }],
    take: limit,
  });
  const result = {
    mode: apply ? "apply" : "dry-run",
    scanned: assets.length,
    eligible: 0,
    compressed: 0,
    sourceBytes: 0,
    outputBytes: 0,
    skipped: 0,
    failed: 0,
    items: [] as Array<Record<string, unknown>>,
  };

  for (const asset of assets) {
    const prepared = await prepareMediaLocalFileForProcessing(asset.url);
    try {
      if (!prepared.localPath) {
        result.failed += 1;
        result.items.push({ id: asset.id, url: asset.url, status: "failed", message: "文件不可用" });
        continue;
      }
      const sourceStat = await stat(prepared.localPath);
      if (sourceStat.size < minBytes) {
        result.skipped += 1;
        continue;
      }
      result.eligible += 1;
      const source = await readFile(prepared.localPath);
      const normalized = await normalizeForumImageUpload({
        buffer: source,
        mimeType: asset.mimeType,
        fileName: asset.url,
      });
      if (!normalized.transcoded || normalized.buffer.length >= source.length) {
        result.skipped += 1;
        result.items.push({ id: asset.id, url: asset.url, status: "skipped", message: "无法在保留图片内容的前提下缩小" });
        continue;
      }
      result.sourceBytes += source.length;
      result.outputBytes += normalized.buffer.length;
      const relativePath = buildOptimizedForumImagePath(normalized.buffer);
      const newUrl = `/uploads/${relativePath}`;
      if (apply) {
        const saved = await saveMediaAsset({
          relativePath,
          buffer: normalized.buffer,
          contentType: normalized.mimeType,
          mediaKind: "image",
        });
        await replaceReferences(asset.id, asset.url, newUrl, saved.localPath, normalized.buffer.length);
      }
      result.compressed += 1;
      result.items.push({
        id: asset.id,
        oldUrl: asset.url,
        newUrl,
        status: apply ? "compressed" : "eligible",
        sourceBytes: source.length,
        outputBytes: normalized.buffer.length,
      });
    } catch (error) {
      result.failed += 1;
      result.items.push({ id: asset.id, url: asset.url, status: "failed", message: String((error as Error)?.message || error) });
    } finally {
      if (prepared.temporary && prepared.localPath) await rm(prepared.localPath, { force: true }).catch(() => undefined);
    }
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function replaceReferences(assetId: number, oldUrl: string, newUrl: string, localPath: string, fileSize: number) {
  const [topics, replies, marketImages, lostFoundImages] = await Promise.all([
    prisma.topic.findMany({
      where: { OR: [{ content: { contains: oldUrl } }, { metadata: { contains: oldUrl } }] },
      select: { id: true, content: true, metadata: true },
    }),
    prisma.reply.findMany({ where: { content: { contains: oldUrl } }, select: { id: true, content: true } }),
    prisma.marketImage.findMany({ where: { url: { contains: oldUrl } }, select: { id: true, url: true } }),
    prisma.lostFoundImage.findMany({ where: { url: { contains: oldUrl } }, select: { id: true, url: true } }),
  ]);

  await prisma.$transaction(async (tx) => {
    for (const topic of topics) {
      await tx.topic.update({
        where: { id: topic.id },
        data: {
          content: replaceForumImageReference(topic.content, oldUrl, newUrl),
          metadata: replaceForumImageReference(topic.metadata, oldUrl, newUrl),
        },
      });
    }
    for (const reply of replies) {
      await tx.reply.update({
        where: { id: reply.id },
        data: { content: replaceForumImageReference(reply.content, oldUrl, newUrl) },
      });
    }
    for (const image of marketImages) {
      await tx.marketImage.update({
        where: { id: image.id },
        data: { url: replaceForumImageReference(image.url, oldUrl, newUrl) },
      });
    }
    for (const image of lostFoundImages) {
      await tx.lostFoundImage.update({
        where: { id: image.id },
        data: { url: replaceForumImageReference(image.url, oldUrl, newUrl) },
      });
    }
    await tx.forumImageAsset.update({
      where: { id: assetId },
      data: { url: newUrl, localPath, mimeType: "image/jpeg", fileSize },
    });
  });
}

function readNumberArg(name: string, fallback: number, min: number, max: number) {
  const raw = process.argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

main()
  .catch((error) => {
    process.stderr.write(`${String((error as Error)?.stack || error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
