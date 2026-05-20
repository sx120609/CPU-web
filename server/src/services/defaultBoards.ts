import { prisma } from "../prisma";
import { COMMUNITY_BOARD_DEFS, type CommunityBoardDefinition } from "./defaultBoardCatalog";

const BOOTSTRAP_BOARD_SLUGS = new Set<string>(["treehole"]);

export async function ensureBuiltinBoards() {
  const defs = COMMUNITY_BOARD_DEFS.filter((board) => BOOTSTRAP_BOARD_SLUGS.has(board.slug));
  if (!defs.length) return [] as CommunityBoardDefinition[];

  const existing = await prisma.board.findMany({
    where: { slug: { in: defs.map((board) => board.slug) } },
    select: { slug: true },
  });
  const existingSlugs = new Set(existing.map((board) => board.slug));
  let nextOrder = ((await prisma.board.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  }))?.order ?? -1) + 1;

  const created: CommunityBoardDefinition[] = [];
  for (const board of defs) {
    if (existingSlugs.has(board.slug)) continue;
    await prisma.board.create({
      data: {
        slug: board.slug,
        name: board.name,
        description: board.description,
        icon: board.icon,
        color: board.color,
        order: nextOrder++,
        type: board.type,
      },
    });
    created.push(board);
  }
  return created;
}
