import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { getFeatures } from "../services/siteSettings";

export const searchRouter = Router();

/** 全局搜索：帖子标题/正文 + 课程 + 服务卡片 */
searchRouter.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return ok(res, { topics: [], courses: [], services: [] });
    const features = getFeatures();
    const searchableBoardTypes = ["announce"];
    if (features.forum) searchableBoardTypes.push("normal", "question");
    if (features.market) searchableBoardTypes.push("market");
    if (features.coursereview) searchableBoardTypes.push("coursereview");

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
        },
      }),
      features.coursereview ? prisma.course.findMany({
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

    ok(res, {
      topics,
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
