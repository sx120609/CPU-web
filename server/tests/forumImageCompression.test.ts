import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { buildOptimizedForumImagePath, replaceForumImageReference } from "../src/services/forumImageArchive";
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
  assert.equal(upload.mimeType, "image/jpeg");
  assert.equal(upload.extension, "jpg");
  assert.equal(upload.transcoded, true);
  assert.ok(upload.buffer.length <= FORUM_IMAGE_UPLOAD_MAX_BYTES);
  assert.ok(Math.max(uploadMetadata.width || 0, uploadMetadata.height || 0) <= 1400);

  const review = await prepareForumImageForReview({
    buffer: source,
    mimeType: "image/png",
    fileName: "legacy-large-photo.png",
  });
  const reviewMetadata = await sharp(review.buffer).metadata();
  assert.equal(review.mimeType, "image/jpeg");
  assert.equal(review.transcoded, true);
  assert.ok(review.buffer.length <= FORUM_IMAGE_REVIEW_MAX_BYTES);
  assert.ok(Math.max(reviewMetadata.width || 0, reviewMetadata.height || 0) <= 2048);
});

test("does not recompress an already bounded forum JPEG", async () => {
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

  assert.equal(upload.transcoded, false);
  assert.equal(upload.buffer, source);
  assert.equal(review.transcoded, false);
  assert.equal(review.buffer, source);
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
  assert.match(path, /^forum\/optimized\/[0-9a-f]{2}\/[0-9a-f]{24}\.jpg$/u);
  assert.equal(buildOptimizedForumImagePath(buffer), path);

  const oldUrl = "/uploads/forum/2026-08/large.jpg";
  const newUrl = "/uploads/forum/optimized/ab/small.jpg";
  assert.equal(
    replaceForumImageReference(`<img src="https://cputime.cn${oldUrl}"><img src="${oldUrl}">`, oldUrl, newUrl),
    `<img src="https://cputime.cn${newUrl}"><img src="${newUrl}">`,
  );
});
