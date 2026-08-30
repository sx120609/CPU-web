import test from "node:test";
import assert from "node:assert/strict";
import {
  anonymousForumDirectScope,
  canonicalDirectParticipants,
  directCounterpartId,
  directParticipantAlias,
  DIRECT_MESSAGE_PRE_REPLY_LIMIT,
  presentDirectParticipantId,
  resolveDirectMessageSendState,
} from "../src/services/directMessagePolicy";

test("direct conversations use one stable participant pair in either direction", () => {
  assert.deepEqual(canonicalDirectParticipants(9, 3), { participantLowId: 3, participantHighId: 9 });
  assert.deepEqual(canonicalDirectParticipants(3, 9), { participantLowId: 3, participantHighId: 9 });
  assert.throws(() => canonicalDirectParticipants(3, 3), /不能与自己私聊/);
});

test("conversation initiator can send exactly two messages before the first reply", () => {
  assert.equal(DIRECT_MESSAGE_PRE_REPLY_LIMIT, 2);
  assert.deepEqual(resolveDirectMessageSendState({
    viewerIsInitiator: true,
    recipientReplied: false,
    initiatorMessageCount: 0,
  }), {
    limitedUntilReply: true,
    canSend: true,
    remainingBeforeReply: 2,
  });
  assert.equal(resolveDirectMessageSendState({
    viewerIsInitiator: true,
    recipientReplied: false,
    initiatorMessageCount: 1,
  }).remainingBeforeReply, 1);
  assert.deepEqual(resolveDirectMessageSendState({
    viewerIsInitiator: true,
    recipientReplied: false,
    initiatorMessageCount: 2,
  }), {
    limitedUntilReply: true,
    canSend: false,
    remainingBeforeReply: 0,
  });
});

test("the recipient can reply and both sides are unlimited after that reply", () => {
  assert.deepEqual(resolveDirectMessageSendState({
    viewerIsInitiator: false,
    recipientReplied: false,
    initiatorMessageCount: 0,
  }), {
    limitedUntilReply: false,
    canSend: true,
    remainingBeforeReply: null,
  });
  assert.deepEqual(resolveDirectMessageSendState({
    viewerIsInitiator: true,
    recipientReplied: true,
    initiatorMessageCount: 50,
  }), {
    limitedUntilReply: false,
    canSend: true,
    remainingBeforeReply: null,
  });
});

test("anonymous forum conversations use a separate scope from ordinary direct messages", () => {
  assert.equal(anonymousForumDirectScope(42, "匿名同学 7"), "forum:42:anonymous:匿名同学 7");
  assert.notEqual(anonymousForumDirectScope(42, "匿名同学 7"), "direct");
  assert.notEqual(
    anonymousForumDirectScope(42, "匿名同学 7"),
    anonymousForumDirectScope(43, "匿名同学 7"),
  );
});

test("anonymous participant IDs are masked only from the counterpart", () => {
  const conversation = {
    participantLowId: 3,
    participantHighId: 9,
    participantLowAlias: null,
    participantHighAlias: "匿名同学 7",
  };
  assert.equal(directCounterpartId(conversation, 3), 9);
  assert.equal(directParticipantAlias(conversation, 9), "匿名同学 7");
  assert.equal(presentDirectParticipantId(conversation, 3, 9), 0);
  assert.equal(presentDirectParticipantId(conversation, 3, 3), 3);
  assert.equal(presentDirectParticipantId(conversation, 9, 3), 3);
});
