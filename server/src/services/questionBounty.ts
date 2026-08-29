import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { grantAssistantPoints } from "./campusAssistantPoints";

export const QUESTION_BOUNTY_REWARD_POINTS = 10;

type QuestionMetadata = Record<string, unknown>;
type QuestionBountyClient = PrismaClient;

const ACCEPTANCE_FIELDS = [
  "acceptedReplyId",
  "acceptedAt",
  "awardedAiPoints",
] as const;

function asMetadata(value: unknown): QuestionMetadata {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as QuestionMetadata) }
    : {};
}

export function parseQuestionMetadata(value: string | null | undefined) {
  if (!value) return {};
  try {
    return asMetadata(JSON.parse(value));
  } catch {
    return {};
  }
}

export function presentQuestionMetadata(value: unknown): QuestionMetadata & { bounty: number; resolved: boolean } {
  const metadata = asMetadata(value);
  return {
    ...metadata,
    bounty: QUESTION_BOUNTY_REWARD_POINTS,
    resolved: metadata.resolved === true,
  };
}

export function normalizeQuestionMetadataForWrite(input: unknown, current?: unknown) {
  const next = presentQuestionMetadata(input);
  const existing = presentQuestionMetadata(current);

  if (existing.resolved) {
    next.resolved = true;
    for (const field of ACCEPTANCE_FIELDS) {
      if (existing[field] !== undefined) next[field] = existing[field];
      else delete next[field];
    }
    return next;
  }

  next.resolved = false;
  for (const field of ACCEPTANCE_FIELDS) delete next[field];
  return next;
}

export function buildAcceptedQuestionMetadata(input: unknown, replyId: number, acceptedAt: Date) {
  return {
    ...presentQuestionMetadata(input),
    resolved: true,
    acceptedReplyId: replyId,
    acceptedAt: acceptedAt.toISOString(),
    awardedAiPoints: QUESTION_BOUNTY_REWARD_POINTS,
  };
}

export type QuestionAnswerAcceptance = {
  topicId: number;
  replyId: number;
  metadata: QuestionMetadata;
  rewardPoints: number;
  recipientBalance: number;
  replayed: boolean;
};

export async function acceptQuestionAnswer(
  input: { topicId: number; replyId: number; actorUserId: number },
  client: QuestionBountyClient = prisma,
): Promise<QuestionAnswerAcceptance> {
  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    const topic = await tx.topic.findUnique({
      where: { id: input.topicId },
      include: {
        board: { select: { type: true } },
      },
    });
    if (!topic || topic.hidden) throw Errors.notFound("问题不存在");
    if (topic.board?.type !== "question") throw Errors.badRequest("只有提问广场的问题可以采纳回答");
    if (topic.authorId !== input.actorUserId) throw Errors.forbidden("只有提问者可以采纳回答");

    const reply = await tx.reply.findFirst({
      where: {
        id: input.replyId,
        topicId: input.topicId,
        hidden: false,
      },
      select: { id: true, authorId: true },
    });
    if (!reply) throw Errors.notFound("回答不存在或尚未公开");
    if (reply.authorId === topic.authorId) throw Errors.badRequest("不能采纳自己的回答");

    const currentMetadata = presentQuestionMetadata(parseQuestionMetadata(topic.metadata));
    const acceptedReplyId = Number(currentMetadata.acceptedReplyId || 0);
    if (currentMetadata.resolved) {
      if (acceptedReplyId !== reply.id) throw Errors.conflict("这个问题已经采纳了其他回答");
      const recipient = await tx.user.findUniqueOrThrow({
        where: { id: reply.authorId },
        select: { assistantPoints: true },
      });
      return {
        topicId: topic.id,
        replyId: reply.id,
        metadata: currentMetadata,
        rewardPoints: QUESTION_BOUNTY_REWARD_POINTS,
        recipientBalance: recipient.assistantPoints,
        replayed: true,
      };
    }

    const acceptedAt = new Date();
    const nextMetadata = buildAcceptedQuestionMetadata(currentMetadata, reply.id, acceptedAt);
    const claimed = await tx.topic.updateMany({
      where: {
        id: topic.id,
        hidden: false,
        metadata: topic.metadata,
      },
      data: { metadata: JSON.stringify(nextMetadata) },
    });
    if (claimed.count !== 1) throw Errors.conflict("问题状态刚刚发生变化，请刷新后重试");

    const award = await grantAssistantPoints(tx, {
      userId: reply.authorId,
      points: QUESTION_BOUNTY_REWARD_POINTS,
      source: "question_bounty_reward",
      reason: "提问广场回答被采纳",
      referenceType: "question_topic",
      referenceId: String(topic.id),
    });
    await tx.notification.create({
      data: {
        userId: reply.authorId,
        category: "reply",
        level: "strong",
        title: "你的回答被采纳了",
        content: `平台已奖励你 ${QUESTION_BOUNTY_REWARD_POINTS} 个 AI 点数。`,
        payload: JSON.stringify({
          type: "question-answer-accepted",
          topicId: topic.id,
          replyId: reply.id,
          rewardPoints: QUESTION_BOUNTY_REWARD_POINTS,
        }),
        link: `/forum/topic/${topic.id}#reply-${reply.id}`,
        source: "提问广场",
      },
    });

    return {
      topicId: topic.id,
      replyId: reply.id,
      metadata: nextMetadata,
      rewardPoints: QUESTION_BOUNTY_REWARD_POINTS,
      recipientBalance: award.balance,
      replayed: false,
    };
  });
}
