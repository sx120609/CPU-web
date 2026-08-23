import assert from "node:assert/strict";
import test from "node:test";
import {
  createForumSubmissionId,
  isAmbiguousForumSubmissionError,
  reconcileForumSubmission,
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
