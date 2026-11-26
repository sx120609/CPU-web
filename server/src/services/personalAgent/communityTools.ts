import { z } from "zod";
import { prisma } from "../../prisma";
import { resolveSchoolId } from "../../schools/registry";
import { loadVisibleRatings, summarizeRatings, type RatingRow } from "../courseReviews";
import {
  directCounterpartId,
  directParticipantAlias,
  presentDirectParticipantId,
} from "../directMessagePolicy";
import { directMessageVisibilityWhere } from "../directMessageModeration";
import { forumContentVisibilityWhere } from "../forumSubmission";
import { sanitizeLostFoundItemFields } from "../lostFoundPrivacy";
import { isRetiredBoardSlug } from "../retiredBoards";
import { blockedAuthorWhere } from "../userBlock";
import {
  guardToolScope,
  type PersonalAgentToolDefinition,
} from "./types";

const courseReviewsSchema = z.object({
  query: z.string().trim().max(50).optional().describe("课程名、课程代码或任课教师姓名关键词；留空则按高推荐度与热门评价推荐"),
  category: z.string().trim().max(30).optional().describe("可选课程类别筛选，如 公选 / 通识 / 专业 / 体育"),
  limit: z.number().int().min(1).max(12).optional().default(8),
}).strict();

const forumAndLostFoundSchema = z.object({
  mode: z.enum([
    "announcements_and_hot",
    "search_topics",
    "topic_detail",
    "lost_found",
    "my_posts",
  ]).describe("查询模式：announcements_and_hot 近期校园公告与热议榜；search_topics 搜索论坛帖子；topic_detail 读取指定帖子正文与回复；lost_found 检索失物招领；my_posts 查看我发过的帖子"),
  query: z.string().trim().max(60).optional(),
  board: z.string().trim().max(40).optional(),
  topicId: z.number().int().positive().optional(),
  lostFoundKind: z.enum(["all", "lost", "found"]).optional().default("all"),
  campus: z.string().trim().max(30).optional(),
}).strict();

const myMessagesSchema = z.object({
  category: z.enum(["all", "reply", "like", "system"]).optional().default("all"),
}).strict();

function stripMarkdownPreview(text: string, maxLen = 280) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "[图片]")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[#>*`~_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLen);
}

async function loadBlockedUserIds(userId: number): Promise<number[]> {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ ownerId: userId }, { targetId: userId }] },
    select: { ownerId: true, targetId: true },
  });
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.ownerId !== userId) ids.add(row.ownerId);
    if (row.targetId !== userId) ids.add(row.targetId);
  }
  return [...ids];
}

export const communityTools: PersonalAgentToolDefinition<any>[] = [
  {
    name: "community_course_reviews",
    scope: "community",
    label: (args) => args?.query
      ? `正在检索「${args.query}」课程评分与真实学生课评…`
      : "正在检索高口碑课程与选课点评…",
    description: "查询站内课程点评库（推荐度、给分高低、收获度、难度、任课老师及精选真实评价摘要），并标注本人是否已修读该课，辅助选课决策。",
    schema: courseReviewsSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "community");
      if (blocked) return blocked;
      if (!ctx.forumAccessEnabled) {
        return { ok: false, errorCode: "FORUM_RESTRICTED", message: "当前账号暂无社区课程点评访问权限" };
      }
      const schoolId = resolveSchoolId(ctx.schoolId);
      const q = String(args.query || "").trim().toLowerCase();
      const cat = String(args.category || "").trim().toLowerCase();

      const [courses, allRatings, myUserCourses] = await Promise.all([
        prisma.course.findMany({
          where: { schoolId },
          select: {
            id: true,
            code: true,
            name: true,
            credits: true,
            category: true,
            college: true,
            courseTeachers: { select: { teacher: { select: { name: true } } } },
          },
        }),
        loadVisibleRatings(),
        prisma.userCourse.findMany({
          where: { userId: ctx.userId },
          select: { courseId: true, source: true, score: true, semester: true },
        }),
      ]);

      const myMap = new Map(myUserCourses.map((uc) => [uc.courseId, uc]));
      const ratingsByCourse = new Map<number, Array<RatingRow & { createdAt: Date }>>();
      for (const r of allRatings) {
        const list = ratingsByCourse.get(r.courseId) ?? [];
        list.push(r);
        ratingsByCourse.set(r.courseId, list);
      }

      const matched = courses
        .map((c) => {
          const teachers: string[] = (c.courseTeachers ?? []).map((ct: { teacher: { name: string } }) => ct.teacher.name);
          const ratings = ratingsByCourse.get(c.id) ?? [];
          const stats = summarizeRatings(ratings);
          return { course: c, teachers, ratings, stats };
        })
        .filter(({ course, teachers, ratings }) => {
          if (cat && !String(course.category || "").toLowerCase().includes(cat)) return false;
          if (!q) return ratings.length > 0;
          return (
            course.name.toLowerCase().includes(q)
            || String(course.code || "").toLowerCase().includes(q)
            || teachers.some((t: string) => t.toLowerCase().includes(q))
          );
        })
        .sort((a, b) => (
          (b.stats.count > 0 ? 1 : 0) - (a.stats.count > 0 ? 1 : 0)
          || b.stats.recommend - a.stats.recommend
          || b.stats.grading - a.stats.grading
          || b.stats.count - a.stats.count
        ))
        .slice(0, args.limit ?? 8);

      const sampleRatingRows = matched.flatMap((m) => m.ratings.slice(0, 3));
      const topicIds = [...new Set(sampleRatingRows.map((r) => r.topicId))];
      const topics = topicIds.length
        ? await prisma.topic.findMany({
          where: { id: { in: topicIds }, hidden: false },
          select: { id: true, content: true },
        })
        : [];
      const topicContentMap = new Map(topics.map((t) => [t.id, t.content]));

      return {
        ok: true,
        courses: matched.map(({ course, teachers, ratings, stats }) => {
          const mine = myMap.get(course.id);
          const snippets = ratings
            .slice(0, 3)
            .map((r) => {
              const raw = topicContentMap.get(r.topicId);
              if (!raw) return "";
              const preview = stripMarkdownPreview(raw, 150);
              return preview ? `[推荐${r.recommend}/给分${r.givingScore}] ${preview}` : "";
            })
            .filter(Boolean);
          return {
            id: course.id,
            url: `/coursereview/${course.id}`,
            code: course.code,
            name: course.name,
            credits: course.credits,
            category: course.category,
            college: course.college,
            teachers: teachers.slice(0, 6),
            stats,
            myStatus: mine ? { source: mine.source, semester: mine.semester, score: mine.score } : null,
            reviewSnippets: snippets,
          };
        }),
      };
    },
  },
  {
    name: "community_forum_and_lostfound",
    scope: "community",
    label: (args) => {
      if (args?.mode === "lost_found") return "正在检索失物招领记录…";
      if (args?.mode === "topic_detail") return `正在读取帖子 #${args.topicId || ""} 正文与回复…`;
      if (args?.mode === "my_posts") return "正在读取我发布过的帖子…";
      if (args?.mode === "announcements_and_hot") return "正在读取最新校园公告与论坛热榜…";
      return `正在搜索站内帖子${args?.query ? `「${args.query}」` : ""}…`;
    },
    description: "检索最新校园公告、热议帖子、搜索站内讨论、读取指定帖子正文与热门回复、查询失物招领或查看我自己的发帖记录；同时返回可发帖板块列表。",
    schema: forumAndLostFoundSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "community");
      if (blocked) return blocked;
      const schoolId = resolveSchoolId(ctx.schoolId);

      if (args.mode === "lost_found") {
        const q = String(args.query || "").trim();
        const items = await prisma.lostFoundItem.findMany({
          where: {
            topic: { board: { schoolId } },
            status: { in: ["active", "claimed"] },
            ...(args.lostFoundKind && args.lostFoundKind !== "all" ? { kind: args.lostFoundKind } : {}),
            ...(args.campus ? { campus: { contains: args.campus } } : {}),
            ...(q ? {
              OR: [
                { itemName: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { location: { contains: q, mode: "insensitive" } },
              ],
            } : {}),
          },
          orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
          take: 15,
          select: {
            id: true,
            kind: true,
            status: true,
            itemName: true,
            description: true,
            campus: true,
            location: true,
            happenedAt: true,
            storageLocation: true,
            publisherId: true,
            topicId: true,
          },
        });
        return {
          ok: true,
          campuses: ["江宁校区", "玄武门校区"],
          items: items.map((item) => {
            const safe = sanitizeLostFoundItemFields(item, item.publisherId === ctx.userId);
            return {
              id: item.id,
              url: `/lost-found?item=${item.id}`,
              kind: item.kind === "found" ? "招领(捡到)" : "寻物(丢失)",
              status: item.status,
              itemName: safe.itemName,
              description: stripMarkdownPreview(safe.description || "", 140),
              campus: safe.campus,
              location: safe.location,
              happenedAt: item.happenedAt ? item.happenedAt.toISOString().slice(0, 16).replace("T", " ") : "",
              storageLocation: safe.storageLocation || "",
            };
          }),
        };
      }

      if (!ctx.forumAccessEnabled) {
        return { ok: false, errorCode: "FORUM_RESTRICTED", message: "当前账号暂无论坛访问权限" };
      }

      const [boards, blockedUserIds] = await Promise.all([
        prisma.board.findMany({
          where: { schoolId },
          orderBy: { order: "asc" },
          select: { slug: true, name: true, type: true, readOnly: true, anonymousEnabled: true },
        }),
        loadBlockedUserIds(ctx.userId),
      ]);
      const blockWhere = blockedAuthorWhere({ blockedUserIds });

      const postableBoards = boards
        .filter((b) => !isRetiredBoardSlug(b.slug) && !b.readOnly && b.type !== "announce" && b.slug !== "lost-found" && b.slug !== "coursereview")
        .map((b) => ({ slug: b.slug, name: b.name, anonymousAllowed: b.anonymousEnabled }));

      if (args.mode === "topic_detail") {
        if (!args.topicId) {
          return { ok: false, errorCode: "INVALID_ARGS", message: "topic_detail 模式必须提供 topicId" };
        }
        const topic = await prisma.topic.findFirst({
          where: {
            id: args.topicId,
            board: { schoolId },
            AND: [forumContentVisibilityWhere(ctx.userId), blockWhere],
          },
          select: {
            id: true,
            title: true,
            content: true,
            isAnonymous: true,
            createdAt: true,
            likeCount: true,
            replyCount: true,
            board: { select: { slug: true, name: true, type: true } },
            author: { select: { id: true, nickname: true } },
          },
        });
        if (!topic) return { ok: false, errorCode: "NOT_FOUND", message: "帖子不存在或不可见" };
        const replies = await prisma.reply.findMany({
          where: {
            topicId: topic.id,
            AND: [forumContentVisibilityWhere(ctx.userId), blockWhere],
          },
          orderBy: [{ likeCount: "desc" }, { createdAt: "asc" }],
          take: 15,
          select: {
            id: true,
            content: true,
            isAnonymous: true,
            likeCount: true,
            createdAt: true,
            author: { select: { id: true, nickname: true } },
          },
        });
        return {
          ok: true,
          topic: {
            id: topic.id,
            url: `/forum/topic/${topic.id}`,
            board: topic.board.name,
            boardSlug: topic.board.slug,
            title: topic.title,
            author: topic.isAnonymous ? "匿名同学" : topic.author.nickname,
            authorId: topic.isAnonymous ? null : topic.author.id,
            createdAt: topic.createdAt.toISOString().slice(0, 16).replace("T", " "),
            likeCount: topic.likeCount,
            replyCount: topic.replyCount,
            content: stripMarkdownPreview(topic.content, 1200),
          },
          topReplies: replies.map((r) => ({
            id: r.id,
            author: r.isAnonymous ? "匿名同学" : r.author.nickname,
            likeCount: r.likeCount,
            content: stripMarkdownPreview(r.content, 240),
          })),
        };
      }

      if (args.mode === "announcements_and_hot") {
        const [announcements, hotTopics] = await Promise.all([
          prisma.topic.findMany({
            where: {
              board: { schoolId, type: "announce" },
              hidden: false,
            },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { id: true, title: true, createdAt: true, board: { select: { name: true } } },
          }),
          prisma.topic.findMany({
            where: {
              board: { schoolId, type: { notIn: ["announce", "market"] }, slug: { not: "lost-found" } },
              AND: [forumContentVisibilityWhere(ctx.userId), blockWhere],
            },
            orderBy: [{ likeCount: "desc" }, { replyCount: "desc" }, { createdAt: "desc" }],
            take: 10,
            select: { id: true, title: true, replyCount: true, likeCount: true, board: { select: { name: true, slug: true } } },
          }),
        ]);
        return {
          ok: true,
          announcements: announcements.map((a) => ({
            id: a.id,
            url: `/forum/topic/${a.id}`,
            title: a.title,
            department: a.board.name,
            date: a.createdAt.toISOString().slice(0, 10),
          })),
          hotTopics: hotTopics.map((t) => ({
            id: t.id,
            url: `/forum/topic/${t.id}`,
            title: t.title,
            board: t.board.name,
            replyCount: t.replyCount,
            likeCount: t.likeCount,
          })),
          postableBoards,
        };
      }

      const q = String(args.query || "").trim();
      const topics = await prisma.topic.findMany({
        where: {
          board: {
            schoolId,
            ...(args.board ? { slug: args.board } : {}),
          },
          ...(args.mode === "my_posts" ? { authorId: ctx.userId } : {}),
          ...(q ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { content: { contains: q, mode: "insensitive" } },
            ],
          } : {}),
          AND: [forumContentVisibilityWhere(ctx.userId), blockWhere],
        },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          title: true,
          content: true,
          createdAt: true,
          replyCount: true,
          likeCount: true,
          board: { select: { slug: true, name: true } },
        },
      });
      return {
        ok: true,
        topics: topics.map((t) => ({
          id: t.id,
          url: `/forum/topic/${t.id}`,
          board: t.board.name,
          boardSlug: t.board.slug,
          title: t.title,
          excerpt: stripMarkdownPreview(t.content, 160),
          replyCount: t.replyCount,
          likeCount: t.likeCount,
          date: t.createdAt.toISOString().slice(0, 10),
        })),
        postableBoards,
      };
    },
  },
  {
    name: "community_my_messages",
    scope: "messages",
    label: () => "正在汇总我的未读通知与站内私信…",
    description: "读取本人未读通知列表（系统提醒、回帖、点赞）与最近的站内私信会话摘要（严格保护匿名会话隐私）。",
    schema: myMessagesSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "messages");
      if (blocked) return blocked;
      const schoolId = resolveSchoolId(ctx.schoolId);

      const [notifications, conversations] = await Promise.all([
        prisma.notification.findMany({
          where: {
            OR: [{ userId: ctx.userId }, { userId: null, schoolId }],
            ...(args.category && args.category !== "all" ? { category: args.category } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            userId: true,
            category: true,
            title: true,
            content: true,
            link: true,
            readAt: true,
            createdAt: true,
          },
        }),
        prisma.directConversation.findMany({
          where: {
            OR: [{ participantLowId: ctx.userId }, { participantHighId: ctx.userId }],
          },
          orderBy: { lastMessageAt: "desc" },
          take: 10,
          include: {
            participantLow: { select: { id: true, nickname: true } },
            participantHigh: { select: { id: true, nickname: true } },
            messages: {
              where: directMessageVisibilityWhere(ctx.userId),
              orderBy: { id: "desc" },
              take: 2,
              select: { id: true, senderId: true, content: true, readAt: true, createdAt: true },
            },
          },
        }),
      ]);

      const globalIds = notifications.filter((n) => n.userId === null).map((n) => n.id);
      const globalReads = globalIds.length
        ? await prisma.notificationRead.findMany({
          where: { userId: ctx.userId, notificationId: { in: globalIds } },
          select: { notificationId: true, readAt: true },
        })
        : [];
      const readGlobalSet = new Set(globalReads.map((r) => r.notificationId));

      const normalizedNotifications = notifications.map((n) => {
        const unread = n.userId === null ? !readGlobalSet.has(n.id) : !n.readAt;
        return {
          id: n.id,
          category: n.category,
          title: n.title,
          content: stripMarkdownPreview(n.content, 160),
          link: n.link || "",
          unread,
          createdAt: n.createdAt.toISOString().slice(0, 16).replace("T", " "),
        };
      });

      const dmList = conversations
        .filter((conv) => conv.messages.length > 0)
        .map((conv) => {
          const counterpartRawId = directCounterpartId(conv, ctx.userId);
          const alias = directParticipantAlias(conv, counterpartRawId);
          const publicCounterpartId = presentDirectParticipantId(conv, ctx.userId, counterpartRawId);
          const counterpartUser = counterpartRawId === conv.participantLowId ? conv.participantLow : conv.participantHigh;
          const displayName = alias || counterpartUser.nickname || "同学";
          const latest = conv.messages[0];
          const unread = latest ? (latest.senderId !== ctx.userId && !latest.readAt) : false;
          return {
            conversationId: conv.id,
            counterpartUserId: publicCounterpartId,
            counterpartName: displayName,
            isAnonymousScope: Boolean(alias),
            unread,
            lastMessageFromMe: latest?.senderId === ctx.userId,
            lastMessageExcerpt: stripMarkdownPreview(latest?.content || "", 160),
            lastMessageAt: conv.lastMessageAt.toISOString().slice(0, 16).replace("T", " "),
          };
        });

      return {
        ok: true,
        unreadNotificationCount: normalizedNotifications.filter((n) => n.unread).length,
        notifications: normalizedNotifications.slice(0, 15),
        directConversations: dmList,
      };
    },
  },
];
