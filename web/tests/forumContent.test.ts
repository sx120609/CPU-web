import assert from "node:assert/strict";
import test from "node:test";
import { forumContentExcerpt, forumContentImages } from "../src/utils/forumContent";

test("论坛摘要移除富文本标记并保留可读正文", () => {
  assert.equal(forumContentExcerpt("<p>校园 <b>动态</b></p><img src=\"/a.jpg\">", 20), "校园 动态");
  assert.equal(forumContentExcerpt("![照片](/a.jpg)", 20), "");
});

test("信息流预览只提取安全且不重复的图片地址", () => {
  assert.deepEqual(
    forumContentImages('<img src="/a.jpg"><img src="https://img.example/b.png"><img src="/a.jpg">![x](/c.webp)', 3),
    ["/a.jpg", "https://img.example/b.png", "/c.webp"],
  );
  assert.deepEqual(forumContentImages('<img src="javascript:alert(1)">![x](data:image/png;base64,aaa)'), []);
  assert.deepEqual(forumContentImages('<img src="//tracker.example/pixel.gif">'), []);
});
