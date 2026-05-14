import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";

export const courseRouter = Router();

courseRouter.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const where: any = {};
    if (q) where.OR = [
      { name: { contains: q } },
      { code: { contains: q } },
      { teacher: { contains: q } },
    ];
    const list = await prisma.course.findMany({
      where,
      orderBy: [{ ratingCount: "desc" }, { id: "asc" }],
      take: 60,
    });
    ok(res, list);
  } catch (e) { next(e); }
});

courseRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const course = await prisma.course.findUnique({ where: { id } });
    if (!course) return res.status(404).json({ code: 4004, data: null, message: "课程不存在" });
    // 该课程的所有评价（来自论坛 Topic）
    const ratings = await prisma.courseRating.findMany({
      where: { courseId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    ok(res, { course, ratings });
  } catch (e) { next(e); }
});
