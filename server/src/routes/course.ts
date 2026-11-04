import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { ok, Errors, HttpError } from "../utils/response";
import { withCache } from "../services/cache";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { getGrades, getPyfa, getSchedule } from "../services/jwxtTransport";
import type { GradeRow, PyfaCourse, ScheduleResult } from "../services/jwxtParser";
import { classifyJwxtError, JWXT_AUTH_EXPIRED_CODE } from "../services/jwxtErrors";
import { invalidateCourseCaches } from "../services/cacheInvalidation";
import { isFeatureOn } from "../services/siteSettings";
import { ensureForumAccessEnabled, forumAccessErrorMessage, resolveForumAccess } from "../services/forumAccess";
import { requestSchoolId } from "../schools/modules";
import {
  ensureCourseTeacher,
  loadVisibleRatings,
  ratingDistribution,
  summarizeRatings,
  type RatingRow,
} from "../services/courseReviews";
import { catalogCategories, COURSE_SORTS, queryCatalog, type CatalogCourse, type CourseSort } from "../services/courseCatalog";
import { applyCourseSync, buildSyncedCourses, gradeSemesters, type CourseSource } from "../services/courseSync";
import { forumContentVisibilityWhere, FORUM_SELF_VISIBLE_REVIEW_STATUSES } from "../services/forumSubmission";
import { blockedAuthorWhere } from "../services/userBlock";
import { decodeTopicsForViewerForList, forumAuthorReputationSelect } from "../services/forumPresentation";
import { compactTopicAuthors } from "../utils/publicAvatar";

export const courseRouter = Router();

const CATALOG_TTL_MS = 5 * 60_000;
const SOURCE_ORDER: Record<string, number> = { schedule: 0, grade: 1, pyfa: 2 };

function assertCourseReviewEnabled() {
  if (!isFeatureOn("coursereview")) throw Errors.forbidden("课程点评当前已关闭");
}

async function ensureCanReadCourseReview(req: Request) {
  if (!req.user) throw Errors.forbidden(forumAccessErrorMessage(false));
  const allowed = await resolveForumAccess(req.user.userId, req.user.role);
  if (!allowed) throw Errors.forbidden(forumAccessErrorMessage(true));
}

function positiveInt(value: unknown, fallback: number, max: number) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function courseIdParam(req: Request) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw Errors.notFound("课程不存在");
  return id;
}

/** 整校课程目录 + 可见评分统计，五分钟一份；帖子有任何变化都会刷新这份缓存。 */
function loadCatalog(schoolId: string): Promise<CatalogCourse[]> {
  return withCache("courses", ["catalog-v2", schoolId], CATALOG_TTL_MS, async () => {
    const courses = await prisma.course.findMany({
      where: { schoolId },
      select: {
        id: true, code: true, name: true, credits: true, category: true, college: true,
        courseTeachers: { select: { id: true, teacher: { select: { id: true, name: true } } }, orderBy: { id: "asc" } },
      },
    });
    const ids = new Set(courses.map((c) => c.id));
    const byCourse = new Map<number, Array<RatingRow & { createdAt: Date }>>();
    for (const rating of await loadVisibleRatings()) {
      if (!ids.has(rating.courseId)) continue;
      const list = byCourse.get(rating.courseId) ?? [];
      list.push(rating);
      byCourse.set(rating.courseId, list);
    }
    return courses.map((c) => {
      const ratings = byCourse.get(c.id) ?? [];
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        credits: c.credits,
        category: c.category,
        college: c.college,
        teachers: c.courseTeachers.map((ct) => ({ id: ct.teacher.id, name: ct.teacher.name, courseTeacherId: ct.id })),
        stats: summarizeRatings(ratings),
        lastReviewAt: ratings.length ? Math.max(...ratings.map((r) => new Date(r.createdAt).getTime())) : null,
      };
    });
  });
}

/** 我写过的课评：公开的和审核中的都算，按课程归。 */
async function ownReviews(userId: number) {
  const ratings = await prisma.courseRating.findMany({ where: { authorId: userId }, select: { topicId: true, courseId: true } });
  if (!ratings.length) return new Map<number, { topicId: number; pending: boolean }>();
  const topics = await prisma.topic.findMany({
    where: {
      id: { in: ratings.map((r) => r.topicId) },
      authorId: userId,
      OR: [{ hidden: false }, { hidden: true, aiReviewStatus: { in: [...FORUM_SELF_VISIBLE_REVIEW_STATUSES] } }],
    },
    select: { id: true, hidden: true },
  });
  const state = new Map(topics.map((t) => [t.id, t.hidden]));
  const result = new Map<number, { topicId: number; pending: boolean }>();
  for (const r of ratings) {
    if (!state.has(r.topicId)) continue;
    const pending = state.get(r.topicId)!;
    const current = result.get(r.courseId);
    if (!current || (current.pending && !pending)) result.set(r.courseId, { topicId: r.topicId, pending });
  }
  return result;
}

type MineInfo = {
  source: CourseSource;
  semester: string | null;
  score: string | null;
  teacherNames: string[];
  review: { topicId: number; pending: boolean } | null;
};

async function loadMine(userId: number, courseIds?: number[]) {
  const [links, reviews] = await Promise.all([
    prisma.userCourse.findMany({
      where: { userId, ...(courseIds ? { courseId: { in: courseIds } } : {}) },
      select: { courseId: true, source: true, semester: true, score: true, teacherNames: true, syncedAt: true },
    }),
    ownReviews(userId),
  ]);
  const mine = new Map<number, MineInfo>();
  for (const link of links) {
    mine.set(link.courseId, {
      source: (link.source in SOURCE_ORDER ? link.source : "pyfa") as CourseSource,
      semester: link.semester,
      score: link.score,
      teacherNames: link.teacherNames ? link.teacherNames.split("、").filter(Boolean) : [],
      review: reviews.get(link.courseId) ?? null,
    });
  }
  const syncedAt = links.reduce<Date | null>((latest, l) => (!latest || l.syncedAt > latest ? l.syncedAt : latest), null);
  return { mine, reviews, syncedAt };
}

function compareMine(mine: Map<number, MineInfo>) {
  return (a: CatalogCourse, b: CatalogCourse) => {
    const ma = mine.get(a.id)!;
    const mb = mine.get(b.id)!;
    const bySource = SOURCE_ORDER[ma.source] - SOURCE_ORDER[mb.source];
    if (bySource) return bySource;
    const bySemester = (mb.semester ?? "").localeCompare(ma.semester ?? "");
    if (bySemester) return bySemester;
    return a.code.localeCompare(b.code);
  };
}

/** 课程页头部的概况：全站多少门课、多少篇点评，我修过几门、还有几门没评。 */
courseRouter.get("/overview", async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    await ensureCanReadCourseReview(req);
    const catalog = await loadCatalog(requestSchoolId(req));
    const { mine, syncedAt } = await loadMine(req.user!.userId);
    const inSchool = new Set(catalog.map((c) => c.id));
    const myCourses = [...mine.entries()].filter(([id]) => inSchool.has(id)).map(([, info]) => info);
    ok(res, {
      courseCount: catalog.length,
      reviewedCourseCount: catalog.filter((c) => c.stats.count > 0).length,
      reviewCount: catalog.reduce((sum, c) => sum + c.stats.count, 0),
      categories: catalogCategories(catalog),
      mine: {
        total: myCourses.length,
        taken: myCourses.filter((m) => m.source === "grade").length,
        current: myCourses.filter((m) => m.source === "schedule").length,
        planned: myCourses.filter((m) => m.source === "pyfa").length,
        reviewed: myCourses.filter((m) => m.review).length,
        todo: myCourses.filter((m) => m.source !== "pyfa" && !m.review).length,
        syncedAt,
      },
    });
  } catch (e) { next(e); }
});

/**
 * 课程列表：?q=&sort=hot|recommend|recent|easy|code&category=&scope=all|mine|todo&reviewed=1&page=&size=
 * scope=mine 是我的全部课程，todo 是修过或在修但还没评价的课。
 */
courseRouter.get("/", async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    await ensureCanReadCourseReview(req);
    const schoolId = requestSchoolId(req);
    const q = String(req.query.q ?? "").trim().slice(0, 60);
    const scope = ["mine", "todo"].includes(String(req.query.scope)) ? String(req.query.scope) : "all";
    const sortParam = String(req.query.sort ?? "");
    const sort = (COURSE_SORTS as string[]).includes(sortParam) ? (sortParam as CourseSort) : "hot";
    const category = String(req.query.category ?? "").trim().slice(0, 30) || undefined;
    const page = positiveInt(req.query.page, 1, 500);
    const size = positiveInt(req.query.size, 20, 50);

    const catalog = await loadCatalog(schoolId);
    const { mine } = await loadMine(req.user!.userId);
    let ids: Set<number> | undefined;
    if (scope === "mine") ids = new Set(mine.keys());
    if (scope === "todo") ids = new Set([...mine.entries()].filter(([, m]) => m.source !== "pyfa" && !m.review).map(([id]) => id));

    let list = queryCatalog(catalog, { q, sort, category, ids, reviewedOnly: req.query.reviewed === "1" });
    // 我的课程默认按“在修 → 修过（新学期在前）→ 培养方案”排，用户主动选了排序或在搜索时按选的来。
    if (scope !== "all" && !sortParam && !q) list = [...list].sort(compareMine(mine));
    const items = list.slice((page - 1) * size, page * size).map((course) => ({ ...course, mine: mine.get(course.id) ?? null }));
    ok(res, { page, size, total: list.length, items });
  } catch (e) { next(e); }
});

courseRouter.get("/:id", async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    await ensureCanReadCourseReview(req);
    const id = courseIdParam(req);
    const catalog = await loadCatalog(requestSchoolId(req));
    const course = catalog.find((c) => c.id === id);
    if (!course) throw Errors.notFound("课程不存在");
    const ratings = await loadVisibleRatings({ courseId: id });
    const byTeacher = new Map<number | null, typeof ratings>();
    for (const r of ratings) {
      const list = byTeacher.get(r.courseTeacherId) ?? [];
      list.push(r);
      byTeacher.set(r.courseTeacherId, list);
    }
    const { mine } = await loadMine(req.user!.userId, [id]);
    const own = mine.get(id)?.review ?? (await ownReviews(req.user!.userId)).get(id) ?? null;
    const teachers = course.teachers
      .map((t) => ({ ...t, stats: summarizeRatings(byTeacher.get(t.courseTeacherId) ?? []) }))
      .sort((a, b) => b.stats.count - a.stats.count || a.name.localeCompare(b.name, "zh-CN"));
    ok(res, {
      course: { ...course, stats: summarizeRatings(ratings) },
      distribution: ratingDistribution(ratings),
      teachers,
      unassignedCount: (byTeacher.get(null) ?? []).length,
      mine: mine.get(id) ?? null,
      myReview: own,
    });
  } catch (e) { next(e); }
});

/** 课程的点评列表：?teacher=courseTeacherId&sort=new|hot&page=&size= */
courseRouter.get("/:id/reviews", async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    await ensureCanReadCourseReview(req);
    const id = courseIdParam(req);
    const course = await prisma.course.findFirst({ where: { id, schoolId: requestSchoolId(req) }, select: { id: true } });
    if (!course) throw Errors.notFound("课程不存在");
    const page = positiveInt(req.query.page, 1, 200);
    const size = positiveInt(req.query.size, 10, 30);
    const sort = req.query.sort === "hot" ? "hot" : "new";
    const teacher = Number(req.query.teacher);

    const ratings = await prisma.courseRating.findMany({
      where: { courseId: id, ...(Number.isInteger(teacher) && teacher > 0 ? { courseTeacherId: teacher } : {}) },
      include: { courseTeacher: { include: { teacher: true } } },
    });
    if (!ratings.length) return ok(res, { page, size, total: 0, list: [] });
    const ratingByTopic = new Map(ratings.map((r) => [r.topicId, r]));
    const where = {
      AND: [
        { id: { in: [...ratingByTopic.keys()] } },
        forumContentVisibilityWhere(req.user!.userId),
        blockedAuthorWhere(req.user),
      ],
    };
    const [topics, total] = await Promise.all([
      prisma.topic.findMany({
        where,
        orderBy: sort === "hot" ? [{ likeCount: "desc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }],
        skip: (page - 1) * size,
        take: size,
        include: {
          author: { select: { id: true, username: true, nickname: true, avatar: true, role: true, status: true, mutedUntil: true, isVip: true, profileTheme: true, profileFrame: true, verificationType: true, verificationLabel: true, verificationVerifiedAt: true, verificationExpiresAt: true, ...forumAuthorReputationSelect } },
          board: { select: { id: true, slug: true, name: true, color: true, type: true } },
          tags: { include: { tag: true } },
        },
      }),
      prisma.topic.count({ where }),
    ]);
    const decoded = await decodeTopicsForViewerForList(compactTopicAuthors(topics), req.user);
    ok(res, {
      page,
      size,
      total,
      list: decoded.map((topic: any) => {
        const r = ratingByTopic.get(topic.id)!;
        return {
          topic,
          rating: {
            difficulty: r.difficulty,
            reward: r.reward,
            recommend: r.recommend,
            givingScore: r.givingScore,
            semester: r.semester,
            courseTeacherId: r.courseTeacherId,
            teacherName: r.courseTeacher?.teacher?.name ?? null,
          },
        };
      }),
    });
  } catch (e) { next(e); }
});

/** 为某门课添加授课老师；同名老师已存在时直接返回。 */
const addTeacherSchema = z.object({
  name: z.string().trim().min(2).max(40),
});
courseRouter.post("/:id/teachers", authRequired, securityRateLimit("course-add-teacher", 20, 60 * 60_000), validate(addTeacherSchema), async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    const courseId = courseIdParam(req);
    const course = await prisma.course.findFirst({ where: { id: courseId, schoolId: requestSchoolId(req) } });
    if (!course) throw Errors.notFound("课程不存在");
    const ct = await ensureCourseTeacher({ schoolId: course.schoolId, courseId, name: String(req.body.name), createdById: req.user!.userId, source: "user-add" });
    if (!ct) throw Errors.badRequest("请填写老师姓名");
    await invalidateCourseCaches();
    ok(res, { id: ct.teacher.id, name: ct.teacher.name, courseTeacherId: ct.id });
  } catch (e) { next(e); }
});

function isAuthExpired(error: unknown) {
  const classified = classifyJwxtError(error);
  return classified instanceof HttpError && classified.code === JWXT_AUTH_EXPIRED_CODE;
}

/** 教务授权失效：409 + 4011，网页据此静默恢复授权后重试；不用 401，免得被当成站内登录过期。 */
function jwxtAuthExpired(message = "教务授权已失效") {
  return new HttpError(409, JWXT_AUTH_EXPIRED_CODE, message);
}

async function settle<T>(task: () => Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try {
    return { value: await task() };
  } catch (error) {
    return { error };
  }
}

/**
 * 从教务导入我的课程：成绩（修过）、培养方案（计划修读）、本学期和往期课表（在修 + 任课老师）。
 * 使用 HttpOnly 浏览器会话里的教务身份。
 */
courseRouter.post("/sync", authRequired, securityRateLimit("course-sync", 6, 10 * 60_000), async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    await ensureForumAccessEnabled(req.user!.userId, req.user!.role);
    const userId = req.user!.userId;
    const schoolId = requestSchoolId(req);
    const token = req.browserSession?.jwxtToken || String(req.headers["x-jwxt-token"] || "");
    if (!token) throw jwxtAuthExpired("请先授权教务");

    const [grades, pyfa, current] = await Promise.all([
      settle(() => getGrades(token, { semester: "" })),
      settle(() => getPyfa(token)),
      settle(() => getSchedule(token)),
    ]);
    const firstStage = [grades, pyfa, current];
    if (firstStage.some((r) => r.error && isAuthExpired(r.error))) throw jwxtAuthExpired();
    if (grades.error && pyfa.error) {
      throw new HttpError(502, 5020, "教务系统暂时没有响应，请稍后再试");
    }

    const gradeRows: GradeRow[] = grades.value?.list ?? [];
    const pyfaRows: PyfaCourse[] = pyfa.value?.list ?? [];
    const schedules: ScheduleResult[] = current.value ? [current.value] : [];
    // 往期课表只用来补任课老师；拉不到就算了，不影响导入。
    const pastSemesters = gradeSemesters(gradeRows, [current.value?.currentSemester ?? ""], 6);
    for (let i = 0; i < pastSemesters.length; i += 2) {
      const batch = await Promise.all(pastSemesters.slice(i, i + 2).map((semester) => settle(() => getSchedule(token, { semester }))));
      if (batch.some((r) => r.error && isAuthExpired(r.error))) break;
      for (const r of batch) if (r.value) schedules.push(r.value);
    }

    const courses = buildSyncedCourses({ grades: gradeRows, pyfa: pyfaRows, schedules });
    if (!courses.length) throw Errors.badRequest("教务里没有找到你的课程记录");
    const summary = await applyCourseSync(userId, schoolId, courses);
    await invalidateCourseCaches();
    ok(res, {
      ...summary,
      partial: Boolean(grades.error || pyfa.error),
      syncedAt: new Date().toISOString(),
    });
  } catch (e) { next(e); }
});

