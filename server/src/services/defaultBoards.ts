import { prisma } from "../prisma";
import { COMMUNITY_BOARD_DEFS, type CommunityBoardDefinition } from "./defaultBoardCatalog";

const BOOTSTRAP_BOARD_SLUGS = new Set<string>(["treehole", "market"]);
const LEGACY_MARKET_NAMES = new Set(["商城", "校园商城"]);
const LEGACY_MARKET_DESCRIPTIONS = new Set([
  "实体商品、电子资料、校园好物",
  "实体商品 / 电子资料 / 校园好物",
]);

export async function ensureBuiltinBoards() {
  const defs = COMMUNITY_BOARD_DEFS.filter((board) => BOOTSTRAP_BOARD_SLUGS.has(board.slug));
  if (!defs.length) return [] as CommunityBoardDefinition[];

  const existing = await prisma.board.findMany({
    where: { slug: { in: defs.map((board) => board.slug) } },
    select: { slug: true, name: true, description: true, icon: true, type: true, readOnly: true },
  });
  const existingBySlug = new Map(existing.map((board) => [board.slug, board]));
  let nextOrder = ((await prisma.board.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  }))?.order ?? -1) + 1;

  const synchronized: CommunityBoardDefinition[] = [];
  for (const board of defs) {
    const current = existingBySlug.get(board.slug);
    if (current) {
      if (board.slug === "market") {
        const data: Record<string, unknown> = {};
        if (LEGACY_MARKET_NAMES.has(current.name)) data.name = board.name;
        if (LEGACY_MARKET_DESCRIPTIONS.has(current.description || "")) data.description = board.description;
        if (current.icon === "🛒") data.icon = board.icon;
        if (current.type !== "market") data.type = "market";
        if (current.readOnly) data.readOnly = false;
        if (Object.keys(data).length) {
          await prisma.board.update({ where: { slug: board.slug }, data });
          synchronized.push(board);
        }
      }
      continue;
    }
    await prisma.board.create({
      data: {
        slug: board.slug,
        name: board.name,
        description: board.description,
        icon: board.icon,
        color: board.color,
        order: nextOrder++,
        type: board.type,
        anonymousEnabled: Boolean(board.anonymousEnabled),
      },
    });
    synchronized.push(board);
  }
  return synchronized;
}
