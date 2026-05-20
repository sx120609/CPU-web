import { prisma } from "../src/prisma";
import { refreshBoardTopicCounts, refreshUserPostCount } from "../src/services/forumStats";

async function main() {
  const [boards, users] = await Promise.all([
    prisma.board.findMany({
      select: { id: true, slug: true, name: true },
      orderBy: { id: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    }),
  ]);

  await refreshBoardTopicCounts(boards.map((board) => board.id));
  await Promise.all(users.map((user) => refreshUserPostCount(user.id)));

  const boardStats = await Promise.all(
    boards.map(async (board) => ({
      ...board,
      topicCount: await prisma.topic.count({
        where: { boardId: board.id, hidden: false },
      }),
    })),
  );

  console.log(`已重算 ${boardStats.length} 个板块、${users.length} 个用户的论坛统计`);
  for (const board of boardStats) {
    console.log(`${board.slug} (${board.name}): ${board.topicCount}`);
  }
}

main()
  .catch((error) => {
    console.error("重算论坛统计失败:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
