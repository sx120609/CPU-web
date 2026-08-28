import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";
import { withCache } from "../services/cache";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { enabledBoardTypes, getGlobalPinnedTopicIds } from "../services/siteSettings";
import { resolveForumAccess } from "../services/forumAccess";
import { decodeTopicForViewer } from "../services/forumPresentation";
import { buildUserTrustSnapshot } from "../services/userTrust";
import { visibleBoardSlugFilter } from "../services/retiredBoards";
import { FORUM_SELF_VISIBLE_REVIEW_STATUSES, forumContentVisibilityWhere } from "../services/forumSubmission";
import { compactTopicAuthors, publicAvatarValue } from "../utils/publicAvatar";

export const homeRouter = Router();
const HOME_HIDDEN_SERVICE_CODES = ["DORM_REPAIR"];
const HOT_TOPIC_DEFAULT_SIZE = 10;
const LATEST_FEED_DEFAULT_SIZE = 20;

/**
 * 首页摘要：热榜 + 最新聚合 + 学校公告 + 服务卡片 + 个人未读
 * - 已登录：返回 identity / unreadCount
 * - 游客：identity = null，其他公开内容仍返回
 */
homeRouter.get("/summary", async (req, res, next) => {
  try {
    const userId = req.user?.userId ?? null;
    const role = req.user?.role ?? null;

    const [user, personalUnread, globalReads, globalCount] = await Promise.all([
      userId ? prisma.user.findUnique({ where: { id: userId } }) : Promise.resolve(null),
      userId ? prisma.notification.count({ where: { userId, readAt: null } }) : Promise.resolve(0),
      userId ? prisma.notificationRead.findMany({ where: { userId }, select: { notificationId: true } }) : Promise.resolve([]),
      userId ? prisma.notification.count({ where: { userId: null } }) : Promise.resolve(0),
    ]);
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    const trust = user ? buildUserTrustSnapshot(user) : null;
    const readableBoardTypes = enabledBoardTypes();
    const contentBoardTypes = readableBoardTypes.filter((type) => type !== "announce");
    const globalPinnedIds = getGlobalPinnedTopicIds();
    const publicSummary = await withCache(
      "home",
      ["summary-v2", forumAccessEnabled ? "forum-enabled" : "announce-only"],
      60_000,
      async () => {
        const [pinnedTopics, hotTopics, latestTopics, announce, services] = await Promise.all([
          forumAccessEnabled ? listGlobalPinnedTopics(globalPinnedIds, contentBoardTypes, 6) : Promise.resolve([]),
          forumAccessEnabled ? listHotTopics(6, contentBoardTypes) : Promise.resolve([]),
          forumAccessEnabled ? prisma.topic.findMany({
            where: { hidden: false, id: { notIn: globalPinnedIds }, board: { type: { in: contentBoardTypes }, ...visibleBoardSlugFilter() } },
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              board: { select: { slug: true, name: true, color: true, type: true } },
              author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
              tags: { include: { tag: true } },
            },
          }).then(compactTopicAuthors) : Promise.resolve([]),
          prisma.topic.findMany({
            where: { hidden: false, board: { readOnly: true, ...visibleBoardSlugFilter() } },
            orderBy: { createdAt: "desc" },
            take: 8,
            include: { board: { select: { slug: true, name: true } }, tags: { include: { tag: true } } },
          }),
          prisma.serviceCard.findMany({
            where: visibleServiceWhere(),
            orderBy: [{ order: "asc" }, { id: "asc" }],
            take: 8,
          }),
        ]);
        return { pinnedTopics, hotTopics, latestTopics, announce, services };
      },
    );
    const ownReviewTopics = forumAccessEnabled && userId ? await prisma.topic.findMany({
      where: {
        hidden: true,
        authorId: userId,
        aiReviewStatus: { in: [...FORUM_SELF_VISIBLE_REVIEW_STATUSES] },
        id: { notIn: globalPinnedIds },
        board: { type: { in: contentBoardTypes }, ...visibleBoardSlugFilter() },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        board: { select: { slug: true, name: true, color: true, type: true } },
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
        tags: { include: { tag: true } },
      },
    }) : [];
    const latestTopics = [...ownReviewTopics, ...publicSummary.latestTopics]
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);

    const unreadCount = personalUnread + (globalCount - (globalReads as any[]).length);

    ok(res, {
      identity: user ? {
        id: user.id,
        nickname: user.nickname,
        avatar: publicAvatarValue(user),
        college: user.college,
        role: user.role,
        postCount: user.postCount,
        replyCount: user.replyCount,
        reputation: trust?.reputation ?? 0,
        forumEnabled: forumAccessEnabled,
        unreadCount,
      } : null,
      pinnedTopics: forumAccessEnabled ? publicSummary.pinnedTopics.map((item: any) => decodeTopicForViewer(item, req.user)) : [],
      hotTopics: forumAccessEnabled ? publicSummary.hotTopics.map((item: any, index: number) => ({
        rank: index + 1,
        hotScore: computeHotScore(item, isRecentTopic(item)),
        ...decodeTopicForViewer(item, req.user),
      })) : [],
      latestTopics: forumAccessEnabled ? latestTopics.map((item: any) => decodeTopicForViewer(item, req.user)) : [],
      announce: publicSummary.announce.map((item: any) => decodeTopicForViewer(item, req.user)),
      services: publicSummary.services
        .filter((s) => !HOME_HIDDEN_SERVICE_CODES.includes(s.code))
        .map(normalizeServiceCard),
    });
  } catch (e) { next(e); }
});

homeRouter.get("/hot-ranking", async (_req, res, next) => {
  try {
    const userId = _req.user?.userId ?? null;
    const role = _req.user?.role ?? null;
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    if (!forumAccessEnabled) return ok(res, []);
    const contentBoardTypes = enabledBoardTypes().filter((type) => type !== "announce");
    const list = await withCache("home", ["hot-ranking-v2"], 60_000, async () => listHotTopics(HOT_TOPIC_DEFAULT_SIZE, contentBoardTypes));
    ok(res, list.map((item, index) => ({
      rank: index + 1,
      hotScore: computeHotScore(item, isRecentTopic(item)),
      ...decodeTopicForViewer(item, _req.user),
    })));
  } catch (e) { next(e); }
});

homeRouter.get("/latest-feed", async (req, res, next) => {
  try {
    const userId = req.user?.userId ?? null;
    const role = req.user?.role ?? null;
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    if (!forumAccessEnabled) return ok(res, { page: 1, size: LATEST_FEED_DEFAULT_SIZE, total: 0, pins: [], list: [] });
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(10, Number(req.query.size ?? LATEST_FEED_DEFAULT_SIZE)));
    const contentBoardTypes = enabledBoardTypes().filter((type) => type !== "announce");
    const globalPinnedIds = getGlobalPinnedTopicIds();
    const where = {
      ...forumContentVisibilityWhere(userId),
      id: { notIn: globalPinnedIds },
      board: { type: { in: contentBoardTypes }, ...visibleBoardSlugFilter() },
    };
    const cached = await withCache("home", ["latest-feed-v3", userId ? `viewer-${userId}` : "public", page, size], 60_000, async () => {
      const [pins, list, total] = await Promise.all([
        listGlobalPinnedTopics(globalPinnedIds, contentBoardTypes, 20),
        prisma.topic.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * size,
          take: size,
          include: {
            board: { select: { slug: true, name: true, color: true, type: true } },
            author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
            tags: { include: { tag: true } },
          },
        }).then(compactTopicAuthors),
        prisma.topic.count({ where }),
      ]);
      return { pins, list, total };
    });
    ok(res, {
      page,
      size,
      total: cached.total,
      pins: cached.pins.map((item: any) => decodeTopicForViewer(item, req.user)),
      list: cached.list.map((item: any) => decodeTopicForViewer(item, req.user)),
    });
  } catch (e) { next(e); }
});

async function listGlobalPinnedTopics(ids: number[], boardTypes: string[], limit = ids.length || 20) {
  const orderedIds = ids.slice(0, Math.max(0, limit));
  if (!orderedIds.length) return [];
  const include = {
    board: { select: { slug: true, name: true, color: true, type: true } },
    author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
    tags: { include: { tag: true } },
  } as const;
  const rows = compactTopicAuthors(await prisma.topic.findMany({
      where: {
        id: { in: orderedIds },
        hidden: false,
        board: { type: { in: boardTypes }, ...visibleBoardSlugFilter() },
      },
    include,
  }));
  const byId = new Map(rows.map((item) => [item.id, item]));
  return orderedIds.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
}

async function listHotTopics(size: number, boardTypes: string[]) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const include = {
    board: { select: { slug: true, name: true, color: true, type: true } },
    author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true } },
    tags: { include: { tag: true } },
  } as const;
  const [recent, older] = await Promise.all([
    prisma.topic.findMany({
      where: {
        hidden: false,
        board: { type: { in: boardTypes }, ...visibleBoardSlugFilter() },
        lastReplyAt: { gte: cutoff },
      },
      orderBy: [{ likeCount: "desc" }, { replyCount: "desc" }, { viewCount: "desc" }],
      take: 60,
      include,
    }),
    prisma.topic.findMany({
      where: {
        hidden: false,
        board: { type: { in: boardTypes }, ...visibleBoardSlugFilter() },
        OR: [{ lastReplyAt: null }, { lastReplyAt: { lt: cutoff } }],
      },
      orderBy: [{ likeCount: "desc" }, { replyCount: "desc" }, { viewCount: "desc" }],
      take: 60,
      include,
    }),
  ]);

  const recentSorted = [...recent].sort((a, b) => computeHotScore(b, true) - computeHotScore(a, true));
  const olderSorted = [...older].sort((a, b) => computeHotScore(b, false) - computeHotScore(a, false));
  const merged = recentSorted.slice(0, size);
  if (merged.length < size) {
    merged.push(...olderSorted.slice(0, size - merged.length));
  }
  return compactTopicAuthors(merged);
}

function computeHotScore(topic: any, recent: boolean) {
  const raw = (topic.likeCount ?? 0) * 5 + (topic.replyCount ?? 0) * 3 + (topic.viewCount ?? 0) * 0.03;
  return recent ? raw : raw * 0.72;
}

function isRecentTopic(topic: any) {
  const last = topic.lastReplyAt ? new Date(topic.lastReplyAt).getTime() : 0;
  return last >= Date.now() - 24 * 60 * 60 * 1000;
}
