import assert from "node:assert/strict";
import test from "node:test";
import {
  isForumSubmissionUniqueConflict,
  normalizeForumSubmissionId,
} from "../src/services/forumSubmission";

test("论坛提交 ID 只接受匹配类型的稳定客户端标识", () => {
  assert.equal(normalizeForumSubmissionId("topic-12345678-abcd", "topic"), "topic-12345678-abcd");
  assert.equal(normalizeForumSubmissionId("reply-12345678-abcd", "topic"), null);
  assert.equal(normalizeForumSubmissionId("topic-short", "topic"), null);
  assert.equal(normalizeForumSubmissionId("", "topic"), null);
});

test("论坛幂等写入只把 Prisma 唯一约束冲突识别为可恢复重放", () => {
  assert.equal(isForumSubmissionUniqueConflict({ code: "P2002" }), true);
  assert.equal(isForumSubmissionUniqueConflict({ code: "P2025" }), false);
  assert.equal(isForumSubmissionUniqueConflict(new Error("network")), false);
});
