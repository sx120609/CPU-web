import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { buildOptimizedForumImagePath, replaceForumImageReference } from "../src/services/forumImageArchive";
import { renderModeratedContents } from "../src/services/imageModeration";
import {
  FORUM_IMAGE_REVIEW_MAX_BYTES,
  FORUM_IMAGE_UPLOAD_MAX_BYTES,
  normalizeForumImageUpload,
  prepareForumImageForReview,
} from "../src/services/forumImageCompression";

test("compresses a large forum photo before upload and AI review", async () => {
  const width = 3000;
  const height = 2200;
  const source = await sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(source.length > 6 * 1024 * 1024);

  const upload = await normalizeForumImageUpload({
    buffer: source,
    mimeType: "image/png",
    fileName: "phone-photo.png",
  });
  const uploadMetadata = await sharp(upload.buffer).metadata();
  assert.equal(upload.mimeType, "image/webp");
  assert.equal(upload.extension, "webp");
  assert.equal(upload.transcoded, true);
  assert.ok(upload.buffer.length <= FORUM_IMAGE_UPLOAD_MAX_BYTES);
  assert.ok(Math.max(uploadMetadata.width || 0, uploadMetadata.height || 0) <= 1400);

  const review = await prepareForumImageForReview({
    buffer: source,
    mimeType: "image/png",
    fileName: "legacy-large-photo.png",
  });
  const reviewMetadata = await sharp(review.buffer).metadata();
  assert.equal(review.mimeType, "image/webp");
  assert.equal(review.transcoded, true);
  assert.ok(review.buffer.length <= FORUM_IMAGE_REVIEW_MAX_BYTES);
  assert.ok(Math.max(reviewMetadata.width || 0, reviewMetadata.height || 0) <= 2048);
});

test("stores a bounded JPEG as WebP and keeps an already bounded WebP", async () => {
  const source = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: "#6f8f82",
    },
  }).jpeg({ quality: 80 }).toBuffer();

  const upload = await normalizeForumImageUpload({
    buffer: source,
    mimeType: "image/jpeg",
    fileName: "small.jpg",
  });
  const review = await prepareForumImageForReview({
    buffer: source,
    mimeType: "image/jpeg",
    fileName: "small.jpg",
  });

  assert.equal(upload.mimeType, "image/webp");
  assert.equal(upload.extension, "webp");
  assert.equal(upload.transcoded, true);
  assert.equal(review.transcoded, false);
  assert.equal(review.buffer, source);

  const boundedWebp = await normalizeForumImageUpload({
    buffer: upload.buffer,
    mimeType: "image/webp",
    fileName: "small.webp",
  });
  assert.equal(boundedWebp.transcoded, false);
  assert.equal(boundedWebp.buffer, upload.buffer);
});

test("uses decoded bytes instead of trusting a misleading image filename", async () => {
  await assert.rejects(
    () => normalizeForumImageUpload({
      buffer: Buffer.from("not really an image"),
      mimeType: "application/octet-stream",
      fileName: "fake.jpg",
    }),
    /图片内容无法读取/u,
  );
  await assert.rejects(
    () => prepareForumImageForReview({
      buffer: Buffer.from("not really an image"),
      mimeType: "image/jpeg",
      fileName: "fake.jpg",
    }),
    /图片内容无法读取/u,
  );
});

test("keeps an animated image above the preferred upload budget instead of breaking the animation", async () => {
  const source = await sharp({
    create: {
      width: 1200,
      height: 1200,
      channels: 4,
      background: "#168776",
    },
  }).gif().toBuffer();
  const oversized = Buffer.concat([source, Buffer.alloc(600 * 1024)]);
  const upload = await normalizeForumImageUpload({ buffer: oversized, mimeType: "image/gif", fileName: "animated.gif" });
  assert.equal(upload.mimeType, "image/gif");
  assert.equal(upload.transcoded, false);
  assert.equal(upload.buffer, oversized);
});

test("builds deterministic optimized paths and rewrites relative or absolute forum image references", () => {
  const buffer = Buffer.from("optimized-image");
  const path = buildOptimizedForumImagePath(buffer);
  assert.match(path, /^forum\/optimized\/[0-9a-f]{2}\/[0-9a-f]{24}\.webp$/u);
  assert.equal(buildOptimizedForumImagePath(buffer), path);

  const oldUrl = "/uploads/forum/2026-08/large.jpg";
  const newUrl = "/uploads/forum/optimized/ab/small.jpg";
  assert.equal(
    replaceForumImageReference(`<img src="https://cputime.cn${oldUrl}"><img src="${oldUrl}">`, oldUrl, newUrl),
    `<img src="https://cputime.cn${newUrl}"><img src="${newUrl}">`,
  );
});

test("returns resolved strings when batch-rendering text-only forum topics", async () => {
  const rendered = await renderModeratedContents(["纯文本动态", "另一条动态"]);
  assert.deepEqual(rendered, ["纯文本动态", "另一条动态"]);
  assert.ok(rendered.every((content) => typeof content === "string"));
});
