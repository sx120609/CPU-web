import assert from "node:assert/strict";
import test from "node:test";
import { layoutTopicCard } from "../src/routes/share";

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
