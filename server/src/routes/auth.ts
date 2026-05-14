import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { signToken } from "../utils/jwt";
import { hashPassword, verifyPassword } from "../utils/password";
import { Errors, ok } from "../utils/response";
import { validate } from "../middleware/validate";
import { beginLogin, submitLogin } from "../services/jwxtClient";
import { isDev } from "../config";

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

// 旧式登录（保留给 alice/bob/admin 示例账号 + dev 模式）
authRouter.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw Errors.badRequest("用户名或密码错误");
    // 强制：仅 dev 环境 + 非 SSO 用户允许密码登录
    if (user.studentSso) throw Errors.badRequest("该账号已绑定学校认证，请用「学校账号登录」入口");
    if (!isDev && user.role !== "admin") throw Errors.forbidden("仅支持学校账号登录");
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
    ok(res, { token, user: pubUser(user) });
  } catch (e) { next(e); }
});

// 旧式注册（保留给开发，前端不暴露入口）
authRouter.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    if (!isDev) throw Errors.forbidden("仅支持学校账号登录");
    const { username, password, nickname, college, enrollYear } = req.body;
    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) throw Errors.conflict("该用户名已被占用");
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { username, passwordHash, nickname, college, enrollYear },
    });
    await prisma.messageSetting.create({ data: { userId: user.id } });
    const token = signToken({ userId: user.id, studentId: user.username, role: user.role, campus: "" });
    ok(res, { token, user: pubUser(user) });
  } catch (e) { next(e); }
});

// ============ 学校 SSO 登录（主路径）============

/** 第一步：拿登录页 + 可能的验证码 */
authRouter.post("/sso-begin", async (_req, res, next) => {
  try {
    const r = await beginLogin();
    ok(res, r);
  } catch (e) { next(e); }
});

/**
 * 第二步：用学校账号完成验证 → 自动建/复用 User → 同时返回站内 JWT + jwxt token
 */
authRouter.post(
  "/sso-login",
  validate(z.object({
    pendingId: z.string().min(8),
    username: z.string().min(1),
    password: z.string().min(1),
    captcha: z.string().optional(),
  })),
  async (req, res, next) => {
    try {
      const { pendingId, username, password, captcha } = req.body;
      const r = await submitLogin({ pendingId, username, password, captcha });
      if (!r.ok || !r.token) {
        return ok(res, {
          ok: false,
          error: r.error,
          needCaptcha: r.needCaptcha ?? false,
          captcha: r.captcha,
        });
      }

      // 学号 = username。查 / 建 User
      const studentId = username.trim();
      let user = await prisma.user.findUnique({ where: { username: studentId } });
      const dummyHash = "$$sso$$"; // SSO 账号不存密码，占位

      if (!user) {
        user = await prisma.user.create({
          data: {
            username: studentId,
            passwordHash: dummyHash,
            nickname: "", // 强制首次登录设置
            studentSso: true,
            role: "user",
          },
        });
        await prisma.messageSetting.create({ data: { userId: user.id } });
      } else {
        // 若是首次以 SSO 登录的旧账号，升级标识
        if (!user.studentSso) {
          user = await prisma.user.update({ where: { id: user.id }, data: { studentSso: true } });
        }
        await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
      }

      if (user.status === "banned") throw Errors.forbidden("账号已被封禁");

      const siteToken = signToken({
        userId: user.id,
        studentId: user.username,
        role: user.role,
        campus: "",
      });
      ok(res, {
        ok: true,
        siteToken,
        jwxtToken: r.token,
        user: pubUser(user),
        needNickname: !user.nickname || user.nickname.trim() === "",
      });
    } catch (e) { next(e); }
  }
);

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
    studentSso: u.studentSso,
    postCount: u.postCount,
    replyCount: u.replyCount,
    reputation: u.reputation,
    createdAt: u.createdAt,
  };
}
