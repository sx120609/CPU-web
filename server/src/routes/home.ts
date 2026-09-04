import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";
import { withCache } from "../services/cache";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { enabledBoardTypes, getGlobalPinnedTopicIds } from "../services/siteSettings";
import { resolveForumAccess } from "../services/forumAccess";
import { decodeTopicForViewer, decodeTopicsForViewerForList, forumAuthorReputationSelect, forumReplyPreviewInclude } from "../services/forumPresentation";
import { buildUserTrustSnapshot } from "../services/userTrust";
import { visibleBoardSlugFilter } from "../services/retiredBoards";
import { FORUM_SELF_VISIBLE_REVIEW_STATUSES, forumContentVisibilityWhere } from "../services/forumSubmission";
import { compactTopicAuthors, publicAvatarValue } from "../utils/publicAvatar";
import { parseHomeFeedStream, selectHomeFeedBoardTypes, type HomeFeedStream } from "../services/homeFeed";
import {
  computeHotScore,
  HOT_TOPIC_FALLBACK_WINDOW_MS,
  rankHotTopics,
} from "../services/forumHotRanking";

export const homeRouter = Router();
const HOME_HIDDEN_SERVICE_CODES = ["DORM_REPAIR"];
const HOT_TOPIC_DEFAULT_SIZE = 10;
const LATEST_FEED_DEFAULT_SIZE = 20;
function homeFeedBoardTypes(stream: HomeFeedStream) {
  return selectHomeFeedBoardTypes(enabledBoardTypes(), stream);
}

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
    const forumBoardTypes = homeFeedBoardTypes("forum");
    const globalPinnedIds = getGlobalPinnedTopicIds();
    const publicSummary = await withCache(
      "home",
      ["summary-v7", forumAccessEnabled ? "forum-enabled" : "announce-only"],
      60_000,
      async () => {
        const [pinnedTopics, hotTopics, latestTopics, announce, services] = await Promise.all([
          forumAccessEnabled ? listGlobalPinnedTopics(globalPinnedIds, forumBoardTypes, 6) : Promise.resolve([]),
          forumAccessEnabled ? listHotTopics(6, forumBoardTypes) : Promise.resolve([]),
          forumAccessEnabled ? prisma.topic.findMany({
            where: { hidden: false, board: { type: { in: forumBoardTypes }, ...visibleBoardSlugFilter() } },
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              board: { select: { slug: true, name: true, color: true, type: true } },
              author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true, verificationType: true, verificationLabel: true, verificationVerifiedAt: true, verificationExpiresAt: true, ...forumAuthorReputationSelect } },
              tags: { include: { tag: true } },
              replies: forumReplyPreviewInclude,
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
        board: { type: { in: forumBoardTypes }, ...visibleBoardSlugFilter() },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        board: { select: { slug: true, name: true, color: true, type: true } },
        author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true, verificationType: true, verificationLabel: true, verificationVerifiedAt: true, verificationExpiresAt: true, ...forumAuthorReputationSelect } },
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
        hotScore: computeHotScore(item),
        ...decodeTopicForViewer(item, req.user),
      })) : [],
      latestTopics: forumAccessEnabled ? await decodeTopicsForViewerForList(latestTopics, req.user) : [],
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
    const stream = parseHomeFeedStream(_req.query.stream);
    const contentBoardTypes = homeFeedBoardTypes(stream);
    const list = await withCache("home", ["hot-ranking-v6", stream], 60_000, async () => listHotTopics(HOT_TOPIC_DEFAULT_SIZE, contentBoardTypes));
    const presented = await decodeTopicsForViewerForList(list, _req.user);
    ok(res, presented.map((item, index) => ({
      rank: index + 1,
      hotScore: computeHotScore(list[index]),
      ...item,
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
    const stream = parseHomeFeedStream(req.query.stream);
    const contentBoardTypes = homeFeedBoardTypes(stream);
    const globalPinnedIds = getGlobalPinnedTopicIds();
    const where = {
      ...forumContentVisibilityWhere(userId),
      board: { type: { in: contentBoardTypes }, ...visibleBoardSlugFilter() },
    };
    const cached = await withCache("home", ["latest-feed-v7", stream, userId ? `viewer-${userId}` : "public", page, size], 60_000, async () => {
      const [pins, list, total] = await Promise.all([
        listGlobalPinnedTopics(globalPinnedIds, contentBoardTypes, 20),
        prisma.topic.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * size,
          take: size,
          include: {
            board: { select: { slug: true, name: true, color: true, type: true } },
            author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true, verificationType: true, verificationLabel: true, verificationVerifiedAt: true, verificationExpiresAt: true, ...forumAuthorReputationSelect } },
            tags: { include: { tag: true } },
            replies: forumReplyPreviewInclude,
          },
        }).then(compactTopicAuthors),
        prisma.topic.count({ where }),
      ]);
      return { pins, list, total };
    });
    const [pins, list] = await Promise.all([
      Promise.resolve(cached.pins.map((item: any) => decodeTopicForViewer(item, req.user))),
      decodeTopicsForViewerForList(cached.list, req.user),
    ]);
    ok(res, {
      page,
      size,
      total: cached.total,
      pins,
      list,
    });
  } catch (e) { next(e); }
});

async function listGlobalPinnedTopics(ids: number[], boardTypes: string[], limit = ids.length || 20) {
  const orderedIds = ids.slice(0, Math.max(0, limit));
  if (!orderedIds.length) return [];
  const include = {
    board: { select: { slug: true, name: true, color: true, type: true } },
    author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true, verificationType: true, verificationLabel: true, verificationVerifiedAt: true, verificationExpiresAt: true, ...forumAuthorReputationSelect } },
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
  const nowMs = Date.now();
  const cutoff = new Date(nowMs - HOT_TOPIC_FALLBACK_WINDOW_MS);
  const include = {
    board: { select: { slug: true, name: true, color: true, type: true } },
    author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true, verificationType: true, verificationLabel: true, verificationVerifiedAt: true, verificationExpiresAt: true, ...forumAuthorReputationSelect } },
    tags: { include: { tag: true } },
    replies: forumReplyPreviewInclude,
  } as const;
  const candidates = await prisma.topic.findMany({
    where: {
      hidden: false,
      board: { type: { in: boardTypes }, ...visibleBoardSlugFilter() },
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(100, size * 20),
    include,
  });
  return compactTopicAuthors(rankHotTopics(candidates, size, nowMs));
}
