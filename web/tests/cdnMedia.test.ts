import assert from "node:assert/strict";
import test from "node:test";
import { cdnImageUrl, directMediaUrl } from "../src/utils/cdnMedia";

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
