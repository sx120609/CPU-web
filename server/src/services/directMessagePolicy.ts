export const DIRECT_MESSAGE_PRE_REPLY_LIMIT = 2;

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
