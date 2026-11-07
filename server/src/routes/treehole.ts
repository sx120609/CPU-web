import { getSchool } from "../schools/registry";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  claimTreeholeImage,
  hasCurrentConsent,
  loadTreeholeConfig,
  loadTreeholeViewer,
  notifyTreehole,
  parseTreeholeId,
  checkedHostNickname,
  presenceOf,
  syncHostRoomAlias,
  publicHelpChannels,
  publicHost,
  readTreeholeImage,
  requireConsent,
  requireTreeholeHost,
  storeTreeholeImage,
  takeTreeholeRate,
  treeholeAdminUserIds,
  TREEHOLE_IMAGE_MAX_SOURCE_BYTES,
  viewerOf,
  writeTreeholeAudit,
  type TreeholeViewer,
} from "../services/treehole";
import {
  listSessionSummaries,
  loadSessionFor,
  markSeen,
  MESSAGE_PAGE,
  serializeMessages,
  serializeSession,
  type SessionMessageRow,
} from "../services/treeholeSessions";
import {
  generateVisitorAlias,
  hostDisplayName,
  normalizeTopics,
  presenceOverrideFor,
  roomCategoryLabel,
  shouldNotifyCounterpart,
  treeholeSessionRole,
  TREEHOLE_CONSENT_VERSION,
  TREEHOLE_CRISIS_URGENCIES,
  TREEHOLE_PRESENCE_SEEN_MS,
  TREEHOLE_SESSION_TAGS,
} from "../services/treeholePolicy";
import { treeholeRoomRouter } from "./treeholeRooms";
import { treeholeAdminRouter } from "./treeholeAdmin";
import { treeholeBookingRouter } from "./treeholeBookings";

// 艾绒树洞：来访者、洞主共用的一对一会话接口；宣泄室和后台在各自的文件里。

export const treeholeRouter = Router();

treeholeRouter.use(async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res.locals.treehole = await loadTreeholeViewer(req.user!);
    next();
  } catch (error) {
    next(error);
  }
});

// ---- 首页 ----

treeholeRouter.get("/me", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const [config, consent, user] = await Promise.all([
      loadTreeholeConfig(viewerOf(res).schoolId),
      hasCurrentConsent(viewer.userId),
      prisma.user.findUnique({ where: { id: viewer.userId }, select: { studentSso: true } }),
    ]);
    const staffMember = viewer.isHost || viewer.isAdmin;
    const sessions = await listSessionSummaries({ visitorId: viewer.userId }, "visitor", config, { take: 100 });
    const memberships = await prisma.treeholeRoomMember.findMany({
      where: { userId: viewer.userId, status: "active", role: "visitor", room: { status: "active" } },
      include: { room: { select: { id: true, name: true, category: true, intro: true, lastMessageAt: true } } },
      orderBy: { joinedAt: "desc" },
    });
    const roomUnread = memberships.length
      ? await prisma.treeholeRoomMessage.groupBy({
        by: ["roomId"],
        where: { OR: memberships.map((member) => ({ roomId: member.roomId, id: { gt: member.readId }, memberId: { not: member.id } })) },
        _count: { _all: true },
      })
      : [];
    const roomUnreadMap = new Map(roomUnread.map((row) => [row.roomId, row._count._all]));
    const applications = await prisma.treeholeRoomApplication.findMany({
      where: { visitorId: viewer.userId, status: { in: ["pending", "rejected"] }, createdAt: { gt: new Date(Date.now() - 30 * 86_400_000) } },
      include: { room: { select: { id: true, name: true, category: true } } },
      orderBy: { id: "desc" },
      take: 20,
    });
    ok(res, {
      consent: { agreed: consent, version: TREEHOLE_CONSENT_VERSION },
      open: config.open,
      studentOnly: config.studentOnly,
      eligible: staffMember || !config.studentOnly || Boolean(user?.studentSso),
      canStart: staffMember || config.open,
      help: publicHelpChannels(config),
      roles: { host: viewer.isHost, admin: viewer.isAdmin, siteAdmin: viewer.isSiteAdmin },
      sessions,
      rooms: memberships.map((member) => ({
        id: member.room.id,
        name: member.room.name,
        category: member.room.category,
        categoryLabel: roomCategoryLabel(member.room.category),
        intro: member.room.intro,
        alias: member.alias,
        unread: roomUnreadMap.get(member.roomId) ?? 0,
        lastMessageAt: member.room.lastMessageAt,
      })),
      applications: applications.map((application) => ({
        id: application.id,
        status: application.status,
        rejectReason: application.rejectReason,
        createdAt: application.createdAt,
        room: { id: application.room.id, name: application.room.name, categoryLabel: roomCategoryLabel(application.room.category) },
      })),
    });
  } catch (error) {
    next(error);
  }
});

const consentSchema = z.object({ version: z.literal(TREEHOLE_CONSENT_VERSION) });

treeholeRouter.post("/consent", validate(consentSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    await prisma.treeholeConsent.upsert({
      where: { userId: viewer.userId },
      create: { userId: viewer.userId, version: TREEHOLE_CONSENT_VERSION },
      update: { version: TREEHOLE_CONSENT_VERSION, agreedAt: new Date() },
    });
    ok(res, { agreed: true, version: TREEHOLE_CONSENT_VERSION });
  } catch (error) {
    next(error);
  }
});

treeholeRouter.get("/hosts", async (_req, res, next) => {
  try {
    const hosts = await prisma.treeholeStaff.findMany({
      where: { schoolId: viewerOf(res).schoolId, enabled: true, isHost: true, hostCode: { not: null } },
      include: { shifts: true },
      orderBy: { hostCode: "asc" },
    });
    const now = new Date();
    const list = hosts.map((host) => publicHost(host, now));
    list.sort((a, b) => Number(b.online) - Number(a.online) || a.code.localeCompare(b.code));
    ok(res, { hosts: list });
  } catch (error) {
    next(error);
  }
});

// ---- 图片 ----

const uploadImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: TREEHOLE_IMAGE_MAX_SOURCE_BYTES, files: 1 } });

treeholeRouter.post("/images", (req, res, next) => {
  uploadImage.single("file")(req, res, (error: any) => {
    if (!error) return next();
    if (error?.code === "LIMIT_FILE_SIZE") return next(Errors.badRequest("图片不能超过 15MB"));
    return next(error);
  });
}, async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    await requireConsent(viewer.userId);
    takeTreeholeRate(`image:${viewer.userId}`, 30, 60 * 60_000, "图片发得有点多，休息一会儿再发吧");
    const file = req.file;
    if (!file?.buffer?.length) throw Errors.badRequest("请先选择图片");
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/iu.test(file.mimetype || "")) throw Errors.badRequest("只能发送 JPG、PNG、WebP 图片");
    const image = await storeTreeholeImage(viewer.userId, file.buffer);
    ok(res, { id: image.id, width: image.width, height: image.height });
  } catch (error) {
    next(error);
  }
});

async function canViewImage(imageId: number, viewer: TreeholeViewer) {
  const image = await prisma.treeholeImage.findUnique({ where: { id: imageId } });
  if (!image) return null;
  if (image.uploaderId === viewer.userId) return image;
  const sessionMessage = await prisma.treeholeMessage.findFirst({ where: { imageId }, select: { session: { select: { visitorId: true, hostId: true } } } });
  if (sessionMessage) {
    const role = treeholeSessionRole(sessionMessage.session, {
      userId: viewer.userId,
      staffId: viewer.staff?.id ?? null,
      isHost: viewer.isHost,
      isAdmin: viewer.isAdmin,
    });
    return role ? image : null;
  }
  const roomMessage = await prisma.treeholeRoomMessage.findFirst({ where: { imageId }, select: { roomId: true, recalledAt: true } });
  if (!roomMessage) return null;
  if (viewer.isAdmin) return image;
  if (roomMessage.recalledAt) return null;
  const member = await prisma.treeholeRoomMember.findFirst({ where: { roomId: roomMessage.roomId, userId: viewer.userId, status: "active" }, select: { id: true } });
  return member ? image : null;
}

treeholeRouter.get("/images/:id", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const image = await canViewImage(parseTreeholeId(req.params.id, "图片编号"), viewer);
    if (!image) throw Errors.notFound("图片不存在或无权查看");
    const buffer = await readTreeholeImage(image.storageKey).catch(() => null);
    if (!buffer) throw Errors.notFound("图片不存在");
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

// ---- 留言倾诉 ----
// 学生的留言先进本校的待认领池；在岗的洞主自己认领能回答的留言再展开回复。

const createSessionSchema = z.object({
  mode: z.literal("async").optional().default("async"),
  topics: z.array(z.string().trim().max(10)).max(5).optional().default([]),
  content: z.string().trim().max(2000, "单条消息不能超过 2000 字").optional().default(""),
  imageId: z.number().int().positive().nullable().optional().default(null),
});

treeholeRouter.post("/sessions", validate(createSessionSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const body = req.body as z.infer<typeof createSessionSchema>;
    await requireConsent(viewer.userId);
    const config = await loadTreeholeConfig(viewer.schoolId);
    const staffMember = viewer.isHost || viewer.isAdmin;
    if (!config.open && !staffMember) throw Errors.forbidden("树洞暂未开放，开放后会在这里通知大家");
    if (config.studentOnly && !staffMember) {
      const user = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { studentSso: true, schoolId: true } });
      if (!user?.studentSso) throw Errors.forbidden(`树洞仅面向在校同学，请先用学校统一身份认证登录${getSchool(user?.schoolId).brandName}`);
    }
    if (!body.content && !body.imageId) throw Errors.badRequest("先说点什么吧");
    const open = await prisma.treeholeSession.findFirst({ where: { visitorId: viewer.userId, status: "active" }, select: { id: true } });
    if (open) throw Errors.conflict("你还有一条留言没有结束，可以接着在里面说，或者先结束它再写新的");
    takeTreeholeRate(`session:${viewer.userId}`, 6, 24 * 60 * 60_000, "今天写的留言有点多了，可以接着之前的留言说");

    const session = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${-71000}::int, ${viewer.userId}::int)`;
      const active = await tx.treeholeSession.findFirst({ where: { visitorId: viewer.userId, status: "active" }, select: { id: true } });
      if (active) throw Errors.conflict("你还有一条留言没有结束，可以接着在里面说，或者先结束它再写新的");
      const now = new Date();
      const created = await tx.treeholeSession.create({
        data: {
          schoolId: viewer.schoolId,
          visitorId: viewer.userId,
          hostId: null,
          mode: "async",
          topics: normalizeTopics(body.topics),
          alias: generateVisitorAlias(),
          visitorSeenAt: now,
          lastMessageAt: now,
        },
      });
      const image = body.imageId ? await claimTreeholeImage(tx, body.imageId, viewer.userId) : null;
      const first = await tx.treeholeMessage.create({
        data: { sessionId: created.id, sender: "visitor", kind: image ? "image" : "text", content: body.content, imageId: image?.id ?? null },
      });
      await tx.treeholeSession.update({ where: { id: created.id }, data: { visitorReadId: first.id } });
      return created;
    });
    // 只提醒此刻在岗的洞主；其他人上线后在工作台的待认领里能看到。
    const hosts = await prisma.treeholeStaff.findMany({
      where: { schoolId: viewer.schoolId, enabled: true, isHost: true, hostCode: { not: null }, userId: { not: viewer.userId } },
      include: { shifts: true },
    });
    const now = new Date();
    await notifyTreehole(hosts.filter((host) => presenceOf(host, now).online).map((host) => host.userId), {
      title: "有新的树洞留言待认领",
      content: "一条新留言进入了待认领，进入洞主工作台看看能不能接住它。",
      link: "/treehole/host",
      type: "treehole-pool-new",
      level: "weak",
      extra: { sessionId: session.id },
    });
    ok(res, { id: session.id });
  } catch (error) {
    next(error);
  }
});

function poolPreview(content: string, kind: string) {
  if (kind === "image") return content ? `[图片] ${content.slice(0, 60)}` : "[图片]";
  return content.replace(/\s+/gu, " ").slice(0, 120);
}

// 待认领池只给在岗的洞主看：先看留言开头和标签，决定接不接。
treeholeRouter.get("/host/pool", async (_req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const presence = presenceOf(staff);
    const where = { schoolId: viewer.schoolId, hostId: null, status: "active", visitorId: { not: viewer.userId } };
    const total = await prisma.treeholeSession.count({ where });
    if (!presence.online) {
      ok(res, { online: false, total, list: [] });
      return;
    }
    const rows = await prisma.treeholeSession.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 50,
      include: { messages: { where: { sender: "visitor" }, orderBy: { id: "asc" }, take: 1, select: { content: true, kind: true } } },
    });
    ok(res, {
      online: true,
      total,
      list: rows.map((row) => ({
        id: row.id,
        alias: row.alias,
        topics: row.topics,
        createdAt: row.createdAt,
        preview: row.messages[0] ? poolPreview(row.messages[0].content, row.messages[0].kind) : "",
      })),
    });
  } catch (error) {
    next(error);
  }
});

treeholeRouter.post("/sessions/:id/claim", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    if (!presenceOf(staff).online) throw Errors.badRequest("上线后才能认领留言");
    const sessionId = parseTreeholeId(req.params.id, "留言编号");
    const now = new Date();
    const claimed = await prisma.treeholeSession.updateMany({
      where: { id: sessionId, schoolId: viewer.schoolId, hostId: null, status: "active", visitorId: { not: viewer.userId } },
      data: { hostId: staff.id, claimedAt: now, hostSeenAt: now, hostNotifiedAt: now },
    });
    if (!claimed.count) throw Errors.conflict("这条留言已经被其他小艾绒认领了");
    const session = await prisma.treeholeSession.findUniqueOrThrow({ where: { id: sessionId } });
    await notifyTreehole([session.visitorId], {
      title: "你的留言有小艾绒认领了",
      content: `${hostDisplayName(staff.hostCode, staff.hostNickname)} 认领了你的留言，回复后会提醒你。`,
      link: `/treehole/session/${sessionId}`,
      type: "treehole-claimed",
      extra: { sessionId },
    });
    ok(res, { id: sessionId });
  } catch (error) {
    next(error);
  }
});

// 认领了但还没回复，觉得自己接不住，可以放回待认领。
treeholeRouter.post("/sessions/:id/release", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const released = await prisma.treeholeSession.updateMany({
      where: { id: parseTreeholeId(req.params.id, "留言编号"), schoolId: viewer.schoolId, hostId: staff.id, firstReplyAt: null, status: "active" },
      data: { hostId: null, claimedAt: null },
    });
    if (!released.count) throw Errors.badRequest("已经回复过的留言不能放回");
    ok(res, { released: true });
  } catch (error) {
    next(error);
  }
});

const topicsSchema = z.object({ topics: z.array(z.string().trim().max(10)).max(5) });

// 学生自己或接待洞主可以改留言标签。
treeholeRouter.post("/sessions/:id/topics", validate(topicsSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { session, role } = await loadSessionFor(parseTreeholeId(req.params.id, "留言编号"), viewer);
    if (role === "admin") throw Errors.forbidden("核心管理员只能查阅");
    const topics = normalizeTopics(req.body.topics);
    await prisma.treeholeSession.update({ where: { id: session.id }, data: { topics } });
    ok(res, { topics });
  } catch (error) {
    next(error);
  }
});

const pageSchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  before: z.coerce.number().int().positive().optional(),
});

treeholeRouter.get("/sessions/:id", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { session, role } = await loadSessionFor(parseTreeholeId(req.params.id, "会话编号"), viewer);
    const config = await loadTreeholeConfig(viewerOf(res).schoolId);
    const rows = await prisma.treeholeMessage.findMany({ where: { sessionId: session.id }, orderBy: { id: "desc" }, take: MESSAGE_PAGE + 1 });
    const hasMore = rows.length > MESSAGE_PAGE;
    const messages = rows.slice(0, MESSAGE_PAGE).reverse();
    await markSeen(session, role, messages.at(-1)?.id ?? 0);
    if (role === "admin") {
      await writeTreeholeAudit({ actor: viewer, action: "session.view", targetType: "session", targetId: session.id, detail: { alias: session.alias } });
    }
    const roomsForInvite = role === "host"
      ? await prisma.treeholeRoom.findMany({ where: { schoolId: viewer.schoolId, status: "active" }, select: { id: true, name: true, category: true }, orderBy: { id: "asc" } })
      : [];
    ok(res, {
      session: serializeSession(session, role, config),
      messages: await serializeMessages(messages, role, session.visitorId),
      hasMore,
      inviteRooms: roomsForInvite.map((room) => ({ ...room, categoryLabel: roomCategoryLabel(room.category) })),
    });
  } catch (error) {
    next(error);
  }
});

treeholeRouter.get("/sessions/:id/messages", validate(pageSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { session, role } = await loadSessionFor(parseTreeholeId(req.params.id, "会话编号"), viewer);
    const query = req.query as unknown as z.infer<typeof pageSchema>;
    const config = await loadTreeholeConfig(viewerOf(res).schoolId);
    let messages: SessionMessageRow[];
    let hasMore = false;
    if (query.before) {
      const rows = await prisma.treeholeMessage.findMany({ where: { sessionId: session.id, id: { lt: query.before } }, orderBy: { id: "desc" }, take: MESSAGE_PAGE + 1 });
      hasMore = rows.length > MESSAGE_PAGE;
      messages = rows.slice(0, MESSAGE_PAGE).reverse();
    } else {
      messages = await prisma.treeholeMessage.findMany({ where: { sessionId: session.id, id: { gt: query.after ?? 0 } }, orderBy: { id: "asc" }, take: 200 });
      await markSeen(session, role, messages.at(-1)?.id ?? 0);
    }
    ok(res, {
      session: serializeSession(session, role, config),
      messages: await serializeMessages(messages, role, session.visitorId),
      hasMore,
    });
  } catch (error) {
    next(error);
  }
});

/** 留言待认领时没有洞主可提醒，返回 null。 */
function counterpartUserId(session: { visitorId: number; host: { userId: number } | null }, senderRole: "visitor" | "host") {
  return senderRole === "visitor" ? session.host?.userId ?? null : session.visitorId;
}

function messageReminder(session: { id: number; alias: string }, senderRole: "visitor" | "host") {
  return senderRole === "visitor"
    ? { title: "树洞有新消息", content: `${session.alias} 给你发来了新消息。`, link: `/treehole/session/${session.id}`, type: "treehole-message", extra: { sessionId: session.id } }
    : { title: "小艾绒回复你了", content: "你在艾绒树洞的倾诉有了新回复。", link: `/treehole/session/${session.id}`, type: "treehole-message", extra: { sessionId: session.id } };
}

async function remindIfStillUnread(sessionId: number, senderRole: "visitor" | "host", messageId: number) {
  try {
    await prisma.$transaction(async (tx) => {
      const session = await tx.treeholeSession.findUnique({ where: { id: sessionId }, include: { host: { select: { userId: true } } } });
      if (!session) return;
      const readId = senderRole === "visitor" ? session.hostReadId : session.visitorReadId;
      const seenAt = senderRole === "visitor" ? session.hostSeenAt : session.visitorSeenAt;
      const notifiedAt = senderRole === "visitor" ? session.hostNotifiedAt : session.visitorNotifiedAt;
      if (readId >= messageId) return;
      if (!shouldNotifyCounterpart({ seenAt, notifiedAt }, new Date())) return;
      await tx.treeholeSession.update({
        where: { id: sessionId },
        data: senderRole === "visitor" ? { hostNotifiedAt: new Date() } : { visitorNotifiedAt: new Date() },
      });
      const recipient = counterpartUserId(session, senderRole);
      if (recipient) await notifyTreehole([recipient], messageReminder(session, senderRole), tx);
    });
  } catch (error) {
    console.warn("[treehole] delayed reminder failed", (error as Error)?.message);
  }
}

const sendSchema = z.object({
  content: z.string().trim().max(2000, "单条消息不能超过 2000 字").optional().default(""),
  imageId: z.number().int().positive().nullable().optional().default(null),
});

treeholeRouter.post("/sessions/:id/messages", validate(sendSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const body = req.body as z.infer<typeof sendSchema>;
    const { session, role } = await loadSessionFor(parseTreeholeId(req.params.id, "会话编号"), viewer);
    if (role === "admin") throw Errors.forbidden("核心管理员只能查阅，不能在会话里发言");
    if (session.status !== "active") throw Errors.badRequest("这次倾诉已经结束了");
    if (!body.content && !body.imageId) throw Errors.badRequest("消息不能为空");
    takeTreeholeRate(`message:${viewer.userId}`, 40, 60_000, "发得太快了，慢一点也没关系");

    const result = await prisma.$transaction(async (tx) => {
      const image = body.imageId ? await claimTreeholeImage(tx, body.imageId, viewer.userId) : null;
      const message = await tx.treeholeMessage.create({
        data: { sessionId: session.id, sender: role, kind: image ? "image" : "text", content: body.content, imageId: image?.id ?? null },
      });
      const fresh = await tx.treeholeSession.findUniqueOrThrow({ where: { id: session.id } });
      const now = new Date();
      const notify = role === "visitor"
        ? shouldNotifyCounterpart({ seenAt: fresh.hostSeenAt, notifiedAt: fresh.hostNotifiedAt }, now)
        : shouldNotifyCounterpart({ seenAt: fresh.visitorSeenAt, notifiedAt: fresh.visitorNotifiedAt }, now);
      await tx.treeholeSession.update({
        where: { id: session.id },
        data: {
          lastMessageAt: message.createdAt,
          ...(role === "visitor"
            ? { visitorReadId: message.id, visitorSeenAt: now, ...(notify ? { hostNotifiedAt: now } : {}) }
            : {
              hostReadId: message.id,
              hostSeenAt: now,
              ...(fresh.firstReplyAt ? {} : { firstReplyAt: now }),
              ...(notify ? { visitorNotifiedAt: now } : {}),
            }),
        },
      });
      const recipient = counterpartUserId(session, role);
      if (notify && recipient) await notifyTreehole([recipient], messageReminder(session, role), tx);
      return { message, notify };
    });
    // 对方刚才还开着页面所以没提醒；若它其实已经离开，过一会儿仍没读到这条就补一条提醒。
    if (!result.notify) setTimeout(() => void remindIfStillUnread(session.id, role, result.message.id), TREEHOLE_PRESENCE_SEEN_MS + 5_000).unref();
    const [serialized] = await serializeMessages([result.message], role, session.visitorId);
    ok(res, serialized);
  } catch (error) {
    next(error);
  }
});

treeholeRouter.post("/sessions/:id/end", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { session, role } = await loadSessionFor(parseTreeholeId(req.params.id, "会话编号"), viewer);
    if (role !== "visitor") throw Errors.forbidden("只有来访者本人可以结束这次倾诉");
    if (session.status !== "active") throw Errors.badRequest("这次倾诉已经结束了");
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.treeholeMessage.create({ data: { sessionId: session.id, sender: "system", kind: "notice", content: "来访者结束了本次倾诉，这个虚拟 ID 已失效。" } });
      await tx.treeholeSession.update({ where: { id: session.id }, data: { status: "ended", endedAt: now, endedBy: "visitor", lastMessageAt: now } });
    });
    ok(res, { ended: true });
  } catch (error) {
    next(error);
  }
});

const contactSchema = z.object({ contact: z.string().trim().min(2, "请填写联系方式").max(100, "联系方式最多 100 字") });

treeholeRouter.post("/sessions/:id/contact", validate(contactSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { session, role } = await loadSessionFor(parseTreeholeId(req.params.id, "会话编号"), viewer);
    if (role !== "visitor") throw Errors.forbidden("只有来访者本人可以留下联系方式");
    await prisma.$transaction(async (tx) => {
      await tx.treeholeSession.update({ where: { id: session.id }, data: { contact: req.body.contact, contactAt: new Date() } });
      await tx.treeholeMessage.create({ data: { sessionId: session.id, sender: "system", kind: "notice", content: "来访者自愿留下了联系方式，仅接待洞主和核心管理员可见。" } });
      if (session.host) await notifyTreehole([session.host.userId], {
        title: "来访者留下了联系方式",
        content: `${session.alias} 自愿留下了联系方式，进入会话查看。`,
        link: `/treehole/session/${session.id}`,
        type: "treehole-contact",
        extra: { sessionId: session.id },
      }, tx);
    });
    ok(res, { saved: true });
  } catch (error) {
    next(error);
  }
});

const crisisSchema = z.object({
  crisisType: z.string().trim().min(1, "请选择危机类型").max(40),
  urgency: z.enum(TREEHOLE_CRISIS_URGENCIES),
  currentState: z.string().trim().min(2, "请描述来访者当下的状态").max(1000),
  hostRecord: z.string().trim().min(2, "请填写你的初步陪伴记录").max(2000),
  requestReveal: z.boolean().optional().default(false),
  revealReason: z.string().trim().max(500).optional().default(""),
});

const tagSchema = z.object({
  tag: z.enum(TREEHOLE_SESSION_TAGS),
  crisis: crisisSchema.optional(),
});

treeholeRouter.post("/sessions/:id/tag", validate(tagSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const body = req.body as z.infer<typeof tagSchema>;
    const { session, role } = await loadSessionFor(parseTreeholeId(req.params.id, "会话编号"), viewer);
    if (role !== "host") throw Errors.forbidden("只有接待这次会话的洞主可以打标签");
    if (session.tag === "crisis") throw Errors.badRequest("高危转介已提交，后续由核心管理员跟进，标签不能撤回");
    if (body.tag !== "crisis") {
      await prisma.treeholeSession.update({ where: { id: session.id }, data: { tag: body.tag } });
      ok(res, { tag: body.tag });
      return;
    }
    // 高危转介：表单不提交，标签就不成立。
    if (!body.crisis) throw Errors.badRequest("标记高危转介前，请先填写危机情况表单");
    if (body.crisis.requestReveal && body.crisis.revealReason.length < 2) throw Errors.badRequest("申请实名溯源需要写明理由");
    const staff = requireTreeholeHost(viewer);
    const caseId = await prisma.$transaction(async (tx) => {
      const crisis = await tx.treeholeCrisisCase.create({
        data: {
          sessionId: session.id,
          reporterId: staff.id,
          crisisType: body.crisis!.crisisType,
          urgency: body.crisis!.urgency,
          currentState: body.crisis!.currentState,
          hostRecord: body.crisis!.hostRecord,
        },
      });
      await tx.treeholeSession.update({ where: { id: session.id }, data: { tag: "crisis" } });
      await tx.treeholeMessage.create({ data: { sessionId: session.id, sender: "system", kind: "notice", content: "小艾绒为你附上了学校心理发展中心的求助方式，它们会一直显示在对话上方。" } });
      if (body.crisis!.requestReveal) {
        const request = await tx.treeholeRevealRequest.create({ data: { caseId: crisis.id, requesterId: staff.id, reason: body.crisis!.revealReason } });
        if (staff.isAdmin) await tx.treeholeRevealApproval.create({ data: { requestId: request.id, staffId: staff.id } });
      }
      const admins = await treeholeAdminUserIds(tx);
      const urgencyLabel = body.crisis!.urgency === "urgent" ? "紧急" : body.crisis!.urgency === "high" ? "较高" : "一般";
      await notifyTreehole(admins, {
        title: `树洞高危告警（${urgencyLabel}）`,
        content: `${hostDisplayName(staff.hostCode, staff.hostNickname)} 把一次会话标记为高危转介：${body.crisis!.crisisType}。请尽快进入后台评估。`,
        link: `/treehole/admin?tab=cases&case=${crisis.id}`,
        type: "treehole-crisis",
        level: "strong",
        extra: { caseId: crisis.id },
      }, tx);
      if (body.crisis!.requestReveal) {
        await notifyTreehole(admins, {
          title: "树洞实名溯源审批申请",
          content: `${hostDisplayName(staff.hostCode, staff.hostNickname)} 申请溯源一位高危来访者，需要两名核心管理员同意。`,
          link: `/treehole/admin?tab=cases&case=${crisis.id}`,
          type: "treehole-reveal-request",
          level: "strong",
          extra: { caseId: crisis.id },
        }, tx);
      }
      await notifyTreehole([session.visitorId], {
        title: "小艾绒给你留了一些求助方式",
        content: "如果需要更专业的帮助，可以联系学校心理发展中心，我们也会一直陪着你。",
        link: `/treehole/session/${session.id}`,
        type: "treehole-help",
        extra: { sessionId: session.id },
      }, tx);
      await writeTreeholeAudit({
        actor: viewer,
        action: "crisis.report",
        targetType: "case",
        targetId: crisis.id,
        detail: { sessionId: session.id, urgency: body.crisis!.urgency, crisisType: body.crisis!.crisisType, requestReveal: body.crisis!.requestReveal },
      }, tx);
      return crisis.id;
    });
    ok(res, { tag: "crisis", caseId });
  } catch (error) {
    if ((error as any)?.code === "P2002") {
      next(Errors.conflict("这次会话已经提交过高危转介"));
      return;
    }
    next(error);
  }
});

const inviteSchema = z.object({ roomId: z.number().int().positive() });

treeholeRouter.post("/sessions/:id/room-invites", validate(inviteSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { session, role } = await loadSessionFor(parseTreeholeId(req.params.id, "会话编号"), viewer);
    if (role !== "host") throw Errors.forbidden("只有接待这次会话的洞主可以推荐宣泄室");
    if (session.status !== "active") throw Errors.badRequest("这次倾诉已经结束了");
    const room = await prisma.treeholeRoom.findUnique({ where: { id: req.body.roomId } });
    if (!room || room.schoolId !== viewer.schoolId || room.status !== "active") throw Errors.badRequest("这个宣泄室已关闭");
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.treeholeMessage.create({
        data: { sessionId: session.id, sender: "host", kind: "room-invite", content: room.name, roomId: room.id },
      });
      await tx.treeholeSession.update({ where: { id: session.id }, data: { lastMessageAt: created.createdAt, hostReadId: created.id } });
      return created;
    });
    const [serialized] = await serializeMessages([message], role, session.visitorId);
    ok(res, serialized);
  } catch (error) {
    next(error);
  }
});

// ---- 洞主工作台 ----

treeholeRouter.get("/host/overview", async (_req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const config = await loadTreeholeConfig(viewerOf(res).schoolId);
    const now = new Date();
    const [active, ended, rooms, poolCount, pendingBookings] = await Promise.all([
      listSessionSummaries({ hostId: staff.id, status: "active" }, "host", config, { take: 100 }),
      listSessionSummaries({ hostId: staff.id, status: "ended" }, "host", config, { take: 30 }),
      prisma.treeholeRoom.findMany({
        where: { schoolId: viewer.schoolId, status: "active" },
        orderBy: { lastMessageAt: "desc" },
        include: { members: { where: { status: "active" }, select: { id: true, userId: true, role: true, readId: true } } },
      }),
      prisma.treeholeSession.count({ where: { schoolId: viewer.schoolId, hostId: null, status: "active", visitorId: { not: viewer.userId } } }),
      prisma.treeholeBooking.count({ where: { hostId: staff.id, status: "pending", startAt: { gt: now } } }),
    ]);
    const presence = presenceOf(staff);
    ok(res, {
      profile: {
        id: staff.id,
        code: staff.hostCode,
        name: hostDisplayName(staff.hostCode, staff.hostNickname),
        hostNickname: staff.hostNickname,
        intro: staff.intro,
        isAdmin: viewer.isAdmin,
        presence: {
          online: presence.online,
          source: presence.source,
          until: presence.until,
          inShift: presence.inShift,
          nextShiftAt: presence.nextShiftAt,
        },
        shifts: staff.shifts
          .map((shift) => ({ weekday: shift.weekday, startMinute: shift.startMinute, endMinute: shift.endMinute }))
          .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
      },
      activeSessions: active,
      endedSessions: ended,
      rooms: rooms.map((room) => {
        const mine = room.members.find((member) => member.userId === viewer.userId && member.role === "host");
        return {
          id: room.id,
          name: room.name,
          category: room.category,
          categoryLabel: roomCategoryLabel(room.category),
          intro: room.intro,
          memberCount: room.members.filter((member) => member.role === "visitor").length,
          hostCount: room.members.filter((member) => member.role === "host").length,
          joined: Boolean(mine),
          lastMessageAt: room.lastMessageAt,
        };
      }),
      poolCount,
      pendingBookings,
    });
  } catch (error) {
    next(error);
  }
});

const presenceSchema = z.object({ action: z.enum(["online", "offline"]) });

treeholeRouter.post("/host/presence", validate(presenceSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const now = new Date();
    const updated = await prisma.treeholeStaff.update({
      where: { id: staff.id },
      data: presenceOverrideFor(req.body.action, staff.shifts, now),
      include: { shifts: true },
    });
    const presence = presenceOf(updated, now);
    ok(res, { online: presence.online, source: presence.source, until: presence.until, inShift: presence.inShift, nextShiftAt: presence.nextShiftAt });
  } catch (error) {
    next(error);
  }
});

const profileSchema = z.object({
  intro: z.string().trim().max(80, "简介最多 80 字").optional(),
  hostNickname: z.string().max(40).optional(),
});

treeholeRouter.patch("/host/profile", validate(profileSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const body = req.body as z.infer<typeof profileSchema>;
    const saved = await prisma.$transaction(async (tx) => {
      const hostNickname = body.hostNickname !== undefined ? await checkedHostNickname(tx, viewer.schoolId, staff.id, body.hostNickname) : undefined;
      const row = await tx.treeholeStaff.update({
        where: { id: staff.id },
        data: { ...(body.intro !== undefined ? { intro: body.intro } : {}), ...(hostNickname !== undefined ? { hostNickname } : {}) },
      });
      if (hostNickname !== undefined && hostNickname !== staff.hostNickname) {
        await syncHostRoomAlias(tx, row);
        await writeTreeholeAudit({ actor: viewer, action: "staff.nickname", targetType: "staff", targetId: staff.id, detail: { hostNickname } }, tx);
      }
      return row;
    });
    ok(res, { intro: saved.intro, hostNickname: saved.hostNickname, name: hostDisplayName(saved.hostCode, saved.hostNickname) });
  } catch (error) {
    next(error);
  }
});

const hostSessionsSchema = z.object({
  status: z.enum(["active", "ended"]).optional().default("ended"),
  page: z.coerce.number().int().min(1).max(500).optional().default(1),
});

treeholeRouter.get("/host/sessions", validate(hostSessionsSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const query = req.query as unknown as z.infer<typeof hostSessionsSchema>;
    const config = await loadTreeholeConfig(viewerOf(res).schoolId);
    const where = { hostId: staff.id, status: query.status };
    const [total, list] = await Promise.all([
      prisma.treeholeSession.count({ where }),
      listSessionSummaries(where, "host", config, { take: 30, skip: (query.page - 1) * 30 }),
    ]);
    ok(res, { total, page: query.page, size: 30, list });
  } catch (error) {
    next(error);
  }
});

treeholeRouter.use("/", treeholeRoomRouter);
treeholeRouter.use("/", treeholeBookingRouter);
treeholeRouter.use("/admin", treeholeAdminRouter);
