import { HttpError, Errors } from "../utils/response";
import { reviewDirectMessageContent, type TopicAiReviewResult } from "./topicAiReview";

export function isDirectMessageReviewUnavailable(result: TopicAiReviewResult) {
  try {
    return JSON.parse(result.detail || "{}").unavailable === true;
  } catch {
    return false;
  }
}

export function directMessageModerationFailure(result: TopicAiReviewResult) {
  if (result.status === "auto_passed") return null;
  if (isDirectMessageReviewUnavailable(result)) return "私聊内容审核服务暂不可用，请稍后再试";
  return result.reason
    ? `消息未通过内容审核：${result.reason}`
    : "消息未通过内容审核，请修改后重试";
}

export async function ensureDirectMessageContentApproved(senderId: number, content: string) {
  const result = await reviewDirectMessageContent({ content, createdById: senderId });
  const failure = directMessageModerationFailure(result);
  if (!failure) return result;
  if (isDirectMessageReviewUnavailable(result)) throw new HttpError(503, 5030, failure);
  throw Errors.forbidden(failure);
}
