import type { Prisma, TreeholeMessage } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import {
  imageSummaries,
  presenceOf,
  publicHelpChannels,
  type TreeholeConfig,
  type TreeholeViewer,
} from "./treehole";
import {
  hostDisplayName,
  roomCategoryLabel,
  treeholeSessionRole,
  type TreeholeSessionRole,
} from "./treeholePolicy";

// 一对一会话的读取、权限和序列化，来访者、洞主和后台接口共用。

export const SESSION_INCLUDE = {
  host: { include: { shifts: true } },
  crisis: { select: { id: true, status: true } },
} as const;

export type SessionWithHost = Prisma.TreeholeSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;
export type SessionMessageRow = TreeholeMessage;

export const MESSAGE_PAGE = 50;

export async function loadSessionFor(sessionId: number, viewer: TreeholeViewer) {
  const session = await prisma.treeholeSession.findUnique({ where: { id: sessionId }, include: SESSION_INCLUDE });
  const role = session ? treeholeSessionRole(session, {
    userId: viewer.userId,
    staffId: viewer.staff?.id ?? null,
    isHost: viewer.isHost,
    isAdmin: viewer.isAdmin,
  }) : null;
  // 看不到的会话一律按不存在处理，不暴露会话是否存在。
  if (!session || !role) throw Errors.notFound("会话不存在");
  return { session, role };
}

export function serializeSession(session: SessionWithHost, role: TreeholeSessionRole, config: TreeholeConfig, unread = 0) {
  const presence = presenceOf(session.host);
  const crisis = session.tag === "crisis";
  return {
    id: session.id,
    mode: session.mode,
    alias: session.alias,
    status: session.status,
    role,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    lastMessageAt: session.lastMessageAt,
    unread,
    host: {
      id: session.host.id,
      code: session.host.hostCode || "",
      name: hostDisplayName(session.host.hostCode),
      intro: session.host.intro,
      online: presence.online,
      available: session.host.enabled && session.host.isHost,
      nextShiftAt: presence.nextShiftAt,
    },
    contact: session.contact,
    // 来访者只看到求助渠道，看不到“高危”“重点关注”这些标签。
    help: crisis ? publicHelpChannels(config) : null,
    ...(role === "visitor" ? {} : {
      tag: session.tag,
      crisis: session.crisis,
    }),
  };
}

async function roomInviteStates(messages: SessionMessageRow[], role: TreeholeSessionRole, visitorId: number) {
  const roomIds = [...new Set(messages.map((message) => message.roomId).filter((id): id is number => typeof id === "number"))];
  if (!roomIds.length) return new Map<number, Record<string, unknown>>();
  const [rooms, applications, memberships] = await Promise.all([
    prisma.treeholeRoom.findMany({ where: { id: { in: roomIds } }, select: { id: true, name: true, category: true, intro: true, status: true } }),
    prisma.treeholeRoomApplication.findMany({
      where: { roomId: { in: roomIds }, visitorId },
      orderBy: { id: "desc" },
      select: { roomId: true, status: true, rejectReason: true },
    }),
    prisma.treeholeRoomMember.findMany({ where: { roomId: { in: roomIds }, userId: visitorId, status: "active" }, select: { roomId: true } }),
  ]);
  const latestApplication = new Map<number, { status: string; rejectReason: string | null }>();
  for (const application of applications) if (!latestApplication.has(application.roomId)) latestApplication.set(application.roomId, application);
  const joined = new Set(memberships.map((row) => row.roomId));
  return new Map(rooms.map((room) => [room.id, {
    id: room.id,
    name: room.name,
    category: room.category,
    categoryLabel: roomCategoryLabel(room.category),
    intro: room.intro,
    status: room.status,
    joined: joined.has(room.id),
    application: latestApplication.get(room.id) ?? null,
  }]));
}

export async function serializeMessages(messages: SessionMessageRow[], role: TreeholeSessionRole, visitorId: number) {
  const [images, rooms] = await Promise.all([
    imageSummaries(messages.map((message) => message.imageId)),
    roomInviteStates(messages, role, visitorId),
  ]);
  return messages.map((message) => ({
    id: message.id,
    sender: message.sender,
    mine: message.sender === role,
    kind: message.kind,
    content: message.content,
    image: message.imageId ? images.get(message.imageId) ?? null : null,
    room: message.roomId ? rooms.get(message.roomId) ?? null : null,
    createdAt: message.createdAt,
  }));
}

/** 来访者和洞主打开会话时记下“正在看”和已读位置；核心管理员查阅不改动任何状态。 */
export async function markSeen(session: SessionWithHost, role: TreeholeSessionRole, lastId: number) {
  if (role === "admin") return;
  const now = new Date();
  const seenAt = role === "visitor" ? session.visitorSeenAt : session.hostSeenAt;
  const readId = role === "visitor" ? session.visitorReadId : session.hostReadId;
  const nextReadId = Math.max(readId, lastId);
  if (nextReadId === readId && seenAt && now.getTime() - seenAt.getTime() < 15_000) return;
  await prisma.treeholeSession.update({
    where: { id: session.id },
    data: role === "visitor"
      ? { visitorSeenAt: now, visitorReadId: nextReadId }
      : { hostSeenAt: now, hostReadId: nextReadId },
  });
}

async function unreadBySession(sessions: Array<{ id: number; visitorReadId: number; hostReadId: number }>, role: "visitor" | "host") {
  if (!sessions.length) return new Map<number, number>();
  const counterpart = role === "visitor" ? "host" : "visitor";
  const rows = await prisma.treeholeMessage.groupBy({
    by: ["sessionId"],
    where: {
      sender: counterpart,
      OR: sessions.map((session) => ({ sessionId: session.id, id: { gt: role === "visitor" ? session.visitorReadId : session.hostReadId } })),
    },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.sessionId, row._count._all]));
}

function messagePreview(message: { kind: string; content: string } | undefined) {
  if (!message) return "";
  if (message.kind === "image") return "[图片]";
  if (message.kind === "room-invite") return "[宣泄室邀请]";
  return message.content.replace(/\s+/gu, " ").slice(0, 40);
}

export async function listSessionSummaries(
  where: Prisma.TreeholeSessionWhereInput,
  role: TreeholeSessionRole,
  config: TreeholeConfig,
  options: { take?: number; skip?: number } = {},
) {
  const sessions = await prisma.treeholeSession.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: options.take ?? 50,
    skip: options.skip ?? 0,
    include: { ...SESSION_INCLUDE, messages: { orderBy: { id: "desc" }, take: 1, select: { kind: true, content: true } } },
  });
  const unread = role === "admin" ? new Map<number, number>() : await unreadBySession(sessions, role);
  return sessions.map((session) => ({
    ...serializeSession(session, role, config, unread.get(session.id) ?? 0),
    preview: messagePreview(session.messages[0]),
  }));
}
