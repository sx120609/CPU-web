export const DIRECT_MESSAGE_PRE_REPLY_LIMIT = 2;
export const DIRECT_MESSAGE_DEFAULT_SCOPE = "direct";

export type DirectMessageSendState = {
  limitedUntilReply: boolean;
  canSend: boolean;
  remainingBeforeReply: number | null;
};

export function canonicalDirectParticipants(firstUserId: number, secondUserId: number) {
  if (!Number.isInteger(firstUserId) || firstUserId <= 0 || !Number.isInteger(secondUserId) || secondUserId <= 0) {
    throw new Error("用户 ID 必须是正整数");
  }
  if (firstUserId === secondUserId) throw new Error("不能与自己私聊");
  return firstUserId < secondUserId
    ? { participantLowId: firstUserId, participantHighId: secondUserId }
    : { participantLowId: secondUserId, participantHighId: firstUserId };
}

export function anonymousForumDirectScope(topicId: number, alias: string) {
  if (!Number.isInteger(topicId) || topicId <= 0) throw new Error("帖子 ID 必须是正整数");
  const normalizedAlias = String(alias || "").trim();
  if (!normalizedAlias) throw new Error("匿名昵称不能为空");
  return `forum:${topicId}:anonymous:${normalizedAlias}`;
}

export type DirectConversationPrivacy = {
  participantLowId: number;
  participantHighId: number;
  participantLowAlias?: string | null;
  participantHighAlias?: string | null;
};

export function directParticipantAlias(conversation: DirectConversationPrivacy, participantId: number) {
  if (conversation.participantLowId === participantId) return conversation.participantLowAlias || null;
  if (conversation.participantHighId === participantId) return conversation.participantHighAlias || null;
  return null;
}

export function directCounterpartId(conversation: DirectConversationPrivacy, viewerId: number) {
  if (conversation.participantLowId === viewerId) return conversation.participantHighId;
  if (conversation.participantHighId === viewerId) return conversation.participantLowId;
  throw new Error("用户不在该私聊会话中");
}

export function presentDirectParticipantId(
  conversation: DirectConversationPrivacy,
  viewerId: number,
  participantId: number,
) {
  if (participantId === viewerId) return viewerId;
  return directParticipantAlias(conversation, participantId) ? 0 : participantId;
}

export function resolveDirectMessageSendState(input: {
  viewerIsInitiator: boolean;
  recipientReplied: boolean;
  initiatorMessageCount: number;
}): DirectMessageSendState {
  if (!input.viewerIsInitiator || input.recipientReplied) {
    return {
      limitedUntilReply: false,
      canSend: true,
      remainingBeforeReply: null,
    };
  }

  const remainingBeforeReply = Math.max(
    0,
    DIRECT_MESSAGE_PRE_REPLY_LIMIT - Math.max(0, Math.trunc(input.initiatorMessageCount)),
  );
  return {
    limitedUntilReply: true,
    canSend: remainingBeforeReply > 0,
    remainingBeforeReply,
  };
}
