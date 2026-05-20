import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";
import { verifyToken } from "../utils/jwt";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { enabledBoardTypes } from "../services/siteSettings";
import { isForumStaffRole, resolveForumAccess } from "../services/forumAccess";

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
    let userId: number | null = null;
    let role: string | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const token = verifyToken(auth.slice(7));
        userId = token.userId;
        role = token.role;
      } catch { /* ignore */ }
    }

    const readableBoardTypes = enabledBoardTypes();
    const contentBoardTypes = readableBoardTypes.filter((type) => type !== "announce");
    const [user, hotTopics, latestTopics, announce, services, personalUnread, globalReads, globalCount] = await Promise.all([
      userId ? prisma.user.findUnique({ where: { id: userId } }) : Promise.resolve(null),
      listHotTopics(6, contentBoardTypes),
      prisma.topic.findMany({
        where: { hidden: false, board: { type: { in: contentBoardTypes } } },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          board: { select: { slug: true, name: true, color: true, type: true } },
          author: { select: { nickname: true, avatar: true } },
          tags: { include: { tag: true } },
        },
      }),
      prisma.topic.findMany({
        where: { hidden: false, board: { readOnly: true } },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { board: { select: { slug: true, name: true } }, tags: { include: { tag: true } } },
      }),
      prisma.serviceCard.findMany({
        where: visibleServiceWhere(),
        orderBy: [{ order: "asc" }, { id: "asc" }],
        take: 8,
      }),
      userId ? prisma.notification.count({ where: { userId, readAt: null } }) : Promise.resolve(0),
      userId ? prisma.notificationRead.findMany({ where: { userId }, select: { notificationId: true } }) : Promise.resolve([]),
      userId ? prisma.notification.count({ where: { userId: null } }) : Promise.resolve(0),
    ]);
    const forumAccessEnabled = user ? (isForumStaffRole(user.role) || user.forumEnabled) : await resolveForumAccess(userId, role);

    const unreadCount = personalUnread + (globalCount - (globalReads as any[]).length);

    ok(res, {
      identity: user ? {
        id: user.id,
        nickname: user.nickname,
        avatar: user.avatar,
        college: user.college,
        role: user.role,
        postCount: user.postCount,
        replyCount: user.replyCount,
        reputation: user.reputation,
        forumEnabled: forumAccessEnabled,
        unreadCount,
      } : null,
      hotTopics: forumAccessEnabled ? hotTopics.map((item, index) => ({
        rank: index + 1,
        hotScore: computeHotScore(item, isRecentTopic(item)),
        ...decode(item),
      })) : [],
      latestTopics: forumAccessEnabled ? latestTopics.map(decode) : [],
      announce: announce.map(decode),
      services: services
        .filter((s) => !HOME_HIDDEN_SERVICE_CODES.includes(s.code))
        .map(normalizeServiceCard),
    });
  } catch (e) { next(e); }
});

homeRouter.get("/hot-ranking", async (_req, res, next) => {
  try {
    let userId: number | null = null;
    let role: string | null = null;
    const auth = _req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const token = verifyToken(auth.slice(7));
        userId = token.userId;
        role = token.role;
      } catch { /* ignore */ }
    }
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    if (!forumAccessEnabled) return ok(res, []);
    const contentBoardTypes = enabledBoardTypes().filter((type) => type !== "announce");
    const list = await listHotTopics(HOT_TOPIC_DEFAULT_SIZE, contentBoardTypes);
    ok(res, list.map((item, index) => ({
      rank: index + 1,
      hotScore: computeHotScore(item, isRecentTopic(item)),
      ...decode(item),
    })));
  } catch (e) { next(e); }
});

homeRouter.get("/latest-feed", async (req, res, next) => {
  try {
    let userId: number | null = null;
    let role: string | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const token = verifyToken(auth.slice(7));
        userId = token.userId;
        role = token.role;
      } catch { /* ignore */ }
    }
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    if (!forumAccessEnabled) return ok(res, { page: 1, size: LATEST_FEED_DEFAULT_SIZE, total: 0, list: [] });
    const page = Math.max(1, Number(req.query.page ?? 1));
    const size = Math.min(50, Math.max(10, Number(req.query.size ?? LATEST_FEED_DEFAULT_SIZE)));
    const contentBoardTypes = enabledBoardTypes().filter((type) => type !== "announce");
    const where = { hidden: false, board: { type: { in: contentBoardTypes } } } as const;
    const [list, total] = await Promise.all([
      prisma.topic.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * size,
        take: size,
        include: {
          board: { select: { slug: true, name: true, color: true, type: true } },
          author: { select: { nickname: true, avatar: true } },
          tags: { include: { tag: true } },
        },
      }),
      prisma.topic.count({ where }),
    ]);
    ok(res, { page, size, total, list: list.map(decode) });
  } catch (e) { next(e); }
});

async function listHotTopics(size: number, boardTypes: string[]) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const include = {
    board: { select: { slug: true, name: true, color: true, type: true } },
    author: { select: { nickname: true, avatar: true } },
    tags: { include: { tag: true } },
  } as const;
  const [recent, older] = await Promise.all([
    prisma.topic.findMany({
      where: {
        hidden: false,
        board: { type: { in: boardTypes } },
        lastReplyAt: { gte: cutoff },
      },
      orderBy: [{ likeCount: "desc" }, { replyCount: "desc" }, { viewCount: "desc" }],
      take: 60,
      include,
    }),
    prisma.topic.findMany({
      where: {
        hidden: false,
        board: { type: { in: boardTypes } },
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
  return merged;
}

function computeHotScore(topic: any, recent: boolean) {
  const raw = (topic.likeCount ?? 0) * 5 + (topic.replyCount ?? 0) * 3 + (topic.viewCount ?? 0) * 0.03;
  return recent ? raw : raw * 0.72;
}

function isRecentTopic(topic: any) {
  const last = topic.lastReplyAt ? new Date(topic.lastReplyAt).getTime() : 0;
  return last >= Date.now() - 24 * 60 * 60 * 1000;
}

function decode(t: any) {
  return {
    ...t,
    metadata: safeJson(t.metadata),
    tags: Array.isArray(t.tags)
      ? t.tags
          .map((item: any) => item?.tag ? { id: item.tag.id, name: item.tag.name } : item)
          .filter((item: any) => item?.name)
      : [],
  };
}

function safeJson(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
