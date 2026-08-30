export const FORUM_REPORT_TARGET_TYPES = ["topic", "reply", "direct_message"] as const;
export type ForumReportTargetType = typeof FORUM_REPORT_TARGET_TYPES[number];
export const FORUM_REPORT_AUTO_HIDE_THRESHOLD = 3;

export const FORUM_REPORT_REASONS = [
  "spam_or_fraud",
  "harassment",
  "sexual_or_disturbing",
  "illegal_or_dangerous",
  "privacy",
  "misinformation",
  "other",
] as const;
export type ForumReportReason = typeof FORUM_REPORT_REASONS[number];

const reasonLabels: Record<ForumReportReason, string> = {
  spam_or_fraud: "广告、诈骗或引流",
  harassment: "辱骂、骚扰或人身攻击",
  sexual_or_disturbing: "色情、低俗或令人不适",
  illegal_or_dangerous: "违法、危险或违禁内容",
  privacy: "泄露隐私或冒充他人",
  misinformation: "虚假或误导信息",
  other: "其他问题",
};

export function forumReportReasonLabel(reason: ForumReportReason) {
  return reasonLabels[reason];
}

export function forumReportEligibility(input: {
  targetType: ForumReportTargetType;
  reporterId: number;
  targetAuthorId: number;
  reporterIsParticipant?: boolean;
}) {
  if (input.targetAuthorId === input.reporterId) return "不能举报自己发布的内容";
  if (input.targetType === "direct_message" && !input.reporterIsParticipant) return "只能举报自己会话中的消息";
  return null;
}

export function forumReportTargetUrl(targetType: ForumReportTargetType, targetId: number, topicId?: number | null) {
  if (targetType === "topic") return `/forum/topic/${targetId}`;
  if (targetType === "reply" && topicId) return `/forum/topic/${topicId}#reply-${targetId}`;
  return null;
}

export function shouldAutoHideReportedContent(targetType: ForumReportTargetType, activeReportCount: number) {
  return targetType !== "direct_message" && activeReportCount >= FORUM_REPORT_AUTO_HIDE_THRESHOLD;
}

export function shouldRestoreAutoHiddenContent(targetType: ForumReportTargetType, activeReportCount: number) {
  return targetType !== "direct_message" && activeReportCount < FORUM_REPORT_AUTO_HIDE_THRESHOLD;
}
