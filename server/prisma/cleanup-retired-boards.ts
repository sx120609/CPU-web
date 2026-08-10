import { prisma } from "../src/prisma";

const RETIRED_BOARD_SLUG = "campus-wall";
const RETIRED_NOTIFICATION_SOURCE = "逛逛同步";
const GLOBAL_PINNED_TOPICS_KEY = "forum.globalPinnedTopics";
// PostgreSQL prepared statements support at most 32767 bind parameters. Keep
// every `IN (...)` operation well below that limit, including operations that
// combine topic and reply IDs.
const ID_BATCH_SIZE = 5000;

async function collectBatched<T>(ids: number[], action: (batch: number[]) => Promise<T>) {
  const results: T[] = [];
  for (let start = 0; start < ids.length; start += ID_BATCH_SIZE) {
    results.push(await action(ids.slice(start, start + ID_BATCH_SIZE)));
  }
  return results;
}

async function countBatched(
  ids: number[],
  action: (batch: number[]) => Promise<{ count: number }>,
) {
  const results = await collectBatched(ids, action);
  return results.reduce((total, result) => total + result.count, 0);
}

async function main() {
  // Older deployments may still have these feature-only tables. They are no
  // longer part of the Prisma schema, so remove them before deleting topics.
  await prisma.$executeRawUnsafe(
    'DROP TABLE IF EXISTS "WeiwallReplyMap", "WeiwallTopicMap", "WeiwallSyncConfig" CASCADE',
  );

  const board = await prisma.board.findUnique({
    where: { slug: RETIRED_BOARD_SLUG },
    select: { id: true, feedSourceId: true },
  });
  if (board?.feedSourceId) {
    throw new Error(`Refusing to delete ${RETIRED_BOARD_SLUG}: it is still linked to feed source ${board.feedSourceId}`);
  }

  const topics = board ? await prisma.topic.findMany({
    where: { boardId: board.id },
    select: { id: true, authorId: true },
  }) : [];
  const topicIds = topics.map((topic) => topic.id);
  const replies = (await collectBatched(topicIds, (batch) => prisma.reply.findMany({
    where: { topicId: { in: batch } },
    select: { id: true, authorId: true },
  }))).flat();
  const affectedUserIds = [...new Set([
    ...topics.map((topic) => topic.authorId),
    ...replies.map((reply) => reply.authorId),
  ])];
  const replyIds = replies.map((reply) => reply.id);

  const result = await prisma.$transaction(async (tx) => {
    const notifications = await tx.notification.deleteMany({
      where: { source: RETIRED_NOTIFICATION_SOURCE },
    });
    if (!board) {
      return { notificationsDeleted: notifications.count, boardDeleted: false };
    }

    const globalPinned = await tx.siteSetting.findUnique({ where: { key: GLOBAL_PINNED_TOPICS_KEY } });
    if (globalPinned) {
      let pinnedIds: number[] = [];
      try {
        const parsed = JSON.parse(globalPinned.value);
        if (Array.isArray(parsed)) {
          pinnedIds = parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0);
        }
      } catch {
        pinnedIds = [];
      }
      const topicIdSet = new Set(topicIds);
      const nextPinnedIds = pinnedIds.filter((id) => !topicIdSet.has(id));
      if (nextPinnedIds.length !== pinnedIds.length) {
        await tx.siteSetting.update({
          where: { key: GLOBAL_PINNED_TOPICS_KEY },
          data: { value: JSON.stringify(nextPinnedIds) },
        });
      }
    }

    const topicLikes = await countBatched(topicIds, (batch) => tx.like.deleteMany({ where: { topicId: { in: batch } } }));
    const replyLikes = await countBatched(replyIds, (batch) => tx.like.deleteMany({ where: { replyId: { in: batch } } }));
    const likes = { count: topicLikes + replyLikes };
    const topicTags = { count: await countBatched(topicIds, (batch) => tx.topicTag.deleteMany({ where: { topicId: { in: batch } } })) };
    const ratings = { count: await countBatched(topicIds, (batch) => tx.courseRating.deleteMany({ where: { topicId: { in: batch } } })) };
    const schoolFeedItems = { count: await countBatched(topicIds, (batch) => tx.schoolFeedItem.updateMany({
      where: { topicId: { in: batch } },
      data: { topicId: null },
    })) };
    const marketItems = { count: await countBatched(topicIds, (batch) => tx.marketItem.updateMany({
      where: { topicId: { in: batch } },
      data: { topicId: null },
    })) };
    const lostFoundItems = { count: await countBatched(topicIds, (batch) => tx.lostFoundItem.deleteMany({ where: { topicId: { in: batch } } })) };
    const qqBotLogs = { count: await countBatched(topicIds, (batch) => tx.qqBotMessageLog.deleteMany({ where: { topicId: { in: batch } } })) };

    // Break the self-reference first so databases with restrictive parent
    // reply constraints can still remove the whole retired tree.
    const repliesDetached = await countBatched(topicIds, (batch) => tx.reply.updateMany({
      where: { topicId: { in: batch } },
      data: { parentReplyId: null },
    }));
    const repliesDeleted = { count: await countBatched(topicIds, (batch) => tx.reply.deleteMany({ where: { topicId: { in: batch } } })) };
    const topicsDeleted = { count: await countBatched(topicIds, (batch) => tx.topic.deleteMany({ where: { id: { in: batch } } })) };
    await tx.board.delete({ where: { id: board.id } });

    for (const userId of affectedUserIds) {
      const [postCount, replyCount] = await Promise.all([
        tx.topic.count({ where: { authorId: userId, hidden: false } }),
        tx.reply.count({ where: { authorId: userId, hidden: false } }),
      ]);
      await tx.user.update({ where: { id: userId }, data: { postCount, replyCount } });
    }

    return {
      notificationsDeleted: notifications.count,
      likesDeleted: likes.count,
      topicTagsDeleted: topicTags.count,
      ratingsDeleted: ratings.count,
      schoolFeedItemsDetached: schoolFeedItems.count,
      marketItemsDetached: marketItems.count,
      lostFoundItemsDeleted: lostFoundItems.count,
      qqBotLogsDeleted: qqBotLogs.count,
      repliesDetached,
      repliesDeleted: repliesDeleted.count,
      topicsDeleted: topicsDeleted.count,
      boardDeleted: true,
    };
  }, { timeout: 300_000 });

  console.log(JSON.stringify({
    board: RETIRED_BOARD_SLUG,
    ...result,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
