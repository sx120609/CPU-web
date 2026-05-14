import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { signToken } from "../utils/jwt";
import { hashPassword, verifyPassword } from "../utils/password";
import { Errors, ok } from "../utils/response";
import { validate } from "../middleware/validate";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

const registerSchema = z.object({
  username: z.string().min(3, "用户名至少 3 位").max(20).regex(/^[a-zA-Z0-9_]+$/, "用户名仅允许英文/数字/下划线"),
  password: z.string().min(6, "密码至少 6 位").max(64),
  nickname: z.string().min(1, "请填写昵称").max(20),
  college: z.string().max(40).optional(),
  enrollYear: z.number().int().min(2000).max(2100).optional(),
});

authRouter.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw Errors.badRequest("用户名或密码错误");
    const ok2 = await verifyPassword(password, user.passwordHash);
    if (!ok2) throw Errors.badRequest("用户名或密码错误");
    if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
    await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });

    const token = signToken({
      userId: user.id,
      studentId: user.username,
      role: user.role,
      campus: "",
    });
    ok(res, {
      token,
      user: pubUser(user),
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    const { username, password, nickname, college, enrollYear } = req.body;
    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) throw Errors.conflict("该用户名已被占用");
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { username, passwordHash, nickname, college, enrollYear },
    });
    // 默认创建消息设置
    await prisma.messageSetting.create({ data: { userId: user.id } });
    const token = signToken({
      userId: user.id,
      studentId: user.username,
      role: user.role,
      campus: "",
    });
    ok(res, {
      token,
      user: pubUser(user),
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/logout", (_req, res) => ok(res, { ok: true }));

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
    createdAt: u.createdAt,
  };
}
