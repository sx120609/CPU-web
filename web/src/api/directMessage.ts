import { request, type RequestOptions } from "./request";

export interface DirectMessageUser {
  id: number;
  nickname: string;
  avatar?: string | null;
  role: string;
  vipActive?: boolean;
  profileTheme?: string | null;
  profileFrame?: string | null;
  anonymous?: boolean;
}

export type ForumDirectMessageKind = "topic" | "reply";

export interface DirectMessageSendState {
  limitedUntilReply: boolean;
  canSend: boolean;
  remainingBeforeReply: number | null;
}

export interface DirectMessageItem {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  hidden: boolean;
  aiReviewStatus: "checking" | "auto_passed" | "blocked_ai" | "review_failed" | string;
  aiRiskLevel?: "low" | "medium" | "high" | null;
  aiRiskScore?: number | null;
  aiReviewReason?: string | null;
  aiReviewedAt?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface DirectConversation {
  id: number;
  initiatedById: number;
  recipientRepliedAt?: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  counterpart: DirectMessageUser;
  counterpartRemark?: string | null;
  unreadCount: number;
  sendState: DirectMessageSendState;
  lastMessage?: DirectMessageItem | null;
}

export interface DirectConversationList {
  conversations: DirectConversation[];
  totalUnread: number;
}

export interface DirectMessageRemarks {
  remarks: Record<string, string>;
}

export interface DirectMessagePage {
  conversation: DirectConversation;
  messages: DirectMessageItem[];
  nextCursor: number | null;
}

export interface DirectMessageSendResult {
  conversation: DirectConversation;
  message: DirectMessageItem;
}

export interface DirectMessageTarget {
  counterpart: DirectMessageUser;
  counterpartRemark: string | null;
  conversation: DirectConversation | null;
}

export const directMessageApi = {
  conversations: (options?: RequestOptions) =>
    request.get<DirectConversationList>("/direct-messages/conversations", undefined, options),
  withUser: (userId: number, options?: RequestOptions) =>
    request.get<DirectMessageTarget>(
      `/direct-messages/with/${userId}`,
      undefined,
      options,
    ),
  withForumPost: (kind: ForumDirectMessageKind, postId: number, options?: RequestOptions) =>
    request.get<DirectMessageTarget>(
      `/direct-messages/forum/${kind}/${postId}`,
      undefined,
      options,
    ),
  messages: (conversationId: number, params?: { before?: number; limit?: number }, options?: RequestOptions) =>
    request.get<DirectMessagePage>(`/direct-messages/conversations/${conversationId}/messages`, params, options),
  remarks: (userIds: number[], options?: RequestOptions) =>
    request.get<DirectMessageRemarks>(
      "/direct-messages/remarks",
      { userIds: [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100).join(",") },
      options,
    ),
  setRemark: (userId: number, remark: string | null, options?: RequestOptions) =>
    request.patch<{ targetUserId: number; remark: string | null }>(
      `/direct-messages/remarks/${userId}`,
      { remark },
      options,
    ),
  send: (conversationId: number, content: string, options?: RequestOptions) =>
    request.post<DirectMessageSendResult>(`/direct-messages/conversations/${conversationId}/messages`, { content }, options),
  sendToUser: (userId: number, content: string, options?: RequestOptions) =>
    request.post<DirectMessageSendResult>(`/direct-messages/with/${userId}/messages`, { content }, options),
  sendToForumPost: (kind: ForumDirectMessageKind, postId: number, content: string, options?: RequestOptions) =>
    request.post<DirectMessageSendResult>(`/direct-messages/forum/${kind}/${postId}/messages`, { content }, options),
};
