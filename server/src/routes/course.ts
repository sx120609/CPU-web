import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { ok, Errors } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { getGrades, getPyfa } from "../services/jwxtTransport";
import type { GradeRow, PyfaCourse } from "../services/jwxtParser";
import { isFeatureOn } from "../services/siteSettings";

export const courseRouter = Router();

function assertCourseReviewEnabled() {
  if (!isFeatureOn("coursereview")) throw Errors.forbidden("课程点评当前已关闭");
}

/** 把 Course 的 courseTeachers 关联展开成 teachers: { id, name, courseTeacherId }[] */
function withTeachers(course: any) {
  if (!course) return course;
  const teachers = (course.courseTeachers ?? []).map((ct: any) => ({
    id: ct.teacher.id,
    name: ct.teacher.name,
    courseTeacherId: ct.id,
  }));
  const { courseTeachers, ...rest } = course;
  return { ...rest, teachers };
}

courseRouter.get("/", async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    const q = String(req.query.q ?? "").trim();
    const mine = req.query.mine === "1";
    const where: any = {};

    if (mine) {
      // 解析 token 拿 userId（公开路由，软鉴权）
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) return ok(res, []);
      try {
        const { verifyToken } = await import("../utils/jwt");
        const userId = verifyToken(auth.slice(7)).userId;
        const ucs = await prisma.userCourse.findMany({ where: { userId }, select: { courseId: true } });
        if (!ucs.length) return ok(res, []);
        where.id = { in: ucs.map((u) => u.courseId) };
      } catch { return ok(res, []); }
    }
    if (q) where.OR = [
      { name: { contains: q } },
      { code: { contains: q } },
      { teacher: { contains: q } }, // 兼容旧字段
      { courseTeachers: { some: { teacher: { name: { contains: q } } } } },
    ];

    const list = await prisma.course.findMany({
      where,
      orderBy: [{ ratingCount: "desc" }, { id: "asc" }],
      take: 200,
      include: {
        courseTeachers: { include: { teacher: true } },
      },
    });
    ok(res, list.map(withTeachers));
  } catch (e) { next(e); }
});

courseRouter.get("/:id", async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    const id = Number(req.params.id);
    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        courseTeachers: { include: { teacher: true } },
      },
    });
    if (!course) return res.status(404).json({ code: 4004, data: null, message: "课程不存在" });
    const ratings = await prisma.courseRating.findMany({
      where: { courseId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        courseTeacher: { include: { teacher: true } },
      },
    });
    // 评分上也把老师名展开，前端可显示"@王老师"
    const ratingsOut = ratings.map((r: any) => ({
      ...r,
      teacherName: r.courseTeacher?.teacher?.name ?? null,
      teacherId: r.courseTeacher?.teacher?.id ?? null,
      courseTeacher: undefined,
    }));
    ok(res, { course: withTeachers(course), ratings: ratingsOut });
  } catch (e) { next(e); }
});

/** 为某门课添加授课老师；登录用户即可，重复时返回已有 */
const addTeacherSchema = z.object({
  name: z.string().trim().min(1).max(40),
});
courseRouter.post("/:id/teachers", authRequired, validate(addTeacherSchema), async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    const courseId = Number(req.params.id);
    const name = String(req.body.name).trim();
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw Errors.notFound("课程不存在");

    const teacher = await prisma.teacher.upsert({
      where: { name },
      update: {},
      create: { name, createdById: req.user!.userId },
    });
    const ct = await prisma.courseTeacher.upsert({
      where: { courseId_teacherId: { courseId, teacherId: teacher.id } },
      update: {},
      create: { courseId, teacherId: teacher.id, source: "user-add" },
    });
    ok(res, { id: teacher.id, name: teacher.name, courseTeacherId: ct.id });
  } catch (e) { next(e); }
});

/**
 * 同步当前用户的教务课程到 Course 表 + UserCourse 关联
 * - 需要：站内 JWT (Authorization) + 教务 token (X-Jwxt-Token)
 * - 来源：成绩列表（cjcx_list）+ 培养方案（pyfa_query）
 */
courseRouter.post("/sync", authRequired, async (req, res, next) => {
  try {
    assertCourseReviewEnabled();
    const userId = req.user!.userId;
    const jwxtToken = (req.headers["x-jwxt-token"] as string) || "";
    if (!jwxtToken) throw Errors.badRequest("需要 X-Jwxt-Token，请先登录教务直连");

    // 1) 拉成绩
    let gradesList: GradeRow[] = [];
    try {
      gradesList = (await getGrades(jwxtToken, { semester: "" })).list;
    } catch { /* 教务 token 失效或接口异常，跳过 */ }

    // 2) 拉培养方案
    let pyfaList: PyfaCourse[] = [];
    try {
      pyfaList = (await getPyfa(jwxtToken)).list;
    } catch { /* 同上 */ }

    if (!gradesList.length && !pyfaList.length) {
      throw Errors.badRequest("未能从教务系统获取任何课程，请确认教务会话有效");
    }

    // 3) 合并为以 code 为键的 Map（pyfa 信息更全，先用 pyfa；成绩补充 teacher/学期）
    type CourseFromJwxt = {
      code: string; name: string; teacher?: string; credits?: number;
      category?: string; college?: string;
      source: "grade" | "pyfa";
      semester?: string; score?: string;
    };
    const merged = new Map<string, CourseFromJwxt>();

    for (const p of pyfaList) {
      if (!p.courseCode) continue;
      merged.set(p.courseCode, {
        code: p.courseCode,
        name: p.courseName,
        credits: p.credits,
        category: p.attr,
        college: p.unit,
        source: "pyfa",
      });
    }
    // grade 在 pyfa 基础上补充 teacher、学期、成绩；如果 pyfa 没有，则单独成行（source=grade）
    for (const g of gradesList) {
      if (!g.courseCode) continue;
      const ex = merged.get(g.courseCode);
      if (ex) {
        ex.source = "grade"; // 既在培养方案又有成绩 → 偏向 grade
        ex.semester = g.semester;
        ex.score = g.score;
        if (!ex.credits) ex.credits = g.credits;
        if (!ex.category) ex.category = g.courseAttr;
      } else {
        merged.set(g.courseCode, {
          code: g.courseCode,
          name: g.courseName,
          credits: g.credits,
          category: g.courseAttr,
          source: "grade",
          semester: g.semester,
          score: g.score,
        });
      }
    }

    // 4) upsert
    let coursesCreated = 0, coursesExisting = 0;
    let linksCreated = 0, linksUpdated = 0;

    for (const c of merged.values()) {
      // 课程：以 code 为键，存在则不覆盖（避免抢别人写的好数据）
      let course = await prisma.course.findUnique({ where: { code: c.code } });
      if (!course) {
        course = await prisma.course.create({
          data: {
            code: c.code,
            name: c.name,
            teacher: c.teacher ?? "",
            credits: c.credits,
            category: c.category,
            college: c.college,
          },
        });
        coursesCreated++;
      } else {
        coursesExisting++;
      }

      // 用户-课程关联
      const existingLink = await prisma.userCourse.findUnique({
        where: { userId_courseId: { userId, courseId: course.id } },
      });
      if (!existingLink) {
        await prisma.userCourse.create({
          data: {
            userId, courseId: course.id,
            source: c.source,
            semester: c.semester,
            score: c.score,
          },
        });
        linksCreated++;
      } else {
        // 已存在 → 仅升级 source/semester/score（不删除）
        await prisma.userCourse.update({
          where: { id: existingLink.id },
          data: {
            source: c.source === "grade" ? "grade" : existingLink.source,
            semester: c.semester ?? existingLink.semester,
            score: c.score ?? existingLink.score,
          },
        });
        linksUpdated++;
      }
    }

    ok(res, {
      examined: merged.size,
      coursesCreated, coursesExisting,
      linksCreated, linksUpdated,
      breakdown: { fromGrade: gradesList.length, fromPyfa: pyfaList.length },
    });
  } catch (e) { next(e); }
});
