import assert from "node:assert/strict";
import test from "node:test";
import { layoutTopicCard, parseShareTopicId, renderSvgToPng } from "../src/routes/share";

test("a short title without body text gives a short card", () => {
  const short = layoutTopicCard({ title: "二食堂二楼新开的砂锅窗口测评", content: "" });
  const long = layoutTopicCard({
    title: "图书馆四楼靠窗的插座终于修好了，顺便整理一下各楼层自习区现在的情况和注意事项",
    content: "今天下午去看了一下，靠窗那排六个座位的插座都能用了。".repeat(8),
  });
  assert.equal(short.excerptLines.length, 0);
  assert.equal(long.titleLines.length, 3);
  assert.ok(short.height < long.height);
  assert.equal(long.titleLines.length + long.excerptLines.length, 7);
});

test("only text that did not fit ends in an ellipsis", () => {
  const fits = layoutTopicCard({ title: "CET-6 2026 December registration opens next Monday", content: "" });
  assert.deepEqual(fits.titleLines, ["CET-6 2026 December", "registration opens", "next Monday"]);
  const cut = layoutTopicCard({ title: "很长的标题".repeat(12), content: "" });
  assert.equal(cut.titleLines.length, 3);
  assert.ok(cut.titleLines[2].endsWith("…"));
  assert.ok(!cut.titleLines[0].endsWith("…"));
});

test("markup is stripped from the body text", () => {
  const card = layoutTopicCard({ title: "标题", content: "# 小标题\n\n**加粗** 和 [链接](https://example.com) ![图](https://example.com/a.png)" });
  assert.deepEqual(card.excerptLines, ["小标题 加粗 和 链接"]);
});

test("share ids accept only positive database integers", () => {
  assert.equal(parseShareTopicId("28036"), 28036);
  assert.equal(parseShareTopicId("028036"), 28036);
  assert.equal(parseShareTopicId("2147483647"), 2147483647);
  for (const bad of ["0", "-1", "1e3", "0x10", " 12", "12.0", "2147483648", "99999999999", ""]) {
    assert.equal(parseShareTopicId(bad), null, bad);
  }
});

test("cards are rasterized off the event loop into a PNG", async () => {
  const png = await renderSvgToPng('<svg width="40" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="20" fill="#086f63"/></svg>');
  assert.deepEqual([...png.subarray(1, 4)].map((byte) => String.fromCharCode(byte)).join(""), "PNG");
  assert.equal(png.readUInt32BE(16), 720);
});
