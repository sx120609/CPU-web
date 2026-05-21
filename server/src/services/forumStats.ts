import { prisma } from "../prisma";

type ForumStatsClient = Pick<typeof prisma, "topic" | "board" | "user" | "reply">;

function uniquePositiveIds(ids: Iterable<number>) {
  return [...new Set(Array.from(ids).filter((id) => Number.isFinite(id) && id > 0))];
}

export async function refreshBoardTopicCount(boardId: number, client: ForumStatsClient = prisma) {
  const topicCount = await client.topic.count({
    where: { boardId, hidden: false },
  });
  await client.board.update({
    where: { id: boardId },
    data: { topicCount },
  });
  return topicCount;
}

export async function refreshBoardTopicCounts(boardIds: Iterable<number>, client: ForumStatsClient = prisma) {
  const ids = uniquePositiveIds(boardIds);
  await Promise.all(ids.map((boardId) => refreshBoardTopicCount(boardId, client)));
}

export async function refreshUserPostCount(userId: number, client: ForumStatsClient = prisma) {
  const postCount = await client.topic.count({
    where: { authorId: userId, hidden: false },
  });
  await client.user.update({
    where: { id: userId },
    data: { postCount },
  });
  return postCount;
}

export async function refreshUserReplyCount(userId: number, client: ForumStatsClient = prisma) {
  const replyCount = await client.reply.count({
    where: { authorId: userId, hidden: false },
  });
  await client.user.update({
    where: { id: userId },
    data: { replyCount },
  });
  return replyCount;
}
