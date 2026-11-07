import { Router } from "express";
import { z } from "zod";
import type { Prisma, TreeholeRoomMember, TreeholeRoomMessage } from "@prisma/client";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import {
  claimTreeholeImage,
  imageSummaries,
  loadTreeholeConfig,
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
  DEFAULT_ROOM_RULES,
  roomMemberAlias,
  TREEHOLE_ROOM_CATEGORIES,
} from "../services/treeholePolicy";

// 主题宣泄室：多人实时聊天室。学生按主题找房间，读过保密与伦理须知后直接进入，群内只显示虚拟 ID。

export const treeholeRoomRouter = Router();

const ROOM_LOCK = -71001;
const MESSAGE_PAGE = 50;

async function loadRoomFor(roomId: number, viewer: TreeholeViewer) {
  const room = await prisma.treeholeRoom.findUnique({ where: { id: roomId } });
  if (!room || room.schoolId !== viewer.schoolId) throw Errors.notFound("宣泄室不存在");
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
      if (!room || room.schoolId !== viewer.schoolId || room.status !== "active") throw Errors.notFound("这个宣泄室已经关闭");
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

// ---- 宣泄室列表、新建、进入 ----

const roomListSchema = z.object({ category: z.enum(TREEHOLE_ROOM_CATEGORIES).optional() });

// 学生按主题找宣泄室；洞主和核心管理员也用这个列表。
treeholeRoomRouter.get("/rooms", validate(roomListSchema, "query"), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const query = req.query as unknown as z.infer<typeof roomListSchema>;
    const rooms = await prisma.treeholeRoom.findMany({
      where: { schoolId: viewer.schoolId, status: "active", ...(query.category ? { category: query.category } : {}) },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      include: { members: { where: { status: "active" }, select: { userId: true, role: true, status: true } } },
      take: 200,
    });
    const removed = await prisma.treeholeRoomMember.findMany({
      where: { userId: viewer.userId, status: "removed", roomId: { in: rooms.map((room) => room.id) } },
      select: { roomId: true },
    });
    const removedRooms = new Set(removed.map((row) => row.roomId));
    const config = await loadTreeholeConfig(viewer.schoolId);
    ok(res, {
      rules: config.roomRules || DEFAULT_ROOM_RULES,
      categories: TREEHOLE_ROOM_CATEGORIES.map((value) => ({ value, label: roomCategoryLabel(value) })),
      rooms: rooms.map((room) => ({
        ...serializeRoom(room),
        visitorCount: room.members.filter((member) => member.role === "visitor").length,
        hostCount: room.members.filter((member) => member.role === "host").length,
        joined: room.members.some((member) => member.userId === viewer.userId),
        removed: removedRooms.has(room.id),
        lastMessageAt: room.lastMessageAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

const createRoomSchema = z.object({
  name: z.string().trim().min(2, "名称至少 2 个字").max(20, "名称最多 20 个字"),
  category: z.enum(TREEHOLE_ROOM_CATEGORIES),
  intro: z.string().trim().max(120, "简介最多 120 字").optional().default(""),
});

// 每位小艾绒都可以开设主题宣泄室，开设人和之后进来的小艾绒都是群管理员。
treeholeRoomRouter.post("/rooms", validate(createRoomSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    const staff = requireTreeholeHost(viewer);
    const body = req.body as z.infer<typeof createRoomSchema>;
    takeTreeholeRate(`room-create:${viewer.userId}`, 5, 24 * 60 * 60_000, "今天开设的宣泄室有点多了");
    const room = await prisma.$transaction(async (tx) => {
      const created = await tx.treeholeRoom.create({
        data: { schoolId: viewer.schoolId, name: body.name, category: body.category, intro: body.intro, createdById: staff.id },
      });
      const host = await tx.treeholeRoomMember.create({
        data: { roomId: created.id, userId: viewer.userId, role: "host", staffId: staff.id, alias: hostDisplayName(staff.hostCode) },
      });
      await postRoomNotice(tx, created.id, host.id, `${host.alias} 开设了「${created.name}」`);
      await writeTreeholeAudit({ actor: viewer, action: "room.create", targetType: "room", targetId: created.id, detail: { name: created.name, category: created.category } }, tx);
      return created;
    });
    ok(res, { id: room.id });
  } catch (error) {
    next(error);
  }
});

const joinSchema = z.object({ agree: z.literal(true, { errorMap: () => ({ message: "请先阅读并同意保密与伦理须知" }) }) });

// 学生读过并同意保密与伦理须知后直接进入；被移出过的同一个宣泄室不能再进。
treeholeRoomRouter.post("/rooms/:id/join", validate(joinSchema), async (req, res, next) => {
  try {
    const viewer = viewerOf(res);
    await requireConsent(viewer.userId);
    const config = await loadTreeholeConfig(viewer.schoolId);
    const staffMember = viewer.isHost || viewer.isAdmin;
    if (!config.open && !staffMember) throw Errors.forbidden("树洞暂未开放，开放后会在这里通知大家");
    if (config.studentOnly && !staffMember) {
      const user = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { studentSso: true } });
      if (!user?.studentSso) throw Errors.forbidden("宣泄室仅面向在校同学，请先用学校统一身份认证登录");
    }
    const roomId = parseTreeholeId(req.params.id, "宣泄室编号");
    const member = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROOM_LOCK}::int, ${roomId}::int)`;
      const room = await tx.treeholeRoom.findUnique({ where: { id: roomId } });
      if (!room || room.schoolId !== viewer.schoolId || room.status !== "active") throw Errors.notFound("这个宣泄室已经关闭");
      const existing = await tx.treeholeRoomMember.findFirst({ where: { roomId, userId: viewer.userId, status: "active" } });
      if (existing) return existing;
      const removed = await tx.treeholeRoomMember.findFirst({ where: { roomId, userId: viewer.userId, status: "removed" }, select: { id: true } });
      if (removed) throw Errors.forbidden("你已被管理员移出这个宣泄室，可以试试其他主题的宣泄室");
      // 洞主进来就是群管理员，和 /enter 相同。
      if (viewer.isHost && viewer.staff) {
        const host = await tx.treeholeRoomMember.create({
          data: { roomId, userId: viewer.userId, role: "host", staffId: viewer.staff.id, alias: hostDisplayName(viewer.staff.hostCode) },
        });
        await postRoomNotice(tx, roomId, host.id, `${host.alias} 来到了宣泄室`);
        return host;
      }
      const active = await tx.treeholeRoomMember.findMany({ where: { roomId, status: "active", role: "visitor" }, select: { seq: true } });
      const seq = nextRoomSeq(active.map((row) => row.seq));
      const created = await tx.treeholeRoomMember.create({
        data: { roomId, userId: viewer.userId, role: "visitor", seq, alias: roomMemberAlias(seq) },
      });
      const welcome = await postRoomNotice(tx, roomId, created.id, `欢迎 ${created.alias} 加入宣泄室`);
      await tx.treeholeRoomMember.update({ where: { id: created.id }, data: { readId: welcome.id - 1 } });
      return created;
    });
    ok(res, { memberId: member.id, alias: member.alias });
  } catch (error) {
    next(error);
  }
});
