import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, HttpError, ok } from "../utils/response";
import { ensureCanReadBoardType } from "../services/forumAccess";
import { featureClosedMessage, isBoardTypeEnabled, removeTopicFromGlobalPins } from "../services/siteSettings";
import { isRetiredBoardSlug } from "../services/retiredBoards";
import { invalidateForumCaches } from "../services/cacheInvalidation";
import {
  refreshBoardTopicCounts,
  refreshTopicReplyStats,
  refreshUserPostCount,
  refreshUserReplyCount,
} from "../services/forumStats";
import {
  FORUM_REPORT_REASONS,
  FORUM_REPORT_TARGET_TYPES,
  forumReportEligibility,
  forumReportReasonLabel,
  forumReportTargetUrl,
  shouldAutoHideReportedContent,
  shouldRestoreAutoHiddenContent,
  type ForumReportReason,
  type ForumReportTargetType,
} from "../services/forumReportPolicy";

export const forumReportRouter = Router();
export const forumReportAdminRouter = Router();

const createSchema = z.object({
  targetType: z.enum(FORUM_REPORT_TARGET_TYPES),
  targetId: z.number().int().positive(),
  reason: z.enum(FORUM_REPORT_REASONS),
  detail: z.string().trim().max(1000, "补充说明不能超过 1000 字").optional().default(""),
});

const listSchema = z.object({
  status: z.enum(["pending", "resolved", "rejected", "all"]).optional().default("pending"),
  targetType: z.enum([...FORUM_REPORT_TARGET_TYPES, "all"] as const).optional().default("all"),
  page: z.coerce.number().int().min(1).optional().default(1),
  size: z.coerce.number().int().min(1).max(100).optional().default(30),
});

const handleSchema = z.object({
  status: z.enum(["resolved", "rejected"]),
  note: z.string().trim().max(1000, "处理说明不能超过 1000 字").optional().default(""),
});

type ReportTarget = {
  targetAuthorId: number;
  targetLabel: string;
  contentSnapshot: string;
  topicId?: number | null;
};

function shortLabel(value: unknown, fallback: string) {
  const normalized = String(value || "").replace(/\s+/gu, " ").trim();
  return (normalized || fallback).slice(0, 160);
}

async function resolveTopicReportTarget(
  reporterId: number,
  reporterRole: string,
  targetId: number,
): Promise<ReportTarget> {
  const topic = await prisma.topic.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      authorId: true,
      title: true,
      content: true,
      hidden: true,
      board: { select: { slug: true, type: true } },
    },
  });
  if (!topic || topic.hidden || isRetiredBoardSlug(topic.board.slug)) throw Errors.notFound("帖子不存在或已不可见");
  if (!isBoardTypeEnabled(topic.board.type)) throw Errors.forbidden(featureClosedMessage(topic.board.type));
  await ensureCanReadBoardType(topic.board.type, reporterId, reporterRole);
  const ineligible = forumReportEligibility({ targetType: "topic", reporterId, targetAuthorId: topic.authorId });
  if (ineligible) throw Errors.badRequest(ineligible);
  return {
    targetAuthorId: topic.authorId,
    targetLabel: shortLabel(topic.title, `帖子 #${topic.id}`),
    contentSnapshot: `${topic.title}\n\n${topic.content}`.slice(0, 24_000),
    topicId: topic.id,
  };
}

async function resolveReplyReportTarget(
  reporterId: number,
  reporterRole: string,
  targetId: number,
): Promise<ReportTarget> {
  const reply = await prisma.reply.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      authorId: true,
      content: true,
      hidden: true,
      topic: {
        select: {
          id: true,
          title: true,
          hidden: true,
          board: { select: { slug: true, type: true } },
        },
      },
    },
  });
  if (!reply || reply.hidden || reply.topic.hidden || isRetiredBoardSlug(reply.topic.board.slug)) {
    throw Errors.notFound("评论不存在或已不可见");
  }
  if (!isBoardTypeEnabled(reply.topic.board.type)) throw Errors.forbidden(featureClosedMessage(reply.topic.board.type));
  await ensureCanReadBoardType(reply.topic.board.type, reporterId, reporterRole);
  const ineligible = forumReportEligibility({ targetType: "reply", reporterId, targetAuthorId: reply.authorId });
  if (ineligible) throw Errors.badRequest(ineligible);
  return {
    targetAuthorId: reply.authorId,
    targetLabel: shortLabel(`“${reply.topic.title}”中的评论`, `评论 #${reply.id}`),
    contentSnapshot: reply.content.slice(0, 24_000),
    topicId: reply.topic.id,
  };
}

async function resolveDirectMessageReportTarget(reporterId: number, targetId: number): Promise<ReportTarget> {
  const message = await prisma.directMessage.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      senderId: true,
      content: true,
      conversation: { select: { id: true, participantLowId: true, participantHighId: true } },
    },
  });
  if (!message) throw Errors.notFound("私聊消息不存在");
  const reporterIsParticipant = message.conversation.participantLowId === reporterId
    || message.conversation.participantHighId === reporterId;
  const ineligible = forumReportEligibility({
    targetType: "direct_message",
    reporterId,
    targetAuthorId: message.senderId,
    reporterIsParticipant,
  });
  if (ineligible) throw Errors.badRequest(ineligible);
  return {
    targetAuthorId: message.senderId,
    targetLabel: `私聊消息 #${message.id}`,
    contentSnapshot: message.content,
  };
}

async function resolveReportTarget(
  targetType: ForumReportTargetType,
  targetId: number,
  reporterId: number,
  reporterRole: string,
) {
  if (targetType === "topic") return resolveTopicReportTarget(reporterId, reporterRole, targetId);
  if (targetType === "reply") return resolveReplyReportTarget(reporterId, reporterRole, targetId);
  return resolveDirectMessageReportTarget(reporterId, targetId);
}

forumReportRouter.post(
  "/",
  validate(createSchema),
  async (req, res, next) => {
    try {
      const reporterId = req.user!.userId;
      const { targetType, targetId, reason, detail } = req.body as z.infer<typeof createSchema>;
      const recentCount = await prisma.forumReport.count({
        where: { reporterId, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      if (recentCount >= 20) throw new HttpError(429, 4029, "举报提交过于频繁，请稍后再试");
      const target = await resolveReportTarget(targetType, targetId, reporterId, req.user!.role);
      const created = await prisma.$transaction(async (tx) => {
        const lockNamespace = targetType === "topic" ? 73101 : targetType === "reply" ? 73102 : 73103;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockNamespace}, ${targetId})`;
        const report = await tx.forumReport.create({
          data: {
            reporterId,
            targetAuthorId: target.targetAuthorId,
            targetType,
            targetId,
            targetLabel: target.targetLabel,
            contentSnapshot: target.contentSnapshot,
            reason,
            detail,
          },
        }).catch((error: unknown) => {
          if (String((error as { code?: unknown })?.code || "") === "P2002") {
            throw Errors.conflict("你已经举报过这条内容，管理员会尽快处理");
          }
          throw error;
        });
        const activeReportCount = await tx.forumReport.count({
          where: { targetType, targetId, status: { not: "rejected" } },
        });
        let autoHidden = false;
        if (shouldAutoHideReportedContent(targetType, activeReportCount) && targetType === "topic") {
          const topic = await tx.topic.findUnique({
            where: { id: targetId },
            select: {
              id: true,
              boardId: true,
              authorId: true,
              hidden: true,
              marketItem: { select: { id: true, status: true } },
            },
          });
          if (topic && !topic.hidden) {
            await tx.topic.update({ where: { id: topic.id }, data: { hidden: true, reportHiddenAt: new Date() } });
            if (topic.marketItem?.status === "active") {
              await tx.marketItem.update({ where: { id: topic.marketItem.id }, data: { status: "hidden" } });
            }
            await Promise.all([
              refreshBoardTopicCounts([topic.boardId], tx),
              refreshUserPostCount(topic.authorId, tx),
            ]);
            autoHidden = true;
          }
        }
        if (shouldAutoHideReportedContent(targetType, activeReportCount) && targetType === "reply") {
          const reply = await tx.reply.findUnique({
            where: { id: targetId },
            select: { id: true, topicId: true, authorId: true, hidden: true },
          });
          if (reply && !reply.hidden) {
            await tx.reply.update({ where: { id: reply.id }, data: { hidden: true, reportHiddenAt: new Date() } });
            await Promise.all([
              refreshTopicReplyStats(reply.topicId, tx),
              refreshUserReplyCount(reply.authorId, tx),
            ]);
            autoHidden = true;
          }
        }
        return { report, activeReportCount, autoHidden };
      });
      const { report, activeReportCount, autoHidden } = created;
      if (autoHidden) {
        if (targetType === "topic") await removeTopicFromGlobalPins(targetId);
        await invalidateForumCaches({ includeCourses: true });
      }
      const staff = await prisma.user.findMany({
        where: { role: { in: ["admin", "mod"] }, status: { not: "banned" } },
        select: { id: true },
      });
      if (staff.length) {
        await prisma.notification.createMany({
          data: staff.map((user) => ({
            userId: user.id,
            category: "forum-report",
            level: "strong",
            title: "收到新的内容举报",
            content: `${target.targetLabel}：${forumReportReasonLabel(reason)}${autoHidden ? "（已达 3 人举报，内容已暂时隐藏）" : ""}`,
            link: "/admin?tab=forum-reports",
            source: "论坛举报",
            payload: JSON.stringify({ type: "forum-report", reportId: report.id, targetType, targetId }),
          })),
        });
      }
      if (autoHidden) {
        await prisma.notification.create({
          data: {
            userId: target.targetAuthorId,
            category: "forum-report",
            level: "strong",
            title: "内容因多人举报暂时隐藏",
            content: "该内容已收到 3 个不同账号举报，现暂时隐藏并等待管理员复核。",
            link: forumReportTargetUrl(targetType, targetId, target.topicId),
            source: "论坛举报",
            payload: JSON.stringify({ type: "forum-report-auto-hidden", targetType, targetId, reportCount: activeReportCount }),
          },
        });
      }
      ok(res, { id: report.id, status: report.status, reportCount: activeReportCount, autoHidden });
    } catch (error) { next(error); }
  },
);

const adminUserSelect = { id: true, username: true, nickname: true, avatar: true, role: true } as const;

function serializeAdminReport(report: any) {
  return {
    ...report,
    targetUrl: forumReportTargetUrl(
      report.targetType as ForumReportTargetType,
      report.targetId,
      report.targetType === "reply" ? report.topicId : null,
    ),
    reasonLabel: forumReportReasonLabel(report.reason as ForumReportReason),
  };
}

async function topicIdsForReplyReports(reports: Array<{ targetType: string; targetId: number }>) {
  const replyIds = reports.filter((item) => item.targetType === "reply").map((item) => item.targetId);
  if (!replyIds.length) return new Map<number, number>();
  const replies = await prisma.reply.findMany({ where: { id: { in: replyIds } }, select: { id: true, topicId: true } });
  return new Map(replies.map((item) => [item.id, item.topicId]));
}

async function reporterTargetUrl(targetType: ForumReportTargetType, targetId: number) {
  if (targetType === "topic") return forumReportTargetUrl(targetType, targetId);
  if (targetType === "reply") {
    const reply = await prisma.reply.findUnique({ where: { id: targetId }, select: { topicId: true } });
    return forumReportTargetUrl(targetType, targetId, reply?.topicId);
  }
  const message = await prisma.directMessage.findUnique({
    where: { id: targetId },
    select: { conversationId: true },
  });
  return message ? `/messages?tab=private&conversation=${message.conversationId}` : "/messages?tab=private";
}

forumReportAdminRouter.get("/", validate(listSchema, "query"), async (req, res, next) => {
  try {
    const { status, targetType, page, size } = req.query as unknown as z.infer<typeof listSchema>;
    const where = {
      ...(status !== "all" ? { status } : {}),
      ...(targetType !== "all" ? { targetType } : {}),
    };
    const [total, reports, statusCounts] = await Promise.all([
      prisma.forumReport.count({ where }),
      prisma.forumReport.findMany({
        where,
        include: {
          reporter: { select: adminUserSelect },
          targetAuthor: { select: adminUserSelect },
          handledBy: { select: adminUserSelect },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.forumReport.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const topicIds = await topicIdsForReplyReports(reports);
    const reporterIds = [...new Set(reports.map((item) => item.reporterId))];
    const targetWhere = reports.length
      ? { OR: reports.map((item) => ({ targetType: item.targetType, targetId: item.targetId })) }
      : undefined;
    const [targetCounts, activeTargetCounts, reporterCounts, reporterRejectedCounts] = await Promise.all([
      targetWhere
        ? prisma.forumReport.groupBy({ by: ["targetType", "targetId"], where: targetWhere, _count: { _all: true } })
        : Promise.resolve([]),
      targetWhere
        ? prisma.forumReport.groupBy({
          by: ["targetType", "targetId"],
          where: { ...targetWhere, status: { not: "rejected" } },
          _count: { _all: true },
        })
        : Promise.resolve([]),
      reporterIds.length
        ? prisma.forumReport.groupBy({
          by: ["reporterId"],
          where: { reporterId: { in: reporterIds } },
          _count: { _all: true },
        })
        : Promise.resolve([]),
      reporterIds.length
        ? prisma.forumReport.groupBy({
          by: ["reporterId"],
          where: { reporterId: { in: reporterIds }, status: "rejected" },
          _count: { _all: true },
        })
        : Promise.resolve([]),
    ]);
    const countKey = (target: { targetType: string; targetId: number }) => `${target.targetType}:${target.targetId}`;
    const targetCountMap = new Map(targetCounts.map((item) => [countKey(item), item._count._all]));
    const activeTargetCountMap = new Map(activeTargetCounts.map((item) => [countKey(item), item._count._all]));
    const reporterCountMap = new Map(reporterCounts.map((item) => [item.reporterId, item._count._all]));
    const reporterRejectedCountMap = new Map(reporterRejectedCounts.map((item) => [item.reporterId, item._count._all]));
    ok(res, {
      page,
      size,
      total,
      counts: Object.fromEntries(statusCounts.map((item) => [item.status, item._count._all])),
      list: reports.map((report) => serializeAdminReport({
        ...report,
        topicId: report.targetType === "reply" ? topicIds.get(report.targetId) ?? null : null,
        targetReportCount: targetCountMap.get(countKey(report)) || 0,
        activeTargetReportCount: activeTargetCountMap.get(countKey(report)) || 0,
        reporterReportCount: reporterCountMap.get(report.reporterId) || 0,
        reporterRejectedCount: reporterRejectedCountMap.get(report.reporterId) || 0,
      })),
    });
  } catch (error) { next(error); }
});

forumReportAdminRouter.patch("/:id", validate(handleSchema), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest("举报 ID 不正确");
    const existing = await prisma.forumReport.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound("举报记录不存在");
    const { status, note } = req.body as z.infer<typeof handleSchema>;
    const handledAt = new Date();
    const handled = await prisma.$transaction(async (tx) => {
      const lockNamespace = existing.targetType === "topic" ? 73101 : existing.targetType === "reply" ? 73102 : 73103;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockNamespace}, ${existing.targetId})`;
      const report = await tx.forumReport.update({
        where: { id },
        data: { status, handledNote: note, handledById: req.user!.userId, handledAt },
        include: {
          reporter: { select: adminUserSelect },
          targetAuthor: { select: adminUserSelect },
          handledBy: { select: adminUserSelect },
        },
      });
      const activeReportCount = await tx.forumReport.count({
        where: { targetType: existing.targetType, targetId: existing.targetId, status: { not: "rejected" } },
      });
      let restored = false;
      if (status === "rejected"
        && shouldRestoreAutoHiddenContent(existing.targetType as ForumReportTargetType, activeReportCount)
        && existing.targetType === "topic") {
        const topic = await tx.topic.findUnique({
          where: { id: existing.targetId },
          select: {
            id: true,
            boardId: true,
            authorId: true,
            reportHiddenAt: true,
            marketItem: { select: { id: true, status: true } },
          },
        });
        if (topic?.reportHiddenAt) {
          await tx.topic.update({ where: { id: topic.id }, data: { hidden: false, reportHiddenAt: null } });
          if (topic.marketItem?.status === "hidden") {
            await tx.marketItem.update({ where: { id: topic.marketItem.id }, data: { status: "active" } });
          }
          await Promise.all([
            refreshBoardTopicCounts([topic.boardId], tx),
            refreshUserPostCount(topic.authorId, tx),
          ]);
          restored = true;
        }
      }
      if (status === "rejected"
        && shouldRestoreAutoHiddenContent(existing.targetType as ForumReportTargetType, activeReportCount)
        && existing.targetType === "reply") {
        const reply = await tx.reply.findUnique({
          where: { id: existing.targetId },
          select: { id: true, topicId: true, authorId: true, reportHiddenAt: true },
        });
        if (reply?.reportHiddenAt) {
          await tx.reply.update({ where: { id: reply.id }, data: { hidden: false, reportHiddenAt: null } });
          await Promise.all([
            refreshTopicReplyStats(reply.topicId, tx),
            refreshUserReplyCount(reply.authorId, tx),
          ]);
          restored = true;
        }
      }
      if (status === "resolved" && existing.targetType === "topic") {
        await tx.topic.updateMany({ where: { id: existing.targetId, reportHiddenAt: { not: null } }, data: { reportHiddenAt: null } });
      }
      if (status === "resolved" && existing.targetType === "reply") {
        await tx.reply.updateMany({ where: { id: existing.targetId, reportHiddenAt: { not: null } }, data: { reportHiddenAt: null } });
      }
      return { report, activeReportCount, restored };
    });
    const { report, activeReportCount, restored } = handled;
    if (restored) await invalidateForumCaches({ includeCourses: true });
    const resultLink = await reporterTargetUrl(existing.targetType as ForumReportTargetType, existing.targetId);
    const notifications: Promise<unknown>[] = [
      prisma.notification.create({
        data: {
          userId: existing.reporterId,
          category: "forum-report-result",
          level: "normal",
          title: status === "resolved" ? "举报已处理" : "举报未予采纳",
          content: note || (status === "resolved"
            ? "管理员已处理你提交的内容举报。"
            : `管理员复核后未采纳本次举报。${restored ? "暂时隐藏的内容已恢复。" : ""}`),
          link: resultLink,
          source: "论坛举报",
          payload: JSON.stringify({ type: "forum-report-result", reportId: id, status }),
        },
      }),
      prisma.notification.updateMany({
        where: {
          userId: req.user!.userId,
          category: "forum-report",
          readAt: null,
          payload: { contains: `\"reportId\":${id}` },
        },
        data: { readAt: handledAt },
      }),
    ];
    if (restored && existing.targetAuthorId) {
      notifications.push(prisma.notification.create({
        data: {
          userId: existing.targetAuthorId,
          category: "forum-report-result",
          level: "normal",
          title: "内容已恢复显示",
          content: "管理员驳回了导致暂时隐藏的举报；有效举报人数已低于 3 人，内容现已恢复显示。",
          link: resultLink,
          source: "论坛举报",
          payload: JSON.stringify({ type: "forum-report-restored", targetType: existing.targetType, targetId: existing.targetId }),
        },
      }));
    }
    await Promise.all(notifications);
    ok(res, serializeAdminReport({ ...report, activeTargetReportCount: activeReportCount, restored }));
  } catch (error) { next(error); }
});
