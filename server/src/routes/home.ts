import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";
import { verifyToken } from "../utils/jwt";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";

export const homeRouter = Router();

/**
 * 首页摘要：热帖 + 板块最新 + 学校公告 + 服务卡片 + 个人未读
 * - 已登录：返回 identity / unreadCount
 * - 游客：identity = null，其他公开内容仍返回
 */
homeRouter.get("/summary", async (req, res, next) => {
  try {
    // 软鉴权：尝试解析 token，失败/缺失不报错
    let userId: number | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try { userId = verifyToken(auth.slice(7)).userId; } catch { /* token 无效，按游客处理 */ }
    }

    const [user, hotTopics, latestTopics, announce, services, personalUnread, globalReads, globalCount] = await Promise.all([
      userId ? prisma.user.findUnique({ where: { id: userId } }) : Promise.resolve(null),
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
        include: { board: { select: { slug: true, name: true } } },
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
        unreadCount,
      } : null,
      hotTopics: hotTopics.map(decode),
      latestTopics: latestTopics.map(decode),
      announce: announce.map(decode),
      services: services.map(normalizeServiceCard),
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
