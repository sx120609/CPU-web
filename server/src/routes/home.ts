import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";

export const homeRouter = Router();

/**
 * 首页摘要：热帖 + 各板块最新 + 学校公告 + 服务卡片 + 个人未读
 */
homeRouter.get("/summary", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const [user, hotTopics, latestTopics, announce, services, personalUnread, globalReads, globalCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.topic.findMany({
        where: { hidden: false },
        orderBy: [{ pinned: "desc" }, { likeCount: "desc" }, { replyCount: "desc" }],
        take: 6,
        include: {
          board: { select: { slug: true, name: true, color: true } },
          author: { select: { nickname: true, avatar: true } },
        },
      }),
      prisma.topic.findMany({
        where: { hidden: false, board: { readOnly: false } },
        orderBy: { lastReplyAt: "desc" },
        take: 10,
        include: {
          board: { select: { slug: true, name: true, color: true } },
          author: { select: { nickname: true, avatar: true } },
        },
      }),
      prisma.topic.findMany({
        where: { hidden: false, board: { readOnly: true } },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          board: { select: { slug: true, name: true } },
        },
      }),
      prisma.serviceCard.findMany({
        where: { hidden: false },
        orderBy: [{ order: "asc" }, { id: "asc" }],
        take: 8,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
      prisma.notificationRead.findMany({ where: { userId }, select: { notificationId: true } }),
      prisma.notification.count({ where: { userId: null } }),
    ]);

    const unreadCount = personalUnread + (globalCount - globalReads.length);

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
        unreadCount,
      } : null,
      hotTopics: hotTopics.map(decode),
      latestTopics: latestTopics.map(decode),
      announce: announce.map(decode),
      services,
    });
  } catch (e) { next(e); }
});

function decode(t: any) {
  return { ...t, metadata: safeJson(t.metadata) };
}
function safeJson(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
