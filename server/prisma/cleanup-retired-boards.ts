import { prisma } from "../src/prisma";

const RETIRED_BOARD_SLUG = "campus-wall";
const RETIRED_NOTIFICATION_SOURCE = "逛逛同步";
const GLOBAL_PINNED_TOPICS_KEY = "forum.globalPinnedTopics";
const RETIRED_TABLES_SQL = 'DROP TABLE IF EXISTS "WeiwallReplyMap", "WeiwallTopicMap", "WeiwallSyncConfig" CASCADE';

async function removeRetiredMirrorTables() {
  console.log("[cleanup] Removing retired Weiwall tables");
  try {
    await prisma.$transaction(async (tx) => {
      // A running old server can keep a table lock while its sync query is in
      // progress. Fail clearly instead of leaving deployment waiting forever.
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
      await tx.$executeRawUnsafe(RETIRED_TABLES_SQL);
    }, { timeout: 70_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to remove retired Weiwall tables: ${message}`);
  }
  console.log("[cleanup] Retired Weiwall tables removed");
}

async function cleanupRetiredBoard(boardId: number, topicIds: number[]) {
  return prisma.$transaction(async (tx) => {
    // Keep the entire set-based cleanup on one connection. Temporary tables
    // avoid large IN lists and let PostgreSQL plan each relation delete once.
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '840s'");
    await tx.$executeRawUnsafe(`
      CREATE TEMP TABLE "_CpuRetiredTopics" ON COMMIT DROP AS
      SELECT "id", "authorId"
      FROM "Topic"
      WHERE "boardId" = $1
    `, boardId);
    await tx.$executeRawUnsafe(`
      CREATE INDEX "_CpuRetiredTopics_id_idx" ON "_CpuRetiredTopics" ("id")
    `);
    await tx.$executeRawUnsafe(`
      CREATE TEMP TABLE "_CpuRetiredReplies" ON COMMIT DROP AS
      SELECT r."id", r."authorId"
      FROM "Reply" r
      INNER JOIN "_CpuRetiredTopics" t ON t."id" = r."topicId"
    `);
    await tx.$executeRawUnsafe(`
      CREATE INDEX "_CpuRetiredReplies_id_idx" ON "_CpuRetiredReplies" ("id")
    `);
    await tx.$executeRawUnsafe(`
      CREATE TEMP TABLE "_CpuRetiredUsers" ON COMMIT DROP AS
      SELECT "authorId" AS "id" FROM "_CpuRetiredTopics"
      UNION
      SELECT "authorId" AS "id" FROM "_CpuRetiredReplies"
    `);
    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "_CpuRetiredUsers_id_idx" ON "_CpuRetiredUsers" ("id")
    `);

    const replyCountRows = await tx.$queryRawUnsafe<{ count: bigint }>(`
      SELECT COUNT(*)::bigint AS count FROM "_CpuRetiredReplies"
    `);
    console.log(`[cleanup] Removing ${topicIds.length} topics and ${Number(replyCountRows[0]?.count ?? 0n)} replies`);

    const notifications = await tx.notification.deleteMany({
      where: { source: RETIRED_NOTIFICATION_SOURCE },
    });
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

    console.log("[cleanup] Removing retired board relations");
    const topicLikes = await tx.$executeRawUnsafe(`
      DELETE FROM "Like" l
      USING "_CpuRetiredTopics" t
      WHERE l."topicId" = t."id"
    `);
    const replyLikes = await tx.$executeRawUnsafe(`
      DELETE FROM "Like" l
      USING "_CpuRetiredReplies" r
      WHERE l."replyId" = r."id"
    `);
    const topicTags = await tx.$executeRawUnsafe(`
      DELETE FROM "TopicTag" t
      USING "_CpuRetiredTopics" rt
      WHERE t."topicId" = rt."id"
    `);
    const ratings = await tx.$executeRawUnsafe(`
      DELETE FROM "CourseRating" r
      USING "_CpuRetiredTopics" t
      WHERE r."topicId" = t."id"
    `);
    const schoolFeedItems = await tx.$executeRawUnsafe(`
      UPDATE "SchoolFeedItem" item
      SET "topicId" = NULL
      FROM "_CpuRetiredTopics" t
      WHERE item."topicId" = t."id"
    `);
    const marketItems = await tx.$executeRawUnsafe(`
      UPDATE "MarketItem" item
      SET "topicId" = NULL
      FROM "_CpuRetiredTopics" t
      WHERE item."topicId" = t."id"
    `);
    const lostFoundItems = await tx.$executeRawUnsafe(`
      DELETE FROM "LostFoundItem" item
      USING "_CpuRetiredTopics" t
      WHERE item."topicId" = t."id"
    `);
    const qqBotLogs = await tx.$executeRawUnsafe(`
      DELETE FROM "QqBotMessageLog" item
      USING "_CpuRetiredTopics" t
      WHERE item."topicId" = t."id"
    `);

    console.log("[cleanup] Removing retired replies and topics");
    const repliesDetached = await tx.$executeRawUnsafe(`
      UPDATE "Reply" reply
      SET "parentReplyId" = NULL
      FROM "_CpuRetiredReplies" retired
      WHERE reply."id" = retired."id"
    `);
    const repliesDeleted = await tx.$executeRawUnsafe(`
      DELETE FROM "Reply" reply
      USING "_CpuRetiredReplies" retired
      WHERE reply."id" = retired."id"
    `);
    const topicsDeleted = await tx.$executeRawUnsafe(`
      DELETE FROM "Topic" topic
      USING "_CpuRetiredTopics" retired
      WHERE topic."id" = retired."id"
    `);
    const boardDeleted = await tx.$executeRawUnsafe(
      'DELETE FROM "Board" WHERE "id" = $1',
      boardId,
    );

    console.log("[cleanup] Recalculating affected user counters");
    await tx.$executeRawUnsafe(`
      WITH topic_counts AS (
        SELECT "authorId", COUNT(*)::int AS "postCount"
        FROM "Topic"
        WHERE "hidden" = false
        GROUP BY "authorId"
      ), reply_counts AS (
        SELECT "authorId", COUNT(*)::int AS "replyCount"
        FROM "Reply"
        WHERE "hidden" = false
        GROUP BY "authorId"
      )
      UPDATE "User" u
      SET "postCount" = COALESCE(topic_counts."postCount", 0),
          "replyCount" = COALESCE(reply_counts."replyCount", 0)
      FROM "_CpuRetiredUsers" retired
      LEFT JOIN topic_counts ON topic_counts."authorId" = retired."id"
      LEFT JOIN reply_counts ON reply_counts."authorId" = retired."id"
      WHERE u."id" = retired."id"
    `);

    return {
      notificationsDeleted: notifications.count,
      likesDeleted: topicLikes + replyLikes,
      topicTagsDeleted: topicTags,
      ratingsDeleted: ratings,
      schoolFeedItemsDetached: schoolFeedItems,
      marketItemsDetached: marketItems,
      lostFoundItemsDeleted: lostFoundItems,
      qqBotLogsDeleted: qqBotLogs,
      repliesDetached,
      repliesDeleted,
      topicsDeleted,
      boardDeleted: boardDeleted > 0,
    };
  }, { timeout: 900_000, maxWait: 30_000 });
}

async function main() {
  // Older deployments may still have these feature-only tables. They are no
  // longer part of the Prisma schema, so remove them before deleting topics.
  await removeRetiredMirrorTables();

  console.log(`[cleanup] Checking retired board ${RETIRED_BOARD_SLUG}`);
  const board = await prisma.board.findUnique({
    where: { slug: RETIRED_BOARD_SLUG },
    select: { id: true, feedSourceId: true },
  });
  if (board?.feedSourceId) {
    throw new Error(`Refusing to delete ${RETIRED_BOARD_SLUG}: it is still linked to feed source ${board.feedSourceId}`);
  }

  const topics = board ? await prisma.topic.findMany({
    where: { boardId: board.id },
    select: { id: true },
  }) : [];
  const topicIds = topics.map((topic) => topic.id);
  if (!board) {
    const notifications = await prisma.notification.deleteMany({
      where: { source: RETIRED_NOTIFICATION_SOURCE },
    });
    console.log(JSON.stringify({
      board: RETIRED_BOARD_SLUG,
      notificationsDeleted: notifications.count,
      boardDeleted: false,
    }));
    return;
  }

  const result = await cleanupRetiredBoard(board.id, topicIds);

  console.log(JSON.stringify({
    board: RETIRED_BOARD_SLUG,
    notificationsDeleted: notifications.count,
    ...result,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
