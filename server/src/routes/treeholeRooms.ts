import { Router } from "express";
import { z } from "zod";
import type { Prisma, TreeholeRoomMember, TreeholeRoomMessage } from "@prisma/client";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  claimTreeholeImage,
  imageSummaries,
  notifyTreehole,
  parseTreeholeId,
  requireConsent,
  requireTreeholeHost,
  takeTreeholeRate,
  treeholeAdminUserIds,
  viewerOf,
  writeTreeholeAudit,
  type TreeholeViewer,
} from "../services/treehole";
import {
  hostDisplayName,
  looksLikeContactExchange,
  nextRoomSeq,
  roomCategoryLabel,
  roomVisitorAlias,
  TREEHOLE_ROOM_CATEGORIES,
  TREEHOLE_ROOM_FOUNDERS_REQUIRED,
} from "../services/treeholePolicy";

// 情绪宣泄室：多人实时聊天室。来访者只能经接待洞主推荐、群管理员审核进群，群内只显示虚拟 ID。

export const treeholeRoomRouter = Router();

const ROOM_LOCK = -71001;
const PROPOSAL_LOCK = -71002;
const MESSAGE_PAGE = 50;

async function loadRoomFor(roomId: number, viewer: TreeholeViewer) {
  const room = await prisma.treeholeRoom.findUnique({ where: { id: roomId } });
  if (!room) throw Errors.notFound("宣泄室不存在");
  const member = await prisma.treeholeRoomMember.findFirst({ where: { roomId, userId: viewer.userId, status: "active" } });
  // 洞主被停用后不再是群管理员，也不能再进群。
  const usableMember = member && (member.role === "visitor" || viewer.isHost) ? member : null;
  if (room.status !== "active" && !viewer.isAdmin) throw Errors.notFound("这个宣泄室已经关闭");
  if (!usableMember && !viewer.isAdmin) throw Errors.notFound("宣泄室不存在");
  const isRoomAdmin = usableMember?.role === "host";
  return { room, member: usableMember, isRoomAdmin, canModerate: isRoomAdmin || viewer.isAdmin };
}

async function roomHostUserIds(roomId: number, store: Prisma.TransactionClient | typeof prisma = prisma) {
  const rows = await store.treeholeRoomMember.findMany({ where: { roomId, role: "host", status: "active" }, select: { userId: true } });
  return rows.map((row) => row.userId);
}

async function serializeRoomMessages(messages: TreeholeRoomMessage[], viewer: TreeholeViewer, me: TreeholeRoomMember | null) {
  const memberIds = [...new Set(messages.map((message) => message.memberId))];
  const [members, images] = await Promise.all([
    memberIds.length ? prisma.treeholeRoomMember.findMany({ where: { id: { in: memberIds } }, select: { id: true, alias: true, role: true } }) : [],
    imageSummaries(messages.filter((message) => !message.recalledAt || viewer.isAdmin).map((message) => message.imageId)),
  ]);
  const memberMap = new Map(members.map((member) => [member.id, member]));
  return messages.map((message) => {
    const author = memberMap.get(message.memberId);
    const recalled = Boolean(message.recalledAt);
    // 撤回的消息只有核心管理员还能看到原文，用于违规记录。
    const showOriginal = !recalled || viewer.isAdmin;
    return {
      id: message.id,
      memberId: message.memberId,
      alias: author?.alias ?? "已离开的成员",
      isHost: author?.role === "host",
      mine: me ? message.memberId === me.id : false,
      kind: message.kind,
      content: showOriginal ? message.content : "",
      image: showOriginal && message.imageId ? images.get(message.imageId) ?? null : null,
      recalled,
      createdAt: message.createdAt,
    };
  });
}

function serializeRoom(room: { id: number; name: string; category: string; intro: string; status: string; closeReason: string | null; createdAt: Date }) {
  return {
    id: room.id,
    name: room.name,
    category: room.category,
    categoryLabel: roomCategoryLabel(room.category),
    intro: room.intro,
    status: room.status,
    closeReason: room.closeReason,
    createdAt: room.createdAt,
  };
}

/** 来访者只看得到自己进群之后的消息；洞主和核心管理员看得到全部。 */
function visibleRoomMessages(roomId: number, member: TreeholeRoomMember | null): Prisma.TreeholeRoomMessageWhereInput {
  return member?.role === "visitor" ? { roomId, createdAt: { gte: member.joinedAt } } : { roomId };
}

async function markRoomRead(member: TreeholeRoomMember | null, lastId: number) {
  if (!member || lastId <= member.readId) return;
  await prisma.treeholeRoomMember.update({ where: { id: member.id }, data: { readId: lastId } });
}

const pageSchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  before: z.coerce.number().int().positive().optional(),
});

treeholeRoomRouter.get("/rooms/:id", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { room, member, isRoomAdmin, canModerate } = await loadRoomFor(parseTreeholeId(req.params.id, "宣泄室编号"), viewer);
    const rows = await prisma.treeholeRoomMessage.findMany({ where: visibleRoomMessages(room.id, member), orderBy: { id: "desc" }, take: MESSAGE_PAGE + 1 });
    const messages = rows.slice(0, MESSAGE_PAGE).reverse();
    await markRoomRead(member, messages.at(-1)?.id ?? 0);
    if (!member) await writeTreeholeAudit({ actor: viewer, action: "room.view", targetType: "room", targetId: room.id, detail: { name: room.name } });
    const counts = await prisma.treeholeRoomMember.groupBy({ by: ["role"], where: { roomId: room.id, status: "active" }, _count: { _all: true } });
    ok(res, {
      room: serializeRoom(room),
      me: member ? { memberId: member.id, alias: member.alias, role: member.role } : null,
      isRoomAdmin,
      isCoreAdmin: viewer.isAdmin,
      canModerate,
      readOnly: !member || room.status !== "active",
      visitorCount: counts.find((row) => row.role === "visitor")?._count._all ?? 0,
      hostCount: counts.find((row) => row.role === "host")?._count._all ?? 0,
      messages: await serializeRoomMessages(messages, viewer, member),
      hasMore: rows.length > MESSAGE_PAGE,
    });
  } catch (error) {
    next(error);
  }
});

treeholeRoomRouter.get("/rooms/:id/messages", validate(pageSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { room, member } = await loadRoomFor(parseTreeholeId(req.params.id, "宣泄室编号"), viewer);
    const query = req.query as unknown as z.infer<typeof pageSchema>;
    let messages: TreeholeRoomMessage[];
    let hasMore = false;
    let recalledIds: number[] = [];
    if (query.before) {
      const rows = await prisma.treeholeRoomMessage.findMany({ where: { ...visibleRoomMessages(room.id, member), id: { lt: query.before } }, orderBy: { id: "desc" }, take: MESSAGE_PAGE + 1 });
      hasMore = rows.length > MESSAGE_PAGE;
      messages = rows.slice(0, MESSAGE_PAGE).reverse();
    } else {
      const after = query.after ?? 0;
      messages = await prisma.treeholeRoomMessage.findMany({ where: { ...visibleRoomMessages(room.id, member), id: { gt: after } }, orderBy: { id: "asc" }, take: 200 });
      await markRoomRead(member, messages.at(-1)?.id ?? 0);
      // 轮询时顺带告诉客户端最近撤回了哪些旧消息，好把它们换成“已撤回”。
      const recalled = await prisma.treeholeRoomMessage.findMany({
        where: { roomId: room.id, id: { lte: after }, recalledAt: { gt: new Date(Date.now() - 10 * 60_000) } },
        select: { id: true },
      });
      recalledIds = recalled.map((row) => row.id);
    }
    ok(res, {
      room: serializeRoom(room),
      messages: await serializeRoomMessages(messages, viewer, member),
      recalledIds: viewer.isAdmin ? [] : recalledIds,
      hasMore,
      memberActive: Boolean(member),
    });
  } catch (error) {
    next(error);
  }
});

const sendSchema = z.object({
  content: z.string().trim().max(1000, "单条消息不能超过 1000 字").optional().default(""),
  imageId: z.number().int().positive().nullable().optional().default(null),
});

treeholeRoomRouter.post("/rooms/:id/messages", validate(sendSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const body = req.body as z.infer<typeof sendSchema>;
    const { room, member } = await loadRoomFor(parseTreeholeId(req.params.id, "宣泄室编号"), viewer);
    if (!member) throw Errors.forbidden("你不在这个宣泄室里");
    if (room.status !== "active") throw Errors.badRequest("这个宣泄室已经关闭");
    if (!body.content && !body.imageId) throw Errors.badRequest("消息不能为空");
    if (member.role === "visitor" && looksLikeContactExchange(body.content)) {
      throw Errors.badRequest("宣泄室里不能交换联系方式或互加好友，保护好彼此的匿名");
    }
    takeTreeholeRate(`room-message:${viewer.userId}`, 20, 60_000, "发得太快了，慢一点也没关系");
    const message = await prisma.$transaction(async (tx) => {
      const image = body.imageId ? await claimTreeholeImage(tx, body.imageId, viewer.userId) : null;
      const created = await tx.treeholeRoomMessage.create({
        data: { roomId: room.id, memberId: member.id, kind: image ? "image" : "text", content: body.content, imageId: image?.id ?? null },
      });
      await tx.treeholeRoom.update({ where: { id: room.id }, data: { lastMessageAt: created.createdAt } });
      await tx.treeholeRoomMember.update({ where: { id: member.id }, data: { readId: created.id } });
      return created;
    });
    const [serialized] = await serializeRoomMessages([message], viewer, member);
    ok(res, serialized);
  } catch (error) {
    next(error);
  }
});

async function postRoomNotice(tx: Prisma.TransactionClient, roomId: number, memberId: number, content: string) {
  const notice = await tx.treeholeRoomMessage.create({ data: { roomId, memberId, kind: "notice", content } });
  await tx.treeholeRoom.update({ where: { id: roomId }, data: { lastMessageAt: notice.createdAt } });
  return notice;
}

treeholeRoomRouter.post("/rooms/:id/leave", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { room, member } = await loadRoomFor(parseTreeholeId(req.params.id, "宣泄室编号"), viewer);
    if (!member) throw Errors.badRequest("你不在这个宣泄室里");
    await prisma.$transaction(async (tx) => {
      await tx.treeholeRoomMember.update({ where: { id: member.id }, data: { status: "left", leftAt: new Date() } });
      if (room.status === "active") await postRoomNotice(tx, room.id, member.id, `${member.alias} 离开了宣泄室`);
    });
    ok(res, { left: true });
  } catch (error) {
    next(error);
  }
});

treeholeRoomRouter.post("/rooms/:id/enter", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const roomId = parseTreeholeId(req.params.id, "宣泄室编号");
    const member = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROOM_LOCK}::int, ${roomId}::int)`;
      const room = await tx.treeholeRoom.findUnique({ where: { id: roomId } });
      if (!room || room.status !== "active") throw Errors.notFound("这个宣泄室已经关闭");
      const existing = await tx.treeholeRoomMember.findFirst({ where: { roomId, userId: viewer.userId, status: "active" } });
      if (existing) return existing;
      // 进入宣泄室的洞主自动成为群管理员。
      const created = await tx.treeholeRoomMember.create({
        data: { roomId, userId: viewer.userId, role: "host", staffId: staff.id, alias: hostDisplayName(staff.hostCode) },
      });
      await postRoomNotice(tx, roomId, created.id, `${created.alias} 来到了宣泄室`);
      return created;
    });
    ok(res, { memberId: member.id });
  } catch (error) {
    next(error);
  }
});

const closeSchema = z.object({ reason: z.string().trim().min(2, "请写明关闭原因").max(200) });

treeholeRoomRouter.post("/rooms/:id/close", validate(closeSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { room, canModerate } = await loadRoomFor(parseTreeholeId(req.params.id, "宣泄室编号"), viewer);
    if (!canModerate) throw Errors.forbidden("只有群管理员可以关闭宣泄室");
    if (room.status !== "active") throw Errors.badRequest("宣泄室已经关闭");
    await prisma.$transaction(async (tx) => {
      await tx.treeholeRoom.update({ where: { id: room.id }, data: { status: "closed", closedAt: new Date(), closedById: viewer.userId, closeReason: req.body.reason } });
      await tx.treeholeRoomApplication.updateMany({ where: { roomId: room.id, status: "pending" }, data: { status: "cancelled" } });
      const members = await tx.treeholeRoomMember.findMany({ where: { roomId: room.id, status: "active" }, select: { userId: true, role: true } });
      await notifyTreehole(members.filter((member) => member.role === "visitor").map((member) => member.userId), {
        title: "宣泄室已关闭",
        content: `「${room.name}」已关闭，感谢你在这里的陪伴。`,
        link: "/treehole",
        type: "treehole-room-closed",
        extra: { roomId: room.id },
      }, tx);
      await notifyTreehole(await treeholeAdminUserIds(tx), {
        title: "宣泄室被关闭",
        content: `「${room.name}」已被关闭：${req.body.reason}`,
        link: "/treehole/admin?tab=rooms",
        type: "treehole-violation",
        extra: { roomId: room.id },
      }, tx);
      await writeTreeholeAudit({ actor: viewer, action: "room.close", targetType: "room", targetId: room.id, detail: { name: room.name, reason: req.body.reason } }, tx);
    });
    ok(res, { closed: true });
  } catch (error) {
    next(error);
  }
});

treeholeRoomRouter.get("/rooms/:id/members", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { room, canModerate } = await loadRoomFor(parseTreeholeId(req.params.id, "宣泄室编号"), viewer);
    if (!canModerate) throw Errors.forbidden("只有群管理员可以查看成员");
    const members = await prisma.treeholeRoomMember.findMany({ where: { roomId: room.id, status: "active" }, orderBy: [{ role: "asc" }, { seq: "asc" }, { id: "asc" }] });
    const recommenderIds = [...new Set(members.map((member) => member.recommendedById).filter((id): id is number => typeof id === "number"))];
    const recommenders = recommenderIds.length ? await prisma.treeholeStaff.findMany({ where: { id: { in: recommenderIds } }, select: { id: true, hostCode: true } }) : [];
    const recommenderCode = new Map(recommenders.map((row) => [row.id, row.hostCode]));
    ok(res, members.map((member) => ({
      id: member.id,
      alias: member.alias,
      role: member.role,
      seq: member.seq,
      recommendedBy: member.recommendedById ? hostDisplayName(recommenderCode.get(member.recommendedById)) : null,
      joinedAt: member.joinedAt,
      mine: member.userId === viewer.userId,
    })));
  } catch (error) {
    next(error);
  }
});

const removeSchema = z.object({ reason: z.string().trim().min(2, "请写明移出原因").max(200) });

treeholeRoomRouter.post("/rooms/:id/members/:memberId/remove", validate(removeSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { room, member: me, canModerate } = await loadRoomFor(parseTreeholeId(req.params.id, "宣泄室编号"), viewer);
    if (!canModerate) throw Errors.forbidden("只有群管理员可以移出成员");
    const target = await prisma.treeholeRoomMember.findFirst({ where: { id: parseTreeholeId(req.params.memberId, "成员编号"), roomId: room.id, status: "active" } });
    if (!target) throw Errors.notFound("这位成员已经不在群里");
    if (target.id === me?.id) throw Errors.badRequest("不能移出自己，可以选择退出宣泄室");
    if (target.role === "host" && !viewer.isAdmin) throw Errors.forbidden("洞主之间不能互相移出，请联系核心管理员");
    await prisma.$transaction(async (tx) => {
      await tx.treeholeRoomMember.update({ where: { id: target.id }, data: { status: "removed", leftAt: new Date() } });
      await postRoomNotice(tx, room.id, target.id, `管理员将 ${target.alias} 移出了宣泄室`);
      await notifyTreehole([target.userId], {
        title: "你已被移出宣泄室",
        content: `你已被管理员移出「${room.name}」。如有疑问，可以在一对一树洞里和小艾绒聊聊。`,
        link: "/treehole",
        type: "treehole-room-removed",
        extra: { roomId: room.id },
      }, tx);
      await notifyTreehole(await treeholeAdminUserIds(tx), {
        title: "宣泄室违规处理",
        content: `「${room.name}」移出了成员 ${target.alias}：${req.body.reason}`,
        link: "/treehole/admin?tab=rooms",
        type: "treehole-violation",
        level: "weak",
        extra: { roomId: room.id },
      }, tx);
      await writeTreeholeAudit({ actor: viewer, action: "room.member.remove", targetType: "room", targetId: room.id, detail: { alias: target.alias, reason: req.body.reason } }, tx);
    });
    ok(res, { removed: true });
  } catch (error) {
    next(error);
  }
});

treeholeRoomRouter.post("/rooms/:id/messages/:messageId/recall", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { room, canModerate } = await loadRoomFor(parseTreeholeId(req.params.id, "宣泄室编号"), viewer);
    if (!canModerate) throw Errors.forbidden("只有群管理员可以撤回消息");
    const message = await prisma.treeholeRoomMessage.findFirst({ where: { id: parseTreeholeId(req.params.messageId, "消息编号"), roomId: room.id } });
    if (!message || message.kind === "notice") throw Errors.notFound("消息不存在");
    if (message.recalledAt) throw Errors.badRequest("这条消息已经撤回");
    const author = await prisma.treeholeRoomMember.findUnique({ where: { id: message.memberId }, select: { alias: true } });
    await prisma.$transaction(async (tx) => {
      await tx.treeholeRoomMessage.update({ where: { id: message.id }, data: { recalledAt: new Date(), recalledById: viewer.userId } });
      await notifyTreehole(await treeholeAdminUserIds(tx), {
        title: "宣泄室违规处理",
        content: `「${room.name}」撤回了 ${author?.alias ?? "成员"} 的一条消息。`,
        link: "/treehole/admin?tab=rooms",
        type: "treehole-violation",
        level: "weak",
        extra: { roomId: room.id, messageId: message.id },
      }, tx);
      await writeTreeholeAudit({ actor: viewer, action: "room.message.recall", targetType: "room", targetId: room.id, detail: { messageId: message.id, alias: author?.alias } }, tx);
    });
    ok(res, { recalled: true });
  } catch (error) {
    next(error);
  }
});

// ---- 入群申请 ----

const applicationListSchema = z.object({ status: z.enum(["pending", "all"]).optional().default("pending") });

treeholeRoomRouter.get("/rooms/:id/applications", validate(applicationListSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const { room, canModerate } = await loadRoomFor(parseTreeholeId(req.params.id, "宣泄室编号"), viewer);
    if (!canModerate) throw Errors.forbidden("只有群管理员可以审核入群申请");
    const query = req.query as unknown as z.infer<typeof applicationListSchema>;
    const applications = await prisma.treeholeRoomApplication.findMany({
      where: { roomId: room.id, ...(query.status === "pending" ? { status: "pending" } : {}) },
      orderBy: { id: "desc" },
      take: 200,
    });
    const staffIds = [...new Set(applications.flatMap((row) => [row.recommendedById, row.reviewerId]).filter((id): id is number => typeof id === "number"))];
    const staff = staffIds.length ? await prisma.treeholeStaff.findMany({ where: { id: { in: staffIds } }, select: { id: true, hostCode: true, isHost: true, isAdmin: true } }) : [];
    const staffMap = new Map(staff.map((row) => [row.id, row]));
    const sessions = await prisma.treeholeSession.findMany({ where: { id: { in: applications.map((row) => row.sessionId) } }, select: { id: true, alias: true } });
    const sessionAlias = new Map(sessions.map((row) => [row.id, row.alias]));
    ok(res, applications.map((application) => {
      const reviewer = application.reviewerId ? staffMap.get(application.reviewerId) : null;
      return {
        id: application.id,
        status: application.status,
        note: application.note,
        visitorAlias: sessionAlias.get(application.sessionId) ?? "来访者",
        recommendedBy: hostDisplayName(staffMap.get(application.recommendedById)?.hostCode),
        reviewer: reviewer ? (reviewer.isHost && reviewer.hostCode ? hostDisplayName(reviewer.hostCode) : "核心管理员") : null,
        reviewedAt: application.reviewedAt,
        rejectReason: application.rejectReason,
        createdAt: application.createdAt,
      };
    }));
  } catch (error) {
    next(error);
  }
});

const applySchema = z.object({
  messageId: z.number().int().positive(),
  note: z.string().trim().max(200, "留言最多 200 字").optional().default(""),
});

treeholeRoomRouter.post("/room-applications", validate(applySchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    await requireConsent(viewer.userId);
    const invite = await prisma.treeholeMessage.findUnique({ where: { id: req.body.messageId }, include: { session: true } });
    // 入口只有洞主在一对一会话里发来的推荐卡片，来访者不能自己搜群。
    if (!invite || invite.kind !== "room-invite" || !invite.roomId || invite.session.visitorId !== viewer.userId) {
      throw Errors.notFound("这条宣泄室推荐不存在");
    }
    const roomId = invite.roomId;
    const application = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROOM_LOCK}::int, ${roomId}::int)`;
      const room = await tx.treeholeRoom.findUnique({ where: { id: roomId } });
      if (!room || room.status !== "active") throw Errors.badRequest("这个宣泄室已经关闭");
      const joined = await tx.treeholeRoomMember.findFirst({ where: { roomId, userId: viewer.userId, status: "active" }, select: { id: true } });
      if (joined) throw Errors.conflict("你已经在这个宣泄室里了");
      const pending = await tx.treeholeRoomApplication.findFirst({ where: { roomId, visitorId: viewer.userId, status: "pending" }, select: { id: true } });
      if (pending) throw Errors.conflict("申请已经提交，正在等待群管理员审核");
      const created = await tx.treeholeRoomApplication.create({
        data: { roomId, visitorId: viewer.userId, sessionId: invite.sessionId, recommendedById: invite.session.hostId, note: req.body.note },
      });
      const hosts = await roomHostUserIds(roomId, tx);
      await notifyTreehole(hosts.length ? hosts : await treeholeAdminUserIds(tx), {
        title: "新的宣泄室入群申请",
        content: `有来访者申请加入「${room.name}」，请尽快审核。`,
        link: `/treehole/room/${roomId}?panel=applications`,
        type: "treehole-room-application",
        extra: { roomId, applicationId: created.id },
      }, tx);
      return created;
    });
    ok(res, { id: application.id, status: application.status });
  } catch (error) {
    next(error);
  }
});

treeholeRoomRouter.post("/room-applications/:id/cancel", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const updated = await prisma.treeholeRoomApplication.updateMany({
      where: { id: parseTreeholeId(req.params.id, "申请编号"), visitorId: viewer.userId, status: "pending" },
      data: { status: "cancelled" },
    });
    if (!updated.count) throw Errors.notFound("申请不存在或已处理");
    ok(res, { cancelled: true });
  } catch (error) {
    next(error);
  }
});

const reviewSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(200).optional().default(""),
});

treeholeRoomRouter.post("/room-applications/:id/review", validate(reviewSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const body = req.body as z.infer<typeof reviewSchema>;
    const applicationId = parseTreeholeId(req.params.id, "申请编号");
    const existing = await prisma.treeholeRoomApplication.findUnique({ where: { id: applicationId } });
    if (!existing) throw Errors.notFound("申请不存在");
    const { room, canModerate } = await loadRoomFor(existing.roomId, viewer);
    if (!canModerate) throw Errors.forbidden("只有这个宣泄室的群管理员可以审核");
    if (!body.approve && body.reason.length < 2) throw Errors.badRequest("拒绝时请简单说明原因，来访者会看到");
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROOM_LOCK}::int, ${room.id}::int)`;
      const application = await tx.treeholeRoomApplication.findUnique({ where: { id: applicationId } });
      if (!application || application.status !== "pending") throw Errors.conflict("这条申请已经处理过了");
      const freshRoom = await tx.treeholeRoom.findUnique({ where: { id: room.id } });
      if (!freshRoom || freshRoom.status !== "active") throw Errors.badRequest("这个宣泄室已经关闭");
      const reviewerId = viewer.staff?.id ?? null;
      if (!body.approve) {
        await tx.treeholeRoomApplication.update({ where: { id: application.id }, data: { status: "rejected", reviewerId, reviewedAt: new Date(), rejectReason: body.reason } });
        await notifyTreehole([application.visitorId], {
          title: "宣泄室申请未通过",
          content: `加入「${room.name}」的申请没有通过：${body.reason}`,
          link: "/treehole",
          type: "treehole-room-application-result",
          extra: { roomId: room.id, applicationId: application.id },
        }, tx);
        await writeTreeholeAudit({ actor: viewer, action: "room.application.reject", targetType: "room", targetId: room.id, detail: { applicationId: application.id, reason: body.reason } }, tx);
        return { status: "rejected" as const, alias: null };
      }
      const already = await tx.treeholeRoomMember.findFirst({ where: { roomId: room.id, userId: application.visitorId, status: "active" }, select: { id: true } });
      if (already) {
        await tx.treeholeRoomApplication.update({ where: { id: application.id }, data: { status: "approved", reviewerId, reviewedAt: new Date() } });
        return { status: "approved" as const, alias: null };
      }
      const recommender = await tx.treeholeStaff.findUnique({ where: { id: application.recommendedById }, select: { hostCode: true } });
      const active = await tx.treeholeRoomMember.findMany({ where: { roomId: room.id, status: "active", role: "visitor" }, select: { seq: true } });
      const seq = nextRoomSeq(active.map((row) => row.seq));
      const alias = roomVisitorAlias(recommender?.hostCode || "00", seq);
      const member = await tx.treeholeRoomMember.create({
        data: {
          roomId: room.id,
          userId: application.visitorId,
          role: "visitor",
          seq,
          alias,
          recommendedById: application.recommendedById,
          sessionId: application.sessionId,
        },
      });
      await tx.treeholeRoomApplication.update({ where: { id: application.id }, data: { status: "approved", reviewerId, reviewedAt: new Date() } });
      const welcome = await postRoomNotice(tx, room.id, member.id, `欢迎 ${alias} 加入宣泄室`);
      await tx.treeholeRoomMember.update({ where: { id: member.id }, data: { readId: welcome.id - 1 } });
      await notifyTreehole([application.visitorId], {
        title: "宣泄室申请通过了",
        content: `你已加入「${room.name}」，群里的虚拟 ID 是 ${alias}。`,
        link: `/treehole/room/${room.id}`,
        type: "treehole-room-application-result",
        extra: { roomId: room.id, applicationId: application.id },
      }, tx);
      await writeTreeholeAudit({ actor: viewer, action: "room.application.approve", targetType: "room", targetId: room.id, detail: { applicationId: application.id, alias } }, tx);
      return { status: "approved" as const, alias };
    });
    ok(res, result);
  } catch (error) {
    next(error);
  }
});

// ---- 新建宣泄室（洞主联名） ----

const proposalSchema = z.object({
  name: z.string().trim().min(2, "名称至少 2 个字").max(20, "名称最多 20 个字"),
  category: z.enum(TREEHOLE_ROOM_CATEGORIES),
  intro: z.string().trim().max(120, "简介最多 120 字").optional().default(""),
});

treeholeRoomRouter.post("/room-proposals", validate(proposalSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const body = req.body as z.infer<typeof proposalSchema>;
    const pendingMine = await prisma.treeholeRoomProposal.count({ where: { proposerId: staff.id, status: "pending" } });
    if (pendingMine >= 3) throw Errors.badRequest("你已经发起了 3 个还没建成的宣泄室提议");
    const proposal = await prisma.$transaction(async (tx) => {
      const created = await tx.treeholeRoomProposal.create({ data: { name: body.name, category: body.category, intro: body.intro, proposerId: staff.id } });
      await tx.treeholeRoomProposalSignature.create({ data: { proposalId: created.id, staffId: staff.id } });
      const others = await tx.treeholeStaff.findMany({ where: { enabled: true, isHost: true, hostCode: { not: null }, id: { not: staff.id } }, select: { userId: true } });
      await notifyTreehole(others.map((row) => row.userId), {
        title: "新的宣泄室联名提议",
        content: `${hostDisplayName(staff.hostCode)} 提议新建「${body.name}」，需要 ${TREEHOLE_ROOM_FOUNDERS_REQUIRED} 名洞主联名。`,
        link: "/treehole/host?tab=rooms",
        type: "treehole-room-proposal",
        level: "weak",
        extra: { proposalId: created.id },
      }, tx);
      return created;
    });
    ok(res, { id: proposal.id });
  } catch (error) {
    next(error);
  }
});

treeholeRoomRouter.post("/room-proposals/:id/sign", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const proposalId = parseTreeholeId(req.params.id, "提议编号");
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PROPOSAL_LOCK}::int, ${proposalId}::int)`;
      const proposal = await tx.treeholeRoomProposal.findUnique({ where: { id: proposalId }, include: { signatures: true } });
      if (!proposal || proposal.status !== "pending") throw Errors.notFound("这个提议已经结束");
      if (proposal.signatures.some((sig) => sig.staffId === staff.id)) throw Errors.conflict("你已经联名过了");
      await tx.treeholeRoomProposalSignature.create({ data: { proposalId, staffId: staff.id } });
      const signerIds = [...proposal.signatures.map((sig) => sig.staffId), staff.id];
      const signers = await tx.treeholeStaff.findMany({ where: { id: { in: signerIds }, enabled: true, isHost: true, hostCode: { not: null } } });
      if (signers.length < TREEHOLE_ROOM_FOUNDERS_REQUIRED) return { created: false, roomId: null, signatures: signers.length };
      const room = await tx.treeholeRoom.create({ data: { name: proposal.name, category: proposal.category, intro: proposal.intro } });
      for (const signer of signers) {
        await tx.treeholeRoomMember.create({ data: { roomId: room.id, userId: signer.userId, role: "host", staffId: signer.id, alias: hostDisplayName(signer.hostCode) } });
      }
      await tx.treeholeRoomProposal.update({ where: { id: proposalId }, data: { status: "created", roomId: room.id } });
      await notifyTreehole(signers.map((signer) => signer.userId), {
        title: "宣泄室建好了",
        content: `「${room.name}」已由 ${signers.length} 名洞主联名建成，你们都是群管理员。`,
        link: `/treehole/room/${room.id}`,
        type: "treehole-room-created",
        extra: { roomId: room.id },
      }, tx);
      await writeTreeholeAudit({
        actor: viewer,
        action: "room.create",
        targetType: "room",
        targetId: room.id,
        detail: { name: room.name, founders: signers.map((signer) => signer.hostCode) },
      }, tx);
      return { created: true, roomId: room.id, signatures: signers.length };
    });
    ok(res, result);
  } catch (error) {
    next(error);
  }
});

treeholeRoomRouter.post("/room-proposals/:id/cancel", async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const proposal = await prisma.treeholeRoomProposal.findUnique({ where: { id: parseTreeholeId(req.params.id, "提议编号") } });
    if (!proposal || proposal.status !== "pending") throw Errors.notFound("这个提议已经结束");
    if (proposal.proposerId !== viewer.staff?.id && !viewer.isAdmin) throw Errors.forbidden("只有发起人可以撤回提议");
    await prisma.treeholeRoomProposal.update({ where: { id: proposal.id }, data: { status: "cancelled" } });
    ok(res, { cancelled: true });
  } catch (error) {
    next(error);
  }
});
