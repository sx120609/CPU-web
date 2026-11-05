import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { signToken } from "../utils/jwt";
import { DEFAULT_SCHOOL_ID } from "../schools/registry";
import { hashPassword, verifyPassword } from "../utils/password";
import { Errors, ok } from "../utils/response";
import { validate } from "../middleware/validate";
import { securityRateLimit } from "../middleware/securityRateLimit";
import {
  beginLogin,
  logout as logoutJwxt,
  pollSchoolMfa,
  refreshSchoolMfaQr,
  schoolIdForJwxtToken,
  submitLogin,
} from "../services/jwxtTransport";
import { releaseExpiredMutes } from "../services/userModeration";
import { isDev } from "../config";
import { detectLoginClient, loginClientUsage } from "../utils/loginClient";
import { buildSelfUser } from "../utils/publicUser";
import { recordAdminDailyLogin } from "../services/adminStats";
import { isCookieAuthRequest, issueBrowserSession, revokeBrowserSession, updateBrowserSession } from "../services/browserSession";
import { scheduleWidgetSessions } from "../services/scheduleWidgetSession";
import { nicknameSetupRequired, normalizeNicknameSubmission, scheduleNicknameReview } from "../services/nicknameReview";
import { requestCancellation } from "../utils/requestCancellation";
import { findSchool, getSchool } from "../schools/registry";
import { requestSchoolId } from "../schools/modules";
import { schoolMfaGuideForToken } from "../schools/drivers";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
  /** 登录页选的学校；不传时按请求所属学校（默认学校）。 */
  schoolId: z.string().trim().max(32).optional(),
});

const registerSchema = z.object({
  username: z.string().min(3, "用户名至少 3 位").max(20).regex(/^[a-zA-Z0-9_]+$/, "用户名仅允许英文/数字/下划线"),
  password: z.string().min(6, "密码至少 6 位").max(64),
  nickname: z.string().trim().min(2, "昵称至少 2 个字符").max(20),
  college: z.string().max(40).optional(),
  enrollYear: z.number().int().min(2000).max(2100).optional(),
});

const encryptedCredentialsSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("rsa-oaep-sha256+aes-256-gcm"),
  encryptedKey: z.string().min(100).max(2048),
  iv: z.string().min(12).max(64),
  ciphertext: z.string().min(20).max(32_000),
}).strict();

// 站内独立账号登录入口：
//   - 走过学校 SSO 的账号（studentSso=true）禁用此入口，避免与统一身份认证混淆
//   - 其他账号（新生 / 毕业生 / 站务 / 管理员等）允许凭密码登录
//   - 公开注册已禁用，账号统一由 admin 后台开通，所以放开 role 限制是安全的
// 按用户名计数，不按 IP（校园网共用出口）：既挡住针对单个账号的暴力尝试，也不会让整栋楼互相占用额度。
const passwordLoginLimit = securityRateLimit("password-login", 20, 10 * 60_000, (req) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase().slice(0, 128) : "";
  return username ? `username\0${username}` : undefined;
});

authRouter.post("/login", validate(loginSchema), passwordLoginLimit, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    await releaseExpiredMutes();
    const school = findSchool(req.body.schoolId) ?? getSchool(requestSchoolId(req));
    const user = await prisma.user.findUnique({ where: { schoolId_username: { schoolId: school.id, username } } });
    if (!user) throw Errors.badRequest("用户名或密码错误");
    if (user.studentSso) throw Errors.badRequest("该账号已绑定学校认证，请用「学校账号登录」入口");
    const ok2 = await verifyPassword(password, user.passwordHash);
    if (!ok2) throw Errors.badRequest("用户名或密码错误");
    if (user.status === "banned") throw Errors.forbidden("账号已被封禁");
    const client = detectLoginClient(req);
    const logged = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastSeenAt: new Date(),
        lastLoginAt: new Date(),
        lastLoginClient: client.analyticsClient,
        ...loginClientUsage(client),
      },
    });

    const token = signToken({
      userId: user.id,
      studentId: user.username,
      schoolId: user.schoolId,
      role: user.role,
      campus: "",
      voiceHubRole: user.voiceHubRole,
      lostFoundRole: user.lostFoundRole,
    });
    await recordAdminDailyLogin(logged.id, logged.lastLoginAt ?? new Date(), client.analyticsClient).catch((error) => {
      console.warn("[admin-stats] failed to record login", error);
    });
    if (isCookieAuthRequest(req)) {
      await issueBrowserSession(res, { siteToken: token });
      ok(res, { sessionAuthenticated: true, user: buildSelfUser(logged) });
    } else {
      ok(res, { token, user: buildSelfUser(logged) });
    }
  } catch (e) { next(e); }
});

// 旧式注册（保留给开发，前端不暴露入口）
authRouter.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    if (!isDev) throw Errors.forbidden("仅支持学校账号登录");
    const { username, password, nickname, college, enrollYear } = req.body;
    const pendingNickname = normalizeNicknameSubmission(nickname);
    const exists = await prisma.user.findUnique({ where: { schoolId_username: { schoolId: DEFAULT_SCHOOL_ID, username } } });
    if (exists) throw Errors.conflict("该用户名已被占用");
    const passwordHash = await hashPassword(password);
    const client = detectLoginClient(req);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        nickname: "",
        pendingNickname,
        nicknameReviewStatus: "checking",
        nicknameReviewReason: "昵称已提交，正在后台审核",
        nicknameReviewRequestedAt: new Date(),
        college,
        enrollYear,
        lastSeenAt: new Date(),
        lastLoginAt: new Date(),
        lastLoginClient: client.analyticsClient,
        ...loginClientUsage(client),
      },
    });
    await prisma.messageSetting.create({ data: { userId: user.id } });
    const token = signToken({
      userId: user.id,
      studentId: user.username,
      schoolId: user.schoolId,
      role: user.role,
      campus: "",
      voiceHubRole: user.voiceHubRole,
      lostFoundRole: user.lostFoundRole,
    });
    scheduleNicknameReview(user.id);
    await recordAdminDailyLogin(user.id, user.lastLoginAt ?? new Date(), client.analyticsClient).catch((error) => {
      console.warn("[admin-stats] failed to record register login", error);
    });
    if (isCookieAuthRequest(req)) {
      await issueBrowserSession(res, { siteToken: token });
      ok(res, { sessionAuthenticated: true, user: buildSelfUser(user) });
    } else {
      ok(res, { token, user: buildSelfUser(user) });
    }
  } catch (e) { next(e); }
});

// ============ 学校 SSO 登录（主路径）============

/** 第一步：拿登录页 + 可能的验证码 */
/** 统一身份认证只对接了有教务登录实现的学校。 */
function ensureSchoolSsoLogin(req: Request) {
  const school = getSchool(requestSchoolId(req));
  if (!school.ssoLogin) throw Errors.forbidden("本校暂不支持统一身份认证登录，请用站内账号登录");
  return school.id;
}

authRouter.post("/sso-begin", async (req, res, next) => {
  const cancellation = requestCancellation(req, res);
  try {
    const schoolId = ensureSchoolSsoLogin(req);
    const r = await beginLogin(cancellation.signal, schoolId);
    ok(res, r);
  } catch (e) { next(e); } finally { cancellation.dispose(); }
});

/**
 * 第二步：用学校账号完成验证 → 自动建/复用 User → 同时返回站内 JWT + jwxt token
 */
authRouter.post(
  "/sso-login",
  validate(z.object({
    // 兼容旧页面/并发初始化尚未拿到 pendingId 的情况；路由内会自动补一次 begin。
    pendingId: z.string().max(2048).optional().default(""),
    username: z.string().min(1).max(128).optional(),
    password: z.string().min(1).max(1024).optional(),
    captcha: z.string().optional(),
    credentials: encryptedCredentialsSchema.optional(),
    remember: z.boolean().optional().default(true),
  })),
  async (req, res, next) => {
    const cancellation = requestCancellation(req, res);
    try {
      let { pendingId } = req.body;
      const { username, password, captcha, credentials, remember } = req.body;
      if (!credentials && (!username || !password)) throw Errors.badRequest("缺少登录凭据");
      const requestedSchoolId = ensureSchoolSsoLogin(req);
      // 登录会话是哪所学校发的就由哪所学校的驱动接着处理；换了学校的旧会话作废重开。
      if (String(pendingId || "").length >= 8 && schoolIdForJwxtToken(pendingId) !== requestedSchoolId) pendingId = "";
      if (String(pendingId || "").length < 8) {
        if (credentials) throw Errors.badRequest("加密登录会话已失效，请刷新后重试");
        const fresh = await beginLogin(cancellation.signal, requestedSchoolId);
        if (fresh.needCaptcha) {
          return ok(res, {
            ok: false,
            error: "登录会话已刷新，请输入验证码",
            needCaptcha: true,
            captcha: {
              image: fresh.captchaImage || "",
              pendingId: fresh.pendingId,
            },
          });
        }
        pendingId = fresh.pendingId;
      }
      const r = credentials
        ? await submitLogin({ pendingId, credentials }, cancellation.signal)
        : await submitLogin({ pendingId, username, password, captcha }, cancellation.signal);
      if (!r.ok || !r.token) return ok(res, failedSchoolLogin(r));
      await completeSchoolLogin(req, res, { token: r.token, studentId: String(r.authenticatedUsername || username || "").trim(), remember });
    } catch (e) { next(e); } finally { cancellation.dispose(); }
  }
);

type SchoolLoginFailure = {
  error?: string;
  needCaptcha?: boolean;
  captcha?: { image: string; pendingId: string };
  needMfa?: boolean;
  mfa?: { pendingId: string; qrImage: string };
};

export function failedSchoolLogin(r: SchoolLoginFailure) {
  return {
    ok: false,
    error: r.error,
    needCaptcha: r.needCaptcha ?? false,
    captcha: r.captcha,
    // guide：用哪个 App 扫、怎么说，由学校驱动给（schools/drivers.ts）。
    ...(r.needMfa && r.mfa ? { needMfa: true, mfa: { ...r.mfa, guide: schoolMfaGuideForToken(r.mfa.pendingId) } } : {}),
  };
}

// 有的学校统一认证在新设备上要扫码二次验证：网页显示学校给的二维码，轮询扫码状态，确认后完成登录。
const mfaPendingKey = (req: Request) => (typeof req.body?.pendingId === "string" ? `pending\0${req.body.pendingId.slice(0, 80)}` : undefined);

authRouter.post(
  "/sso-mfa/poll",
  securityRateLimit("sso-mfa-poll", 400, 10 * 60_000, mfaPendingKey),
  validate(z.object({ pendingId: z.string().min(8).max(128), remember: z.boolean().optional().default(true) })),
  async (req, res, next) => {
    const cancellation = requestCancellation(req, res);
    try {
      ensureSchoolSsoLogin(req);
      const result = await pollSchoolMfa(req.body.pendingId, cancellation.signal);
      if (result.status !== "done") return ok(res, { ok: false, mfaStatus: result.status });
      const r = result.attempt;
      if (!r.ok || !r.token) return ok(res, { ...failedSchoolLogin(r), mfaStatus: "failed" });
      await completeSchoolLogin(req, res, { token: r.token, studentId: String(r.authenticatedUsername || "").trim(), remember: req.body.remember });
    } catch (e) { next(e); } finally { cancellation.dispose(); }
  },
);

authRouter.post(
  "/sso-mfa/refresh",
  securityRateLimit("sso-mfa-refresh", 20, 10 * 60_000, mfaPendingKey),
  validate(z.object({ pendingId: z.string().min(8).max(128) })),
  async (req, res, next) => {
    const cancellation = requestCancellation(req, res);
    try {
      ensureSchoolSsoLogin(req);
      ok(res, await refreshSchoolMfaQr(req.body.pendingId, cancellation.signal));
    } catch (e) { next(e); } finally { cancellation.dispose(); }
  },
);

/** 学校统一认证通过后：建/复用该校的站内账号，签发站内登录态并带上教务会话。 */
async function completeSchoolLogin(req: Request, res: Response, input: { token: string; studentId: string; remember: boolean }) {
  const { token, studentId, remember } = input;
  // 学号 = username，在所属学校内唯一；学校由签发教务会话的驱动决定。
  const schoolId = schoolIdForJwxtToken(token);
  if (!studentId) throw Errors.server("登录节点未返回认证账号");
  let user = await prisma.user.findUnique({ where: { schoolId_username: { schoolId, username: studentId } } });
  const dummyHash = "$$sso$$"; // SSO 账号不存密码，占位

  if (!user) {
    user = await prisma.user.create({
      data: {
        schoolId,
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
  }

  await releaseExpiredMutes();
  if (user.status === "banned") throw Errors.forbidden("账号已被封禁");

  const client = detectLoginClient(req);
  user = await prisma.user.update({
    where: { id: user.id },
    data: {
      lastSeenAt: new Date(),
      lastLoginAt: new Date(),
      lastLoginClient: client.analyticsClient,
      ...loginClientUsage(client),
    },
  });

  const siteToken = signToken({
    userId: user.id,
    studentId: user.username,
    schoolId: user.schoolId,
    role: user.role,
    campus: "",
    voiceHubRole: user.voiceHubRole,
    lostFoundRole: user.lostFoundRole,
  });
  await recordAdminDailyLogin(user.id, user.lastLoginAt ?? new Date(), client.analyticsClient).catch((error) => {
    console.warn("[admin-stats] failed to record sso login", error);
  });
  if (isCookieAuthRequest(req)) {
    let sessionEstablished = true;
    if (req.browserSession) {
      // Background recovery must stay on the existing browser session.
      // If that session was logged out while the school request was in
      // flight, its revocation tombstone makes this update fail closed.
      sessionEstablished = await updateBrowserSession(req, res, { siteToken, jwxtToken: token });
    } else {
      await issueBrowserSession(res, { siteToken, jwxtToken: token, persistent: remember });
    }
    if (!sessionEstablished) {
      void logoutJwxt(token).catch(() => false);
      ok(res, { ok: false, error: "登录会话已取消" });
      return;
    }
    await scheduleWidgetSessions.recordLogin(user.id, studentId, token).catch(() => {
      console.warn("[schedule-widget] 登录成功，小组件会话同步暂时失败");
    });
    ok(res, {
      ok: true,
      sessionAuthenticated: true,
      jwxtAuthenticated: true,
      user: buildSelfUser(user),
      needNickname: nicknameSetupRequired(user),
    });
  } else {
    await scheduleWidgetSessions.recordLogin(user.id, studentId, token).catch(() => {
      console.warn("[schedule-widget] 登录成功，小组件会话同步暂时失败");
    });
    ok(res, {
      ok: true,
      siteToken,
      jwxtToken: token,
      user: buildSelfUser(user),
      needNickname: nicknameSetupRequired(user),
    });
  }
}

authRouter.post("/logout", async (req, res, next) => {
  try {
    const jwxtToken = req.browserSession?.jwxtToken || String(req.headers["x-jwxt-token"] || "").trim();
    // Revoke the browser session first. The school-side logout can involve a
    // slow remote request and must not leave the site session usable meanwhile.
    await revokeBrowserSession(req, res);
    if (jwxtToken) await logoutJwxt(jwxtToken).catch(() => false);
    ok(res, { ok: true });
  } catch (error) {
    next(error);
  }
});
