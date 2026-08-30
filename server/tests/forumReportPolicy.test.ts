import test from "node:test";
import assert from "node:assert/strict";
import {
  FORUM_REPORT_AUTO_HIDE_THRESHOLD,
  forumReportEligibility,
  forumReportReasonLabel,
  forumReportTargetUrl,
  shouldAutoHideReportedContent,
  shouldRestoreAutoHiddenContent,
} from "../src/services/forumReportPolicy";

test("users cannot report their own posts or messages outside their conversations", () => {
  assert.equal(forumReportEligibility({ targetType: "topic", reporterId: 8, targetAuthorId: 8 }), "不能举报自己发布的内容");
  assert.equal(forumReportEligibility({
    targetType: "direct_message",
    reporterId: 8,
    targetAuthorId: 9,
    reporterIsParticipant: false,
  }), "只能举报自己会话中的消息");
  assert.equal(forumReportEligibility({
    targetType: "direct_message",
    reporterId: 8,
    targetAuthorId: 9,
    reporterIsParticipant: true,
  }), null);
});

test("report labels and public target links stay stable", () => {
  assert.equal(forumReportReasonLabel("privacy"), "泄露隐私或冒充他人");
  assert.equal(forumReportTargetUrl("topic", 12), "/forum/topic/12");
  assert.equal(forumReportTargetUrl("reply", 34, 12), "/forum/topic/12#reply-34");
  assert.equal(forumReportTargetUrl("direct_message", 56), null);
});

test("three distinct active reports hide public content and rejected reports can restore it", () => {
  assert.equal(FORUM_REPORT_AUTO_HIDE_THRESHOLD, 3);
  assert.equal(shouldAutoHideReportedContent("topic", 2), false);
  assert.equal(shouldAutoHideReportedContent("topic", 3), true);
  assert.equal(shouldAutoHideReportedContent("reply", 4), true);
  assert.equal(shouldAutoHideReportedContent("direct_message", 3), false);
  assert.equal(shouldRestoreAutoHiddenContent("topic", 3), false);
  assert.equal(shouldRestoreAutoHiddenContent("topic", 2), true);
  assert.equal(shouldRestoreAutoHiddenContent("direct_message", 0), false);
});
