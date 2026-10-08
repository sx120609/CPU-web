import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layout = readFileSync(new URL("../src/layouts/MainLayout.vue", import.meta.url), "utf8");

test("移动端投稿入口显示明确文案并直接进入综合板块", () => {
  assert.match(layout, /class="forum-post-fab"[\s\S]*aria-label="投稿"[\s\S]*<span>投稿<\/span>/u);
  assert.match(layout, /useMobileForumLayout\.value \? "\/post\?board=general" : "\/post"/u);
  assert.doesNotMatch(layout, /composeMenuOpen|<ComposeActionSheet|const ComposeActionSheet/u);
});

test("窄屏投稿入口保留文字而不是退化为纯图标", () => {
  // The phone media query now lives in styles/_compact.scss; the compact-layout block holds the phone shell.
  const start = layout.indexOf("@include compact-layout");
  assert.ok(start > 0);
  const mobileStyles = layout.slice(start);
  assert.match(mobileStyles, /\.forum-post-fab\s*\{[\s\S]*?width:\s*auto;/u);
  assert.match(mobileStyles, /\.forum-post-fab span\s*\{\s*display:\s*inline;/u);
  assert.doesNotMatch(mobileStyles, /\.forum-post-fab span\s*\{\s*display:\s*none;/u);
});
