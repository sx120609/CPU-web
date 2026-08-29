import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
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
