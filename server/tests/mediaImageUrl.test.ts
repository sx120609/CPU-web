import assert from "node:assert/strict";
import test from "node:test";
import { mediaImageDeliveryUrl } from "../src/utils/mediaImageUrl";

test("thumbnails retain the configured storage host and use its processing syntax", () => {
  const cos = mediaImageDeliveryUrl("https://img.cputime.cn/media/forum/a.jpg", "cos", "forum/a.jpg", {image_width:"640",image_quality:"82"});
  assert.equal(new URL(cos).hostname,"img.cputime.cn");
  assert.match(cos,/imageMogr2\/auto-orient\/thumbnail\/640x\/quality\/82\/format\/webp/);
  const oss = new URL(mediaImageDeliveryUrl("https://static.cputime.cn/media/forum/a.jpg", "oss", "forum/a.jpg", {image_width:"640",image_quality:"82"}));
  assert.equal(oss.searchParams.get("x-oss-process"), "image/auto-orient,1/resize,w_640/quality,q_82/format,webp");
});

test("thumbnail input is bounded and original GIFs and downloads are preserved", () => {
  const source = "https://img.cputime.cn/a.jpg";
  assert.equal(mediaImageDeliveryUrl(source,"cos","a.jpg",{image_width:"invalid"}),source);
  assert.equal(mediaImageDeliveryUrl(source,"cos","a.gif",{image_width:"640"}),source);
  assert.equal(mediaImageDeliveryUrl(source,"cos","a.mp4",{image_width:"640"}),source);
  assert.match(mediaImageDeliveryUrl(source,"cos","a.jpg",{image_width:"90000",image_quality:"-1"}),/2048x\/quality\/55/);
});
