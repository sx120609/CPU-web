import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";
import { withCache } from "../services/cache";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { getFeatures } from "../services/siteSettings";
import { resolveForumAccess } from "../services/forumAccess";
import { verifyToken } from "../utils/jwt";

export const searchRouter = Router();

/** 全局搜索：帖子标题/正文 + 课程 + 服务卡片 */
searchRouter.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return ok(res, { topics: [], courses: [], services: [] });
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
    const features = getFeatures();
    const searchableBoardTypes = ["announce"];
    if (forumAccessEnabled && features.forum) searchableBoardTypes.push("normal", "question");
    if (forumAccessEnabled && features.market) searchableBoardTypes.push("market");
    if (forumAccessEnabled && features.coursereview) searchableBoardTypes.push("coursereview");

    const cacheParts = [
      q,
      forumAccessEnabled ? "forum-enabled" : "announce-only",
      features.forum ? "forum-on" : "forum-off",
      features.market ? "market-on" : "market-off",
      features.coursereview ? "course-on" : "course-off",
    ];
    const { topics, courses, services } = await withCache("search", cacheParts, 60_000, async () => {
      const [topics, courses, services] = await Promise.all([
        prisma.topic.findMany({
          where: {
            hidden: false,
            board: { type: { in: searchableBoardTypes } },
            OR: [{ title: { contains: q } }, { content: { contains: q } }],
          },
          orderBy: { lastReplyAt: "desc" },
          take: 10,
          include: {
            board: { select: { slug: true, name: true } },
            author: { select: { nickname: true } },
            tags: { include: { tag: true } },
          },
        }),
        forumAccessEnabled && features.coursereview ? prisma.course.findMany({
          where: {
            OR: [
              { name: { contains: q } },
              { code: { contains: q } },
              { teacher: { contains: q } },
              { courseTeachers: { some: { teacher: { name: { contains: q } } } } },
            ],
          },
          take: 5,
          include: {
            courseTeachers: { include: { teacher: true } },
          },
        }) : Promise.resolve([]),
        prisma.serviceCard.findMany({
          where: visibleServiceWhere({
            OR: [
              { name: { contains: q } },
              { category: { contains: q } },
              { owner: { contains: q } },
              { description: { contains: q } },
            ],
          }),
          take: 8,
        }),
      ]);
      return { topics, courses, services };
    });

    ok(res, {
      topics: topics.map((topic: any) => ({
        ...topic,
        metadata: safeJson(topic.metadata),
        tags: Array.isArray(topic.tags)
          ? topic.tags.map((item: any) => item?.tag ? { id: item.tag.id, name: item.tag.name } : item).filter((item: any) => item?.name)
          : [],
      })),
      courses: courses.map((c: any) => ({
        ...c,
        teachers: (c.courseTeachers ?? []).map((ct: any) => ({
          id: ct.teacher.id,
          name: ct.teacher.name,
          courseTeacherId: ct.id,
        })),
        courseTeachers: undefined,
      })),
      services: services.map(normalizeServiceCard),
    });
  } catch (e) { next(e); }
});

function safeJson(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
