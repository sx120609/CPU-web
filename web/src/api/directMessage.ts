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
  unreadCount: number;
  sendState: DirectMessageSendState;
  lastMessage?: DirectMessageItem | null;
}

export interface DirectConversationList {
  conversations: DirectConversation[];
  totalUnread: number;
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

export const directMessageApi = {
  conversations: (options?: RequestOptions) =>
    request.get<DirectConversationList>("/direct-messages/conversations", undefined, options),
  withUser: (userId: number, options?: RequestOptions) =>
    request.get<{ counterpart: DirectMessageUser; conversation: DirectConversation | null }>(
      `/direct-messages/with/${userId}`,
      undefined,
      options,
    ),
  withForumPost: (kind: ForumDirectMessageKind, postId: number, options?: RequestOptions) =>
    request.get<{ counterpart: DirectMessageUser; conversation: DirectConversation | null }>(
      `/direct-messages/forum/${kind}/${postId}`,
      undefined,
      options,
    ),
  messages: (conversationId: number, params?: { before?: number; limit?: number }, options?: RequestOptions) =>
    request.get<DirectMessagePage>(`/direct-messages/conversations/${conversationId}/messages`, params, options),
  send: (conversationId: number, content: string, options?: RequestOptions) =>
    request.post<DirectMessageSendResult>(`/direct-messages/conversations/${conversationId}/messages`, { content }, options),
  sendToUser: (userId: number, content: string, options?: RequestOptions) =>
    request.post<DirectMessageSendResult>(`/direct-messages/with/${userId}/messages`, { content }, options),
  sendToForumPost: (kind: ForumDirectMessageKind, postId: number, content: string, options?: RequestOptions) =>
    request.post<DirectMessageSendResult>(`/direct-messages/forum/${kind}/${postId}/messages`, { content }, options),
};
