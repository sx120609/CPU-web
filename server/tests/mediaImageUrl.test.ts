import assert from "node:assert/strict";
import test from "node:test";
import { mediaImageDeliveryUrl } from "../src/utils/mediaImageUrl";

test("thumbnails retain the configured storage host and use its processing syntax", () => {
  const cos = mediaImageDeliveryUrl("https://img.cputime.cn/media/forum/a.jpg", "cos", "forum/a.jpg", {image_width:"640",image_quality:"80"});
  assert.equal(new URL(cos).hostname,"img.cputime.cn");
  assert.match(cos,/imageMogr2\/auto-orient\/thumbnail\/640x\/quality\/80\/format\/webp/);
  const oss = new URL(mediaImageDeliveryUrl("https://static.cputime.cn/media/forum/a.jpg", "oss", "forum/a.jpg", {image_width:"640",image_quality:"80"}));
  assert.equal(oss.searchParams.get("x-oss-process"), "image/auto-orient,1/resize,w_640/quality,q_80/format,webp");
});

test("thumbnail input is bounded and original GIFs and downloads are preserved", () => {
  const source = "https://img.cputime.cn/a.jpg";
  assert.equal(mediaImageDeliveryUrl(source,"cos","a.jpg",{image_width:"invalid"}),source);
  assert.equal(mediaImageDeliveryUrl(source,"cos","a.gif",{image_width:"640"}),source);
  assert.equal(mediaImageDeliveryUrl(source,"cos","a.mp4",{image_width:"640"}),source);
  assert.match(mediaImageDeliveryUrl(source,"cos","a.jpg",{image_width:"90000",image_quality:"-1"}),/2048x\/quality\/55/);
});

test("arbitrary widths and qualities collapse into a small set of variants", () => {
  const source = "https://img.cputime.cn/a.jpg";
  const variants = new Set<string>();
  for (let width = 1; width <= 4096; width += 7) {
    for (let quality = 40; quality <= 100; quality += 3) {
      variants.add(mediaImageDeliveryUrl(source, "cos", "a.jpg", { image_width: String(width), image_quality: String(quality) }));
    }
  }
  assert.ok(variants.size <= 16 * 8, `${variants.size} variants`);
  assert.match(mediaImageDeliveryUrl(source, "cos", "a.jpg", { image_width: "641", image_quality: "82" }), /thumbnail\/768x\/quality\/80\//);
  assert.match(mediaImageDeliveryUrl(source, "cos", "a.jpg", { image_width: "90000", image_quality: "99" }), /2048x\/quality\/90\//);
});
