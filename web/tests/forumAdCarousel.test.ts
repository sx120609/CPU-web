import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const carousel = readFileSync(new URL("../src/components/forum/ForumAdCarousel.vue", import.meta.url), "utf8");
const adSurfaces = [
  "../src/components/forum/ComposeActionSheet.vue",
  "../src/views/HomeDesktop.vue",
  "../src/views/HomeMobile.vue",
  "../src/views/forum/Board.vue",
  "../src/views/forum/Feed.vue",
  "../src/views/forum/IndexDesktop.vue",
  "../src/views/forum/IndexMobile.vue",
];

test("广告轮播仅在同一广告位有多条内容时启用", () => {
  assert.match(carousel, /v-if="slides\.length === 1"/u);
  assert.match(carousel, /<el-carousel/u);
  assert.match(carousel, /v-for="ad in slides"/u);
  assert.match(carousel, /:autoplay="false"/u);
  assert.match(carousel, /:loop="false"/u);
  assert.match(carousel, /arrow="never"/u);
  assert.match(carousel, /indicator-position="none"/u);
  assert.doesNotMatch(carousel, /el-carousel__button/u);
  assert.doesNotMatch(carousel, /el-carousel__indicators/u);
  assert.match(carousel, /const rotationInterval = 6000/u);
  assert.match(carousel, /setActiveItem\(\(activeIndex\.value \+ 1\) % slides\.value\.length\)/u);
  assert.match(carousel, /new Map\(props\.ads\.map/u);
});

test("所有广告展示入口都保留完整广告列表并使用统一轮播组件", () => {
  for (const relativePath of adSurfaces) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /ForumAdCarousel/u, relativePath);
    assert.doesNotMatch(source, /forumAdsApi\.list\([^\n]+\)\s*\[0\]/u, relativePath);
  }
});
