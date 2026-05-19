import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { enabledBoardTypes } from "../services/siteSettings";
import { FORUM_CONFIRM_TEXT, resolveForumAccess } from "../services/forumAccess";
import { releaseExpiredMutes } from "../services/userModeration";
import { buildPublicUser, buildSelfUser } from "../utils/publicUser";

export const userRouter = Router();

userRouter.get("/me", authRequired, async (req, res, next) => {
  try {
    await releaseExpiredMutes();
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw Errors.notFound("用户不存在");
    ok(res, buildSelfUser(user));
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
    ok(res, buildSelfUser(u));
  } catch (e) { next(e); }
});

// 修改自己的密码 —— SSO 账号无站内密码，拒绝
const passwordSchema = z.object({
  oldPassword: z.string().min(1, "请输入原密码"),
  newPassword: z.string().min(6, "新密码至少 6 位").max(64),
});
userRouter.patch("/password", authRequired, validate(passwordSchema), async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw Errors.notFound("用户不存在");
    if (user.studentSso) {
      throw Errors.badRequest("该账号通过学校认证登录，无需设置站内密码");
    }
    const okOld = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!okOld) throw Errors.badRequest("原密码错误");
    if (oldPassword === newPassword) throw Errors.badRequest("新密码不能与原密码相同");
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
});

const forumAccessEnableSchema = z.object({
  confirmText: z.string().trim().min(1).max(20),
});
userRouter.post("/forum-access/enable", authRequired, validate(forumAccessEnableSchema), async (req, res, next) => {
  try {
    if (req.body.confirmText !== FORUM_CONFIRM_TEXT) {
      throw Errors.badRequest(`请输入“${FORUM_CONFIRM_TEXT}”后再继续`);
    }
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        forumEnabled: true,
        forumEnabledAt: new Date(),
      },
    });
    ok(res, buildSelfUser(user));
  } catch (e) { next(e); }
});

userRouter.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await releaseExpiredMutes();
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw Errors.notFound();
    ok(res, buildPublicUser(user, req.user));
  } catch (e) { next(e); }
});

userRouter.get("/:id/topics", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const forumAccessEnabled = await resolveForumAccess(req.user?.userId, req.user?.role);
    if (!forumAccessEnabled) return ok(res, []);
    const list = await prisma.topic.findMany({
      where: { authorId: id, hidden: false, board: { type: { in: enabledBoardTypes() } } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { board: { select: { slug: true, name: true } }, tags: { include: { tag: true } } },
    });
    ok(res, list.map((topic: any) => ({
      ...topic,
      metadata: safeJson(topic.metadata),
      tags: Array.isArray(topic.tags)
        ? topic.tags.map((item: any) => item?.tag ? { id: item.tag.id, name: item.tag.name } : item).filter((item: any) => item?.name)
        : [],
    })));
  } catch (e) { next(e); }
});

function safeJson(s: string | null | undefined) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
