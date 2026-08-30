import { request, type RequestOptions } from "./request";

export type ForumReportTargetType = "topic" | "reply" | "direct_message";
export type ForumReportReason =
  | "spam_or_fraud"
  | "harassment"
  | "sexual_or_disturbing"
  | "illegal_or_dangerous"
  | "privacy"
  | "misinformation"
  | "other";

export const forumReportReasonOptions: Array<{ value: ForumReportReason; label: string }> = [
  { value: "spam_or_fraud", label: "广告、诈骗或引流" },
  { value: "harassment", label: "辱骂、骚扰或人身攻击" },
  { value: "sexual_or_disturbing", label: "色情、低俗或令人不适" },
  { value: "illegal_or_dangerous", label: "违法、危险或违禁内容" },
  { value: "privacy", label: "泄露隐私或冒充他人" },
  { value: "misinformation", label: "虚假或误导信息" },
  { value: "other", label: "其他问题" },
];

export const forumReportApi = {
  submit: (
    payload: { targetType: ForumReportTargetType; targetId: number; reason: ForumReportReason; detail?: string },
    options?: RequestOptions,
  ) => request.post<{ id: number; status: string; reportCount: number; autoHidden: boolean }>("/forum-reports", payload, options),
};
