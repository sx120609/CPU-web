import assert from "node:assert/strict";
import test from "node:test";
import {
  createForumSubmissionId,
  isAmbiguousForumSubmissionError,
  reconcileForumSubmission,
  resolveForumReviewState,
} from "../src/utils/forumSubmission";

test("客户端为帖子和回复生成可复用且互不混淆的提交 ID", () => {
  const topicId = createForumSubmissionId("topic");
  const replyId = createForumSubmissionId("reply");
  assert.match(topicId, /^topic-[a-z0-9-]{8,}$/u);
  assert.match(replyId, /^reply-[a-z0-9-]{8,}$/u);
  assert.notEqual(topicId, replyId);
});

test("只有无响应或服务端错误才需要查询发布结果", () => {
  assert.equal(isAmbiguousForumSubmissionError(new Error("timeout")), true);
  assert.equal(isAmbiguousForumSubmissionError({ response: { status: 502 } }), true);
  assert.equal(isAmbiguousForumSubmissionError({ response: { status: 400 } }), false);
});

test("编辑结果只在服务端明确公开后才判定为通过", () => {
  assert.equal(resolveForumReviewState({ aiReviewStatus: "checking", hidden: true }), "pending");
  assert.equal(resolveForumReviewState({ aiReviewStatus: "blocked_ai", hidden: true }), "blocked_ai");
  assert.equal(resolveForumReviewState({ aiReviewStatus: "review_failed", hidden: true }), "failed");
  assert.equal(resolveForumReviewState({ aiReviewStatus: "auto_passed", hidden: false }), "published");
  assert.equal(resolveForumReviewState({ aiReviewStatus: "checking", hidden: false }), "pending");
  assert.equal(resolveForumReviewState({ aiReviewStatus: "blocked_ai", hidden: false }), "unknown");
});

test("结果确认会容忍暂时 404 并在记录出现后返回", async () => {
  let attempts = 0;
  const result = await reconcileForumSubmission(async () => {
    attempts += 1;
    if (attempts === 1) throw { response: { status: 404 } };
    return { id: 123 };
  }, { attempts: 2, intervalMs: 100 });
  assert.deepEqual(result, { id: 123 });
  assert.equal(attempts, 2);
});
