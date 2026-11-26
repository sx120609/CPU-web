import { z } from "zod";
import { prisma } from "../../prisma";
import { getSchool, resolveSchoolId } from "../../schools/registry";
import { isBoardTypeOpen, isSchoolModuleEnabled, openBoardTypes } from "../../schools/modules";
import { withCache } from "../cache";
import {
  loadVisibleRatings,
  rankingScore,
  summarizeRatings,
  type CourseStats,
  type RatingRow,
} from "../courseReviews";
import {
  directCounterpartId,
  directParticipantAlias,
  presentDirectParticipantId,
} from "../directMessagePolicy";
import { directMessageVisibilityWhere } from "../directMessageModeration";
import { FORUM_KNOWLEDGE_EXCLUDED_BOARD_SLUGS } from "../forumKnowledge";
import { HOT_TOPIC_FALLBACK_WINDOW_MS, rankHotTopics } from "../forumHotRanking";
import { forumContentVisibilityWhere } from "../forumSubmission";
import { sanitizeLostFoundItemFields } from "../lostFoundPrivacy";
import { isRetiredBoardSlug, visibleBoardSlugFilter } from "../retiredBoards";
import { blockedAuthorWhere } from "../userBlock";
import {
  guardToolScope,
  type PersonalAgentToolDefinition,
} from "./types";

const FORUM_MODES = [
  "announcements_and_hot",
  "search_topics",
  "topic_detail",
  "lost_found",
  "my_posts",
] as const;
type ForumMode = (typeof FORUM_MODES)[number];

/** 通知分类：按消息页的原始 category 归组，"reply" 同时包含 @提及。 */
export const AGENT_NOTIFICATION_CATEGORY_GROUPS = {
  reply: ["reply", "mention"],
  like: ["like"],
  system: ["system", "school-feed", "service-tool", "profile-review", "forum-report", "forum-report-result"],
  "direct-message": ["direct-message"],
  "lost-found": ["lost-found"],
  market: ["market"],
  treehole: ["treehole"],
} as const satisfies Record<string, readonly string[]>;
type NotificationCategoryGroup = keyof typeof AGENT_NOTIFICATION_CATEGORY_GROUPS;
const NOTIFICATION_CATEGORY_KEYS = Object.keys(AGENT_NOTIFICATION_CATEGORY_GROUPS) as [NotificationCategoryGroup, ...NotificationCategoryGroup[]];

/**
 * 树洞是情绪倾诉，失物招领带联系方式且有专门的隐私处理（失物走 lost_found 模式），
 * 论坛检索类模式都不读这两个板块，和拾间AI 论坛资料检索用同一份排除名单。
 */
export const AGENT_FORUM_EXCLUDED_BOARD_SLUGS: ReadonlySet<string> = FORUM_KNOWLEDGE_EXCLUDED_BOARD_SLUGS;

const HOT_TOPIC_SIZE = 10;
const HOT_TOPIC_CANDIDATES = 200;
const COURSE_CATALOG_TTL_MS = 5 * 60_000;
const NOTIFICATION_SCAN_LIMIT = 100;
const NOTIFICATION_RETURN_LIMIT = 15;
const NOTIFICATION_TARGET_CLIENTS = new Set(["ios", "android", "harmony", "web"]);

const courseReviewsSchema = z.object({
  query: z.string().trim().max(50).optional().describe("课程名、课程代码或任课教师姓名关键词；留空则按推荐度推荐有课评的课程"),
  category: z.string().trim().max(30).optional().describe("可选课程类别筛选，如 公选 / 通识 / 专业 / 体育"),
  limit: z.number().int().min(1).max(12).optional().default(8).describe("返回课程数，1~12，默认 8"),
}).strict();

const forumAndLostFoundSchema = z.object({
  mode: z.enum(FORUM_MODES).optional().describe(
    "查询模式：announcements_and_hot 近期公告与热议榜；search_topics 搜索论坛帖子；topic_detail 读取指定帖子正文与回复；lost_found 检索失物招领；my_posts 我发过的帖子。省略时：有 topicId 读帖子，有 query 搜索，否则看公告与热榜",
  ),
  query: z.string().trim().max(60).optional().describe("搜索关键词（search_topics / lost_found / my_posts）"),
  board: z.string().trim().max(40).optional().describe("限定板块 slug（取自 postableBoards）；树洞与失物招领板块不在此读取"),
  topicId: z.number().int().positive().optional().describe("topic_detail 模式要读的帖子 id"),
  lostFoundKind: z.enum(["all", "lost", "found"]).optional().default("all").describe("lost_found 模式：all 全部 / lost 寻物 / found 招领"),
  campus: z.string().trim().max(30).optional().describe("lost_found 模式的校区关键词"),
}).strict();

const myMessagesSchema = z.object({
  category: z.enum(["all", ...NOTIFICATION_CATEGORY_KEYS])
    .optional()
    .default("all")
    .describe("通知分类：all 全部 / reply 回复与提及 / like 点赞 / system 系统与学校通知 / direct-message 私信提醒 / lost-found 失物招领 / market 二手 / treehole 树洞"),
}).strict();

export function stripMarkdownPreview(text: string, maxLen = 280) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "[图片]")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[#>*`~_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLen);
}

function shanghaiMinute(date: Date) {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

function shanghaiDate(date: Date) {
  return shanghaiMinute(date).slice(0, 10);
}

/** 没给 mode 时按参数推断：有帖子 id 读帖子，有关键词搜索，否则看公告热榜。 */
export function resolveForumMode(args: { mode?: ForumMode; topicId?: number; query?: string } | null | undefined): ForumMode {
  if (args?.mode) return args.mode;
  if (args?.topicId) return "topic_detail";
  if (String(args?.query || "").trim()) return "search_topics";
  return "announcements_and_hot";
}

/** 论坛检索可读的板块：本校、板块类型开着、未退役、不在排除名单；可再限定一个 slug。 */
export function agentForumBoardWhere(schoolId: string, types: readonly string[], slug?: string) {
  return {
    schoolId,
    type: { in: [...types] },
    ...(slug ? { slug } : {}),
    AND: [visibleBoardSlugFilter(), { slug: { notIn: [...AGENT_FORUM_EXCLUDED_BOARD_SLUGS] } }],
  };
}

/** 本次可读的板块类型（站点开关与学校功能取交集）；没有论坛访问权限时只剩公告。 */
export function agentReadableBoardTypes(schoolId: string, forumAccessEnabled: boolean) {
  const types = openBoardTypes(schoolId);
  return forumAccessEnabled ? types : types.filter((type) => type === "announce");
}

/** 消息页的口径：targetClient 为空、"all" 或无法识别时不限客户端。Agent 不知道提问来自哪个客户端，只读不限客户端的通知。 */
export function isClientAgnosticNotification(targetClient: string | null | undefined) {
  if (!targetClient || targetClient === "all") return true;
  return !targetClient.split(",").some((item) => NOTIFICATION_TARGET_CLIENTS.has(item.trim().toLowerCase()));
}

export type AgentNotificationRow = {
  id: number;
  userId: number | null;
  category: string;
  title: string;
  content: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/** 未读在前、各自按时间倒序；未读数按本次扫描到的通知计算（与网页消息页角标同一口径）。 */
export function summarizeNotificationsForAgent(
  rows: AgentNotificationRow[],
  readGlobalIds: ReadonlySet<number>,
  limit = NOTIFICATION_RETURN_LIMIT,
) {
  const items = rows.map((n) => ({
    id: n.id,
    category: n.category,
    title: n.title.slice(0, 80),
    content: stripMarkdownPreview(n.content, 160),
    link: n.link || "",
    unread: n.userId === null ? !readGlobalIds.has(n.id) : !n.readAt,
    createdAt: shanghaiMinute(n.createdAt),
    at: n.createdAt.getTime(),
  }));
  const unreadCount = items.filter((item) => item.unread).length;
  const ordered = [...items].sort((a, b) => (Number(b.unread) - Number(a.unread)) || (b.at - a.at));
  return {
    unreadCount,
    notifications: ordered.slice(0, limit).map(({ at: _at, ...rest }) => rest),
  };
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

export type AgentCatalogCourse = {
  id: number;
  code: string;
  name: string;
  credits: number | null;
  category: string | null;
  college: string | null;
  teachers: string[];
  stats: CourseStats;
};

/** 整校课程目录 + 可见评分统计，与课程页目录同在 "courses" 缓存域，课评变化时一起失效。 */
function loadAgentCourseCatalog(schoolId: string): Promise<AgentCatalogCourse[]> {
  return withCache("courses", ["agent-catalog-v1", schoolId], COURSE_CATALOG_TTL_MS, async () => {
    const courses = await prisma.course.findMany({
      where: { schoolId },
      select: {
        id: true,
        code: true,
        name: true,
        credits: true,
        category: true,
        college: true,
        courseTeachers: { select: { teacher: { select: { name: true } } }, orderBy: { id: "asc" } },
      },
    });
    const ids = new Set(courses.map((c) => c.id));
    const byCourse = new Map<number, RatingRow[]>();
    for (const rating of await loadVisibleRatings()) {
      if (!ids.has(rating.courseId)) continue;
      const list = byCourse.get(rating.courseId) ?? [];
      list.push(rating);
      byCourse.set(rating.courseId, list);
    }
    return courses.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      credits: c.credits,
      category: c.category,
      college: c.college,
      teachers: c.courseTeachers.map((ct) => ct.teacher.name),
      stats: summarizeRatings(byCourse.get(c.id) ?? []),
    }));
  });
}

/** 按关键词/类别筛课并排序：有课评的在前，推荐度按 rankingScore 向均值收拢后比较，避免一篇五星排第一。 */
export function selectCatalogCourses(
  catalog: AgentCatalogCourse[],
  input: { query?: string; category?: string; limit?: number },
) {
  const q = String(input.query || "").trim().toLowerCase();
  const cat = String(input.category || "").trim().toLowerCase();
  return catalog
    .filter((course) => {
      if (cat && !String(course.category || "").toLowerCase().includes(cat)) return false;
      if (!q) return course.stats.count > 0;
      return course.name.toLowerCase().includes(q)
        || String(course.code || "").toLowerCase().includes(q)
        || course.teachers.some((t) => t.toLowerCase().includes(q));
    })
    .sort((a, b) => (
      (b.stats.count > 0 ? 1 : 0) - (a.stats.count > 0 ? 1 : 0)
      || rankingScore(b.stats) - rankingScore(a.stats)
      || b.stats.grading - a.stats.grading
      || b.stats.count - a.stats.count
    ))
    .slice(0, input.limit ?? 8);
}

export const communityTools: PersonalAgentToolDefinition<any>[] = [
  {
    name: "community_course_reviews",
    scope: "community",
    label: (args) => args?.query
      ? `正在检索「${args.query}」课程评分与真实学生课评…`
      : "正在检索高口碑课程与选课点评…",
    description: "查询站内课程点评库（推荐度、给分高低、收获度、难度、任课老师及近期真实评价摘要），并标注本人是否已修读或在修该课，辅助选课决策。",
    schema: courseReviewsSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "community");
      if (blocked) return blocked;
      if (!ctx.forumAccessEnabled) {
        return { ok: false, errorCode: "FORUM_RESTRICTED", message: "当前账号暂无社区课程点评访问权限" };
      }
      const schoolId = resolveSchoolId(ctx.schoolId);
      // 站点的课程点评开关与本校课程评价功能取交集，和课程页、站内搜索同一判断。
      if (!isBoardTypeOpen(schoolId, "coursereview")) {
        return { ok: false, errorCode: "FEATURE_CLOSED", message: "课程点评当前未开放，暂时无法查询课评" };
      }

      const catalog = await loadAgentCourseCatalog(schoolId);
      const matched = selectCatalogCourses(catalog, { query: args.query, category: args.category, limit: args.limit ?? 8 });
      if (!matched.length) return { ok: true, courses: [] };
      const matchedIds = matched.map((c) => c.id);

      const [ratings, myUserCourses, blockedUserIds] = await Promise.all([
        loadVisibleRatings({ courseId: { in: matchedIds } }),
        prisma.userCourse.findMany({
          where: { userId: ctx.userId, courseId: { in: matchedIds } },
          select: { courseId: true, source: true, semester: true, score: true },
        }),
        loadBlockedUserIds(ctx.userId),
      ]);
      const blockedSet = new Set(blockedUserIds);
      const samplesByCourse = new Map<number, RatingRow[]>();
      for (const rating of [...ratings].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
        if (blockedSet.has(rating.authorId)) continue;
        const list = samplesByCourse.get(rating.courseId) ?? [];
        if (list.length < 3) list.push(rating);
        samplesByCourse.set(rating.courseId, list);
      }
      const topicIds = [...new Set([...samplesByCourse.values()].flat().map((r) => r.topicId))];
      const topics = topicIds.length
        ? await prisma.topic.findMany({ where: { id: { in: topicIds }, hidden: false }, select: { id: true, content: true } })
        : [];
      const topicContentMap = new Map(topics.map((t) => [t.id, t.content]));
      const myMap = new Map(myUserCourses.map((uc) => [uc.courseId, uc]));

      return {
        ok: true,
        courses: matched.map((course) => {
          const mine = myMap.get(course.id);
          const snippets = (samplesByCourse.get(course.id) ?? [])
            .map((r) => {
              const preview = stripMarkdownPreview(topicContentMap.get(r.topicId) || "", 120);
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
            teachers: course.teachers.slice(0, 4),
            stats: course.stats,
            // 成绩属于「成绩与学业档案」授权域；只开了社区授权时只说明修读状态。
            myStatus: mine
              ? {
                source: mine.source,
                semester: mine.semester,
                ...(ctx.permissions.academic ? { score: mine.score } : {}),
              }
              : null,
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
      const mode = resolveForumMode(args);
      if (mode === "lost_found") return "正在检索失物招领记录…";
      if (mode === "topic_detail") return `正在读取帖子 #${args?.topicId || ""} 正文与回复…`;
      if (mode === "my_posts") return "正在读取我发布过的帖子…";
      if (mode === "announcements_and_hot") return "正在读取最新校园公告与论坛热榜…";
      return `正在搜索站内帖子${args?.query ? `「${args.query}」` : ""}…`;
    },
    description: "检索最新校园公告、近三天论坛热议、搜索站内讨论、读取指定帖子正文与热门回复、查询失物招领或查看我自己的发帖记录；同时返回可发帖板块列表。树洞与失物招领板块的帖子不在论坛模式里读取，失物请用 lost_found 模式。",
    schema: forumAndLostFoundSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "community");
      if (blocked) return blocked;
      const schoolId = resolveSchoolId(ctx.schoolId);
      const mode = resolveForumMode(args);

      if (mode === "lost_found") {
        if (!isSchoolModuleEnabled(schoolId, "lostFound")) {
          return { ok: false, errorCode: "FEATURE_CLOSED", message: "本校暂未开放失物招领" };
        }
        const q = String(args.query || "").trim();
        const items = await prisma.lostFoundItem.findMany({
          where: {
            // 与失物招领列表一致：帖子被举报隐藏或下架后不再出现。
            topic: { hidden: false, board: { schoolId } },
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
          take: 12,
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
          },
        });
        return {
          ok: true,
          campuses: [...getSchool(schoolId).campuses],
          items: items.map((item) => {
            // 联系方式从不返回；其余文字字段与失物招领页一样对非发布者打码。
            const safe = sanitizeLostFoundItemFields(item, item.publisherId === ctx.userId);
            return {
              id: item.id,
              url: `/lost-found?item=${item.id}`,
              kind: item.kind === "found" ? "招领(捡到)" : "寻物(丢失)",
              status: item.status,
              itemName: safe.itemName,
              description: stripMarkdownPreview(safe.description || "", 120),
              campus: safe.campus,
              location: safe.location,
              happenedAt: item.happenedAt ? shanghaiMinute(item.happenedAt) : "",
              storageLocation: safe.storageLocation || "",
              mine: item.publisherId === ctx.userId,
            };
          }),
        };
      }

      const readableTypes = agentReadableBoardTypes(schoolId, ctx.forumAccessEnabled);
      if (!readableTypes.length) {
        return { ok: false, errorCode: "FEATURE_CLOSED", message: "本校论坛与公告当前未开放" };
      }
      const boardSlug = args.board ? String(args.board).trim() : "";
      if (boardSlug && (AGENT_FORUM_EXCLUDED_BOARD_SLUGS.has(boardSlug) || isRetiredBoardSlug(boardSlug))) {
        return {
          ok: false,
          errorCode: "BOARD_NOT_READABLE",
          message: boardSlug === "lost-found" ? "失物招领请改用 lost_found 模式查询" : "该板块的内容不通过拾间AI 读取",
        };
      }

      const [boards, blockedUserIds] = await Promise.all([
        ctx.forumAccessEnabled
          ? prisma.board.findMany({
            where: agentForumBoardWhere(schoolId, readableTypes),
            orderBy: { order: "asc" },
            select: { slug: true, name: true, type: true, readOnly: true, anonymousEnabled: true },
          })
          : Promise.resolve([]),
        loadBlockedUserIds(ctx.userId),
      ]);
      const blockWhere = blockedAuthorWhere({ blockedUserIds });
      const postableBoards = boards
        .filter((b) => !b.readOnly && b.type !== "announce" && b.type !== "coursereview")
        .map((b) => ({ slug: b.slug, name: b.name, anonymousAllowed: b.anonymousEnabled }));

      if (mode === "topic_detail") {
        if (!args.topicId) {
          return { ok: false, errorCode: "INVALID_ARGS", message: "topic_detail 模式必须提供 topicId" };
        }
        const topic = await prisma.topic.findFirst({
          where: {
            id: args.topicId,
            board: agentForumBoardWhere(schoolId, readableTypes),
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
            board: { select: { slug: true, name: true } },
            author: { select: { id: true, nickname: true } },
          },
        });
        if (!topic) return { ok: false, errorCode: "NOT_FOUND", message: "帖子不存在、不可见或不在可读取的板块" };
        const replies = await prisma.reply.findMany({
          where: {
            topicId: topic.id,
            AND: [forumContentVisibilityWhere(ctx.userId), blockWhere],
          },
          orderBy: [{ likeCount: "desc" }, { createdAt: "asc" }],
          take: 12,
          select: {
            id: true,
            content: true,
            isAnonymous: true,
            likeCount: true,
            author: { select: { nickname: true } },
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
            createdAt: shanghaiMinute(topic.createdAt),
            likeCount: topic.likeCount,
            replyCount: topic.replyCount,
            content: stripMarkdownPreview(topic.content, 1200),
          },
          topReplies: replies.map((r) => ({
            id: r.id,
            author: r.isAnonymous ? "匿名同学" : r.author.nickname,
            likeCount: r.likeCount,
            content: stripMarkdownPreview(r.content, 200),
          })),
        };
      }

      if (mode === "announcements_and_hot") {
        const hotTypes = readableTypes.filter((type) => type !== "announce" && type !== "market");
        const cutoff = new Date(ctx.now.getTime() - HOT_TOPIC_FALLBACK_WINDOW_MS);
        const [announcements, hotCandidates] = await Promise.all([
          readableTypes.includes("announce")
            ? prisma.topic.findMany({
              where: { board: agentForumBoardWhere(schoolId, ["announce"]), hidden: false },
              orderBy: { createdAt: "desc" },
              take: 8,
              select: { id: true, title: true, createdAt: true, board: { select: { name: true } } },
            })
            : Promise.resolve([]),
          hotTypes.length
            ? prisma.topic.findMany({
              where: {
                hidden: false,
                createdAt: { gte: cutoff },
                board: agentForumBoardWhere(schoolId, hotTypes),
                ...blockWhere,
              },
              orderBy: { createdAt: "desc" },
              take: HOT_TOPIC_CANDIDATES,
              select: {
                id: true,
                title: true,
                createdAt: true,
                replyCount: true,
                likeCount: true,
                viewCount: true,
                board: { select: { name: true } },
              },
            })
            : Promise.resolve([]),
        ]);
        // 与首页热榜同一套排序：24 小时内优先、72 小时内补位，按互动量与新鲜度衰减打分。
        const hotTopics = rankHotTopics(hotCandidates, HOT_TOPIC_SIZE, ctx.now.getTime());
        return {
          ok: true,
          announcements: announcements.map((a) => ({
            id: a.id,
            url: `/forum/topic/${a.id}`,
            title: a.title.slice(0, 80),
            department: a.board.name,
            date: shanghaiDate(a.createdAt),
          })),
          hotTopics: hotTopics.map((t) => ({
            id: t.id,
            url: `/forum/topic/${t.id}`,
            title: t.title.slice(0, 80),
            board: t.board.name,
            replyCount: t.replyCount,
            likeCount: t.likeCount,
            date: shanghaiDate(t.createdAt),
          })),
          postableBoards,
        };
      }

      const q = String(args.query || "").trim();
      const topics = await prisma.topic.findMany({
        where: {
          board: agentForumBoardWhere(schoolId, readableTypes, boardSlug || undefined),
          ...(mode === "my_posts" ? { authorId: ctx.userId } : {}),
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
          title: t.title.slice(0, 80),
          excerpt: stripMarkdownPreview(t.content, 140),
          replyCount: t.replyCount,
          likeCount: t.likeCount,
          date: shanghaiDate(t.createdAt),
        })),
        postableBoards,
      };
    },
  },
  {
    name: "community_my_messages",
    scope: "messages",
    label: () => "正在汇总我的未读通知与站内私信…",
    description: "读取本人通知（未读在前，含系统提醒、回帖与提及、点赞等）与最近的站内私信会话摘要（严格保护匿名会话隐私）。",
    schema: myMessagesSchema,
    async execute(args, ctx) {
      const blocked = guardToolScope(ctx, "messages");
      if (blocked) return blocked;
      const schoolId = resolveSchoolId(ctx.schoolId);
      const categoryGroup = args.category && args.category !== "all"
        ? AGENT_NOTIFICATION_CATEGORY_GROUPS[args.category as NotificationCategoryGroup]
        : null;
      const dmEnabled = isSchoolModuleEnabled(schoolId, "directMessage");

      const [notificationRows, blockedUserIds] = await Promise.all([
        prisma.notification.findMany({
          where: {
            AND: [
              // 全站公告只看本校的。
              { OR: [{ userId: ctx.userId }, { userId: null, schoolId }] },
              categoryGroup ? { category: { in: [...categoryGroup] } } : {},
            ],
          },
          orderBy: { createdAt: "desc" },
          take: NOTIFICATION_SCAN_LIMIT,
          select: {
            id: true,
            userId: true,
            category: true,
            title: true,
            content: true,
            link: true,
            readAt: true,
            createdAt: true,
            targetClient: true,
          },
        }),
        dmEnabled ? loadBlockedUserIds(ctx.userId) : Promise.resolve([] as number[]),
      ]);
      const notifications = notificationRows.filter((n) => isClientAgnosticNotification(n.targetClient));

      const globalIds = notifications.filter((n) => n.userId === null).map((n) => n.id);
      const [globalReads, conversations] = await Promise.all([
        globalIds.length
          ? prisma.notificationRead.findMany({
            where: { userId: ctx.userId, notificationId: { in: globalIds } },
            select: { notificationId: true },
          })
          : Promise.resolve([]),
        dmEnabled
          ? prisma.directConversation.findMany({
            where: {
              // 与私信会话列表一致：只列有可见消息的会话，屏蔽关系中的会话不出现。
              AND: [
                { OR: [{ participantLowId: ctx.userId }, { participantHighId: ctx.userId }] },
                { messages: { some: directMessageVisibilityWhere(ctx.userId) } },
                { participantLowId: { notIn: blockedUserIds } },
                { participantHighId: { notIn: blockedUserIds } },
              ],
            },
            orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
            take: 10,
            include: {
              participantLow: { select: { id: true, nickname: true } },
              participantHigh: { select: { id: true, nickname: true } },
              messages: {
                where: directMessageVisibilityWhere(ctx.userId),
                orderBy: { id: "desc" },
                take: 1,
                select: { senderId: true, content: true, createdAt: true },
              },
            },
          })
          : Promise.resolve([]),
      ]);
      const summary = summarizeNotificationsForAgent(notifications, new Set(globalReads.map((r) => r.notificationId)));

      const conversationIds = conversations.map((conv) => conv.id);
      const unreadCounts = conversationIds.length
        ? await prisma.directMessage.groupBy({
          by: ["conversationId"],
          where: { conversationId: { in: conversationIds }, senderId: { not: ctx.userId }, hidden: false, readAt: null },
          _count: { _all: true },
        })
        : [];
      const unreadByConversation = new Map(unreadCounts.map((item) => [item.conversationId, item._count._all]));

      const directConversations = conversations
        .filter((conv) => conv.messages.length > 0)
        .map((conv) => {
          const counterpartRawId = directCounterpartId(conv, ctx.userId);
          const alias = directParticipantAlias(conv, counterpartRawId);
          const counterpartUser = counterpartRawId === conv.participantLowId ? conv.participantLow : conv.participantHigh;
          const latest = conv.messages[0];
          const unreadCount = unreadByConversation.get(conv.id) || 0;
          return {
            conversationId: conv.id,
            counterpartUserId: presentDirectParticipantId(conv, ctx.userId, counterpartRawId),
            counterpartName: alias || counterpartUser.nickname || "同学",
            isAnonymousScope: Boolean(alias),
            unreadCount,
            lastMessageFromMe: latest.senderId === ctx.userId,
            lastMessageExcerpt: stripMarkdownPreview(latest.content || "", 140),
            lastMessageAt: shanghaiMinute(latest.createdAt),
          };
        });

      return {
        ok: true,
        unreadNotificationCount: summary.unreadCount,
        notifications: summary.notifications,
        directConversations,
        ...(dmEnabled ? {} : { directMessagesNote: "本校暂未开放站内私信" }),
      };
    },
  },
];
