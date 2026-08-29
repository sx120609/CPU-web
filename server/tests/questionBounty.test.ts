import assert from "node:assert/strict";
import test from "node:test";
import {
  QUESTION_BOUNTY_REWARD_POINTS,
  acceptQuestionAnswer,
  buildAcceptedQuestionMetadata,
  normalizeQuestionMetadataForWrite,
  parseQuestionMetadata,
  presentQuestionMetadata,
} from "../src/services/questionBounty";

test("all question metadata presents a fixed ten-point bounty", () => {
  assert.equal(QUESTION_BOUNTY_REWARD_POINTS, 10);
  assert.deepEqual(presentQuestionMetadata({ bounty: 999, tags: ["药理学"] }), {
    bounty: 10,
    tags: ["药理学"],
    resolved: false,
  });
});

test("new and unresolved question writes discard client-forged acceptance fields", () => {
  assert.deepEqual(normalizeQuestionMetadataForWrite({
    bounty: 999,
    resolved: true,
    acceptedReplyId: 88,
    acceptedAt: "forged",
    awardedAiPoints: 999,
    _editorMode: "visual",
  }), {
    bounty: 10,
    resolved: false,
    _editorMode: "visual",
  });
});

test("editing a resolved question cannot replace its accepted answer or reward", () => {
  const existing = {
    bounty: 10,
    resolved: true,
    acceptedReplyId: 12,
    acceptedAt: "2026-08-30T01:02:03.000Z",
    awardedAiPoints: 10,
    _editorMode: "markup",
  };
  assert.deepEqual(normalizeQuestionMetadataForWrite({
    bounty: 0,
    resolved: false,
    acceptedReplyId: 99,
    _editorMode: "visual",
  }, existing), {
    bounty: 10,
    resolved: true,
    acceptedReplyId: 12,
    acceptedAt: "2026-08-30T01:02:03.000Z",
    awardedAiPoints: 10,
    _editorMode: "visual",
  });
});

test("accepted answer metadata records the fixed reward and parses safely", () => {
  const acceptedAt = new Date("2026-08-30T02:03:04.000Z");
  const metadata = buildAcceptedQuestionMetadata({ _postMode: "post" }, 7, acceptedAt);
  assert.deepEqual(metadata, {
    _postMode: "post",
    bounty: 10,
    resolved: true,
    acceptedReplyId: 7,
    acceptedAt: acceptedAt.toISOString(),
    awardedAiPoints: 10,
  });
  assert.deepEqual(parseQuestionMetadata(JSON.stringify(metadata)), metadata);
  assert.deepEqual(parseQuestionMetadata("not-json"), {});
});

test("accepting an answer atomically awards ten points and safely replays", async () => {
  let storedMetadata = JSON.stringify({ resolved: false, bounty: 0 });
  let balance = 2;
  const ledger: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];
  const tx = {
    topic: {
      findUnique: async () => ({
        id: 41,
        authorId: 3,
        hidden: false,
        metadata: storedMetadata,
        board: { type: "question" },
      }),
      updateMany: async ({ where, data }: any) => {
        if (where.metadata !== storedMetadata) return { count: 0 };
        storedMetadata = data.metadata;
        return { count: 1 };
      },
    },
    reply: {
      findFirst: async () => ({ id: 9, authorId: 8 }),
    },
    user: {
      update: async ({ data }: any) => {
        balance += Number(data.assistantPoints.increment);
        return { assistantPoints: balance };
      },
      findUniqueOrThrow: async () => ({ assistantPoints: balance }),
    },
    campusAssistantPointLedger: {
      create: async ({ data }: any) => {
        ledger.push(data);
        return { id: ledger.length };
      },
    },
    notification: {
      create: async ({ data }: any) => {
        notifications.push(data);
        return { id: notifications.length };
      },
    },
  };
  const client = {
    $transaction: async (run: (transaction: typeof tx) => unknown) => run(tx),
  } as any;

  const first = await acceptQuestionAnswer({ topicId: 41, replyId: 9, actorUserId: 3 }, client);
  assert.equal(first.rewardPoints, 10);
  assert.equal(first.recipientBalance, 12);
  assert.equal(first.replayed, false);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.source, "question_bounty_reward");
  assert.equal(ledger[0]?.referenceId, "41");
  assert.equal(notifications.length, 1);

  const replay = await acceptQuestionAnswer({ topicId: 41, replyId: 9, actorUserId: 3 }, client);
  assert.equal(replay.replayed, true);
  assert.equal(replay.recipientBalance, 12);
  assert.equal(ledger.length, 1);
  assert.equal(notifications.length, 1);
});
