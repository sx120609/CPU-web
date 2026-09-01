import assert from "node:assert/strict";
import test from "node:test";
import { decodeTopicForViewer, forumReplyPreviewInclude } from "../src/services/forumPresentation";

test("帖子列表评论预览只查询最新两条公开回复", () => {
  assert.deepEqual(forumReplyPreviewInclude.where, { hidden: false });
  assert.deepEqual(forumReplyPreviewInclude.orderBy, { createdAt: "desc" });
  assert.equal(forumReplyPreviewInclude.take, 2);
});

test("评论预览经过匿名身份脱敏且不暴露原始 replies 字段", () => {
  const topic = decodeTopicForViewer({
    id: 9,
    authorId: 1,
    metadata: "{}",
    isAnonymous: false,
    author: { id: 1, nickname: "楼主", role: "user" },
    replies: [{
      id: 31,
      topicId: 9,
      authorId: 2,
      content: "评论内容",
      isAnonymous: true,
      anonymousAlias: "匿名小熊",
      author: { id: 2, nickname: "真实姓名", role: "user" },
    }],
  });

  assert.equal("replies" in topic, false);
  assert.equal(topic.previewReplies.length, 1);
  assert.equal(topic.previewReplies[0].authorId, null);
  assert.equal(topic.previewReplies[0].author.nickname, "匿名小熊");
  assert.equal(topic.previewReplies[0].realAuthor, undefined);
});
