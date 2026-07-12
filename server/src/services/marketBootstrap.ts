import { prisma } from "../prisma";

const MARKET_BOARD = {
  slug: "market",
  name: "商城",
  description: "实体商品 / 电子资料 / 校园好物",
  icon: "🛒",
  color: "#168c78",
  type: "market",
} as const;

const CONDITION_MAP: Record<string, string> = {
  "全新": "new",
  "九成新": "like_new",
  "八成新": "good",
  "七成新及以下": "fair",
  "求购": "wanted",
};
const MARKET_CONDITIONS = new Set(["new", "like_new", "good", "fair", "wanted"]);
const TRADE_MODE_MAP: Record<string, string> = {
  "当面": "meetup",
  "包邮": "shipping",
  "当面 / 包邮+5": "both",
};
const MARKET_TRADE_MODES = new Set(["meetup", "shipping", "both", "online"]);

type LegacyTopic = {
  id: number;
  authorId: number;
  title: string;
  content: string;
  metadata: string;
  hidden: boolean;
  locked: boolean;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
};

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function legacyPriceCents(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(2_147_483_647, Math.round(amount * 100));
}

function legacyCondition(value: unknown) {
  const raw = String(value ?? "").trim();
  return CONDITION_MAP[raw] || (MARKET_CONDITIONS.has(raw) ? raw : "good");
}

function legacyTradeMode(value: unknown) {
  const raw = String(value ?? "").trim();
  return TRADE_MODE_MAP[raw] || (MARKET_TRADE_MODES.has(raw) ? raw : "meetup");
}

function legacyCategory(topic: LegacyTopic, metadata: Record<string, unknown>) {
  const raw = String(metadata.category ?? "").trim();
  if (/^[a-z0-9][a-z0-9_-]{1,39}$/.test(raw)) return raw;
  return /(教材|课本|textbook|book)/i.test(topic.title) ? "books" : "other";
}

function legacyImages(metadata: Record<string, unknown>, content: string) {
  const urls: string[] = Array.isArray(metadata.images)
    ? metadata.images.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  for (const match of content.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (match[1]) urls.push(match[1]);
  }
  for (const match of content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (match[1]) urls.push(match[1]);
  }
  return Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean))).slice(0, 9);
}

async function migrateLegacyTopic(topic: LegacyTopic) {
  const metadata = parseMetadata(topic.metadata);
  const rawCondition = String(metadata.condition ?? "").trim();
  const listingType = metadata.listingType === "wanted" || rawCondition === "求购" || rawCondition === "wanted"
    ? "wanted"
    : "sell";
  const images = legacyImages(metadata, topic.content);

  await prisma.marketItem.create({
    data: {
      topicId: topic.id,
      sellerId: topic.authorId,
      listingType,
      title: topic.title,
      description: topic.content,
      category: legacyCategory(topic, metadata),
      priceCents: legacyPriceCents(metadata.price),
      negotiable: metadata.negotiable === true || metadata.negotiable === "true",
      condition: legacyCondition(metadata.condition),
      tradeMode: legacyTradeMode(metadata.tradeMode),
      campus: String(metadata.campus ?? "").trim().slice(0, 40),
      location: String(metadata.location ?? "").trim().slice(0, 100),
      status: topic.hidden ? "hidden" : topic.locked ? "withdrawn" : "active",
      viewCount: Math.max(0, topic.viewCount),
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
      images: images.length
        ? { create: images.map((url, sort) => ({ url, sort, createdAt: topic.createdAt })) }
        : undefined,
    },
  });
}

export async function bootstrapMarket() {
  const existingBoard = await prisma.board.findUnique({
    where: { slug: MARKET_BOARD.slug },
    select: { id: true },
  });
  const nextOrder = existingBoard
    ? 0
    : ((await prisma.board.findFirst({ orderBy: { order: "desc" }, select: { order: true } }))?.order ?? -1) + 1;
  const board = await prisma.board.upsert({
    where: { slug: MARKET_BOARD.slug },
    create: {
      ...MARKET_BOARD,
      order: nextOrder,
      readOnly: false,
      anonymousEnabled: false,
    },
    update: {
      name: MARKET_BOARD.name,
      description: MARKET_BOARD.description,
      icon: MARKET_BOARD.icon,
      color: MARKET_BOARD.color,
      type: MARKET_BOARD.type,
      readOnly: false,
      anonymousEnabled: false,
    },
  });
  await prisma.siteSetting.upsert({
    where: { key: "feature.market" },
    create: { key: "feature.market", value: "on" },
    update: {},
  });

  const topics = await prisma.topic.findMany({
    where: { boardId: board.id },
    select: {
      id: true,
      authorId: true,
      title: true,
      content: true,
      metadata: true,
      hidden: true,
      locked: true,
      viewCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!topics.length) return { boardId: board.id, migrated: 0, supplemented: 0, skipped: 0 };

  const existingItems = await prisma.marketItem.findMany({
    where: { topicId: { in: topics.map((topic) => topic.id) } },
    select: { id: true, topicId: true, images: { select: { id: true }, take: 1 } },
  });
  const migratedTopicIds = new Set(existingItems.map((item) => item.topicId).filter((id): id is number => id !== null));
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  let supplemented = 0;
  for (const item of existingItems) {
    if (!item.topicId || item.images.length) continue;
    const topic = topicsById.get(item.topicId);
    if (!topic) continue;
    const images = legacyImages(parseMetadata(topic.metadata), topic.content);
    if (!images.length) continue;
    await prisma.marketImage.createMany({
      data: images.map((url, sort) => ({ itemId: item.id, url, sort, createdAt: topic.createdAt })),
      skipDuplicates: true,
    });
    supplemented += 1;
  }
  let migrated = 0;
  let skipped = migratedTopicIds.size;
  for (const topic of topics) {
    if (migratedTopicIds.has(topic.id)) continue;
    try {
      await migrateLegacyTopic(topic);
      migrated += 1;
    } catch (error: any) {
      if (String(error?.code) === "P2002") {
        skipped += 1;
        continue;
      }
      console.warn(`[market] 回填旧二手帖子 ${topic.id} 失败`, error);
    }
  }
  return { boardId: board.id, migrated, supplemented, skipped };
}
