import { Router } from "express";
import { prisma } from "../prisma";
import { authRequired } from "../middleware/auth";
import { Errors, ok } from "../utils/response";

export const userRouter = Router();

userRouter.get("/me", authRequired, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw Errors.notFound("用户不存在");
    ok(res, pubUser(user));
  } catch (e) { next(e); }
});

userRouter.patch("/me", authRequired, async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const allowed: Record<string, unknown> = {};
    for (const k of ["nickname", "bio", "college", "enrollYear", "avatar"]) {
      if (body[k] !== undefined) allowed[k] = body[k];
    }
    const u = await prisma.user.update({ where: { id: req.user!.userId }, data: allowed });
    ok(res, pubUser(u));
  } catch (e) { next(e); }
});

userRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.notFound();
    ok(res, pubUser(user));
  } catch (e) { next(e); }
});

userRouter.get("/:id/topics", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const list = await prisma.topic.findMany({
      where: { authorId: id, hidden: false },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { board: { select: { slug: true, name: true } } },
    });
    ok(res, list);
  } catch (e) { next(e); }
});

function pubUser(u: any) {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: u.avatar,
    bio: u.bio,
    college: u.college,
    enrollYear: u.enrollYear,
    role: u.role,
    postCount: u.postCount,
    replyCount: u.replyCount,
    reputation: u.reputation,
    lastSeenAt: u.lastSeenAt,
    createdAt: u.createdAt,
  };
}
