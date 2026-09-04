import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forumAuthorReputationSelect } from "../src/services/forumPresentation";
import { buildUserPreview } from "../src/utils/publicUser";

const topicListSource = readFileSync(new URL("../../web/src/components/forum/TopicListItem.vue", import.meta.url), "utf8");
const forumFeedSource = readFileSync(new URL("../../web/src/components/forum/ForumFeedCard.vue", import.meta.url), "utf8");
const topicPageSource = readFileSync(new URL("../../web/src/views/forum/Topic.vue", import.meta.url), "utf8");
const topicResponsiveSource = readFileSync(new URL("../../web/src/views/forum/styles/topic-responsive.scss", import.meta.url), "utf8");

test("forum author queries include the inputs required for a current reputation level", () => {
  assert.deepEqual(forumAuthorReputationSelect, {
    createdAt: true,
    postCount: true,
    replyCount: true,
  });
});

test("public forum author previews expose the derived level without leaking its source counters", () => {
  const preview = buildUserPreview({
    id: 42,
    nickname: "论坛同学",
    role: "user",
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    postCount: 100,
    replyCount: 100,
  }) as Record<string, any>;

  assert.equal(preview.reputationLevel.level, 5);
  assert.equal(preview.reputationLevel.name, "校园传说");
  assert.equal("createdAt" in preview, false);
  assert.equal("postCount" in preview, false);
  assert.equal("replyCount" in preview, false);
});

test("forum list, feed, topic, and reply surfaces render the author level badge", () => {
  assert.equal((topicListSource.match(/<UserReputationBadge/g) || []).length, 3);
  assert.match(forumFeedSource, /<UserReputationBadge :level="topic\.author\?\.reputationLevel"/);
  assert.equal((topicPageSource.match(/<UserReputationBadge/g) || []).length, 2);
});

test("mobile reply editor is a compact bottom sheet with an explicit return to the post", () => {
  assert.doesNotMatch(topicPageSource, /:fullscreen="isMobileLayout"/);
  assert.match(topicPageSource, /class="reply-original-peek" @click="peekOriginalPost"/);
  assert.match(topicResponsiveSource, /\.reply-dialog-overlay \.reply-dialog[\s\S]*?max-height:\s*min\(68dvh, 560px\)/);
  assert.match(topicResponsiveSource, /\.editor-surface\)[\s\S]*?min-height:\s*118px[\s\S]*?max-height:\s*min\(28dvh, 240px\)/);
});
