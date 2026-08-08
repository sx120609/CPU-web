import { prisma } from "../src/prisma";

const RETIRED_BOARD_SLUG = "campus-wall";
const RETIRED_NOTIFICATION_SOURCE = "逛逛同步";
const GLOBAL_PINNED_TOPICS_KEY = "forum.globalPinnedTopics";

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
  const replies = topicIds.length
    ? await prisma.reply.findMany({ where: { topicId: { in: topicIds } }, select: { id: true, authorId: true } })
    : [];
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
      const nextPinnedIds = pinnedIds.filter((id) => !topicIds.includes(id));
      if (nextPinnedIds.length !== pinnedIds.length) {
        await tx.siteSetting.update({
          where: { key: GLOBAL_PINNED_TOPICS_KEY },
          data: { value: JSON.stringify(nextPinnedIds) },
        });
      }
    }

    const likes = await tx.like.deleteMany({
      where: { OR: [{ topicId: { in: topicIds } }, { replyId: { in: replyIds } }] },
    });
    const topicTags = await tx.topicTag.deleteMany({ where: { topicId: { in: topicIds } } });
    const ratings = await tx.courseRating.deleteMany({ where: { topicId: { in: topicIds } } });
    const schoolFeedItems = await tx.schoolFeedItem.updateMany({
      where: { topicId: { in: topicIds } },
      data: { topicId: null },
    });
    const marketItems = await tx.marketItem.updateMany({
      where: { topicId: { in: topicIds } },
      data: { topicId: null },
    });
    const lostFoundItems = await tx.lostFoundItem.deleteMany({ where: { topicId: { in: topicIds } } });
    const qqBotLogs = await tx.qqBotMessageLog.deleteMany({ where: { topicId: { in: topicIds } } });

    // Break the self-reference first so databases with restrictive parent
    // reply constraints can still remove the whole retired tree.
    await tx.reply.updateMany({ where: { topicId: { in: topicIds } }, data: { parentReplyId: null } });
    const repliesDeleted = await tx.reply.deleteMany({ where: { topicId: { in: topicIds } } });
    const topicsDeleted = await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
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
      repliesDeleted: repliesDeleted.count,
      topicsDeleted: topicsDeleted.count,
      boardDeleted: true,
    };
  });

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
