import assert from "node:assert/strict";
import test from "node:test";
import { cdnImageUrl, directMediaUrl, withMediaRevision } from "../src/utils/cdnMedia";

test("avatars use the server storage resolver instead of the static mirror", () => {
  const avatar = "/uploads/avatars/7/new-avatar.jpg";
  assert.equal(directMediaUrl(avatar), avatar);
  assert.equal(cdnImageUrl(avatar, { width: 240, quality: 84 }), avatar);
});

test("a newly saved avatar keeps its revision on the server storage URL", () => {
  const avatar = withMediaRevision("/uploads/avatars/7/new-avatar.jpg", 12345);
  assert.equal(
    cdnImageUrl(avatar, { width: 96 }),
    "/uploads/avatars/7/new-avatar.jpg?media_rev=12345",
  );
});

test("managed uploads resolve to the ESA static resource domain", () => {
  assert.equal(
    directMediaUrl("/uploads/forum/example image.png"),
    "https://static.cputime.cn/cpu-web-media/forum/example image.png",
  );
});

test("resizable images use OSS image processing parameters", () => {
  assert.equal(
    cdnImageUrl("/uploads/forum/example.png", { width: 640, quality: 82 }),
    "https://static.cputime.cn/cpu-web-media/forum/example.png?x-oss-process=image/auto-orient,1/resize,w_640/quality,q_82/format,webp",
  );
});
