import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { publicAvatarValue } from "../utils/publicAvatar";
import { normalizeSchedulePayload, type ScheduleShareInput } from "./scheduleSharing";

/** 邀请码有效期。宿舍码可以被多人重复使用，过期后由创建者重新生成。 */
export const DORM_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
/** 默认容量与硬上限：颜色一共 8 种，超过 8 人一定会撞色。 */
export const DORM_MEMBER_LIMIT = 6;
export const DORM_MEMBER_MAX = 8;
export const DORM_NAME_MAX_LENGTH = 24;

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_LENGTH = 6;
const INVITE_PATTERN = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LENGTH}}$`, "u");
const DORM_LINK = "/schedule?dorm=1";

export const DORM_COLORS = ["blue", "pink", "purple", "teal", "green", "amber", "orange", "red"] as const;
export type DormColor = (typeof DORM_COLORS)[number];

const memberUserSelect = { id: true, nickname: true, avatar: true } as const;

function isDormColor(value: unknown): value is DormColor {
  return DORM_COLORS.includes(value as DormColor);
}

export function generateDormInviteCode() {
  let code = "";
  for (let i = 0; i < INVITE_LENGTH; i += 1) code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  return code;
}

/** 和情侣课表一样容忍空格、连字符和小写；字母表不含易混的 0/O、1/I。 */
export function normalizeDormInviteCode(value: unknown) {
  const code = String(value ?? "").toUpperCase().replace(/[\s-]/gu, "");
  return INVITE_PATTERN.test(code) ? code : null;
}

/** 宿舍名可以为空；去掉首尾空白并按长度裁剪。 */
export function normalizeDormName(value: unknown) {
  if (value === null || value === undefined) return null;
  const name = String(value).replace(/\s+/gu, " ").trim();
  if (!name) return null;
  if (name.length > DORM_NAME_MAX_LENGTH) throw Errors.badRequest(`宿舍名最多 ${DORM_NAME_MAX_LENGTH} 个字`);
  return name;
}

function joinedTime(value: Date | string | undefined) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

/**
 * 每名成员的颜色：自己选过并且没被别人占用就用自己选的，其余按加入顺序分配剩下的颜色，
 * 这样同一个宿舍里任何时候都不会出现两个人同色。人数超过颜色总数时按顺序循环。
 */
export function dormMemberColors(members: { userId: number; color?: string | null; joinedAt?: Date | string }[]) {
  const ordered = [...members].sort((a, b) => joinedTime(a.joinedAt) - joinedTime(b.joinedAt) || a.userId - b.userId);
  const colors = new Map<number, DormColor>();
  const used = new Set<DormColor>();

  for (const member of ordered) {
    if (!isDormColor(member.color) || used.has(member.color)) continue;
    colors.set(member.userId, member.color);
    used.add(member.color);
  }
  for (const member of ordered) {
    if (colors.has(member.userId)) continue;
    const free = DORM_COLORS.find((color) => !used.has(color));
    const fallback = DORM_COLORS[colors.size % DORM_COLORS.length];
    const picked = free ?? fallback;
    colors.set(member.userId, picked);
    used.add(picked);
  }
  return colors;
}

/**
 * 换色结果：始终两两不同。选了别人正在用的颜色就是两人互换，和情侣课表一致；
 * 其余成员的颜色保持不变。
 */
export function dormSwapColors(
  members: { userId: number; color?: string | null; joinedAt?: Date | string }[],
  userId: number,
  next: DormColor,
) {
  const current = dormMemberColors(members);
  const mine = current.get(userId);
  const holder = members.find((member) => member.userId !== userId && current.get(member.userId) === next);
  const result = new Map<number, DormColor>();
  for (const member of members) {
    if (member.userId === userId) result.set(member.userId, next);
    else if (holder && member.userId === holder.userId && mine) result.set(member.userId, mine);
    else result.set(member.userId, current.get(member.userId) ?? DORM_COLORS[0]);
  }
  return result;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}

async function notify(userId: number, title: string, content: string) {
  await prisma.notification.create({
    data: {
      userId,
      category: "system",
      level: "normal",
      title,
      content,
      link: DORM_LINK,
      source: "宿舍课表",
      payload: JSON.stringify({ type: "dorm-schedule" }),
    },
  }).catch(() => null);
}

async function membershipOf(userId: number) {
  return prisma.dormMember.findUnique({
    where: { userId },
    include: {
      link: {
        include: {
          members: {
            orderBy: { joinedAt: "asc" },
            include: {
              user: { select: memberUserSelect },
              snapshot: { select: { semester: true, syncedAt: true, changedAt: true } },
            },
          },
        },
      },
    },
  });
}

type Membership = NonNullable<Awaited<ReturnType<typeof membershipOf>>>;
type MemberRow = Membership["link"]["members"][number];

/** 舍长身份只存在成员行上：role 为 owner 的那一个人。 */
function ownerOf(members: { userId: number; role: string }[]) {
  return members.find((member) => member.role === "owner") ?? null;
}

function presentMember(member: MemberRow, color: DormColor) {
  return {
    id: member.user.id,
    color,
    nickname: member.user.nickname,
    avatar: publicAvatarValue(member.user),
    isOwner: member.role === "owner",
    snapshot: member.snapshot ? {
      semester: member.snapshot.semester,
      syncedAt: member.snapshot.syncedAt.toISOString(),
      changedAt: member.snapshot.changedAt.toISOString(),
    } : null,
  };
}

function presentStatus(membership: Membership | null, userId: number, now = new Date()) {
  if (!membership) return { status: "none" as const };
  const { link } = membership;
  const colors = dormMemberColors(link.members);
  const me = link.members.find((member) => member.userId === userId);
  if (!me) return { status: "none" as const };
  const isOwner = me.role === "owner";
  return {
    status: "active" as const,
    id: link.id,
    name: link.name,
    memberLimit: link.memberLimit,
    isOwner,
    since: link.createdAt.toISOString(),
    // 邀请码只给创建者看，避免成员把宿舍再拉给别人。
    invite: isOwner && link.inviteCode ? {
      code: link.inviteCode,
      expiresAt: link.inviteExpiresAt?.toISOString() ?? null,
      expired: !link.inviteExpiresAt || link.inviteExpiresAt.getTime() <= now.getTime(),
    } : null,
    me: presentMember(me, colors.get(userId)!),
    members: link.members.map((member) => presentMember(member, colors.get(member.userId)!)),
  };
}

async function activeMembership(userId: number) {
  const membership = await membershipOf(userId);
  if (!membership) throw Errors.notFound("你还没有加入宿舍课表");
  return membership;
}

export async function getDormStatus(userId: number) {
  return presentStatus(await membershipOf(userId), userId);
}

/**
 * 生成或刷新邀请码。还没加入任何宿舍时，这一步就是创建宿舍：自己成为创建者。
 * 已有宿舍时只有创建者能换码。
 */
export async function createDormInvite(userId: number, now = new Date()) {
  const expiresAt = new Date(now.getTime() + DORM_INVITE_TTL_MS);
  const existing = await membershipOf(userId);
  if (existing && existing.link.members.find((member) => member.userId === userId)?.role !== "owner") {
    throw Errors.forbidden("只有舍长能生成宿舍码");
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateDormInviteCode();
    try {
      if (existing) {
        await prisma.dormLink.update({ where: { id: existing.linkId }, data: { inviteCode, inviteExpiresAt: expiresAt } });
      } else {
        await prisma.dormLink.create({
          data: {
            inviteCode,
            inviteExpiresAt: expiresAt,
            memberLimit: DORM_MEMBER_LIMIT,
            members: { create: { userId, role: "owner" } },
          },
        });
      }
      return getDormStatus(userId);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // 并发请求已经建好了宿舍或占用了同一个码，重新读一次现状即可。
      const current = await membershipOf(userId);
      if (current) return presentStatus(current, userId, now);
    }
  }
  throw Errors.server("邀请码生成失败，请重试");
}

export async function cancelDormInvite(userId: number) {
  const membership = await membershipOf(userId);
  if (!membership || membership.link.members.find((member) => member.userId === userId)?.role !== "owner") {
    return getDormStatus(userId);
  }
  await prisma.dormLink.update({ where: { id: membership.linkId }, data: { inviteCode: null, inviteExpiresAt: null } });
  return getDormStatus(userId);
}

/**
 * 用宿舍码加入。码在有效期内可以被多人重复使用，所以这里只校验有效期和容量，
 * 不消耗邀请码。容量检查放在事务里，避免并发加入把宿舍撑到超过上限。
 */
export async function joinDorm(userId: number, rawCode: unknown, now = new Date()) {
  const code = normalizeDormInviteCode(rawCode);
  if (!code) throw Errors.badRequest("宿舍码应为 6 位字母或数字");
  const link = await prisma.dormLink.findUnique({ where: { inviteCode: code }, include: { members: true } });
  if (!link || !link.inviteExpiresAt || link.inviteExpiresAt.getTime() <= now.getTime()) {
    throw Errors.notFound("宿舍码不存在或已过期");
  }
  if (link.members.some((member) => member.userId === userId)) return getDormStatus(userId);
  const own = await membershipOf(userId);
  if (own) {
    throw Errors.conflict(own.link.id === link.id ? "你已经在这个宿舍里了" : "你已经加入了别的宿舍，请先退出");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const count = await tx.dormMember.count({ where: { linkId: link.id } });
      if (count >= link.memberLimit) throw Errors.conflict("这个宿舍已经满了");
      await tx.dormMember.create({ data: { userId, linkId: link.id, role: "member" } });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict("你已经在宿舍课表里了，请刷新页面");
    throw error;
  }

  const status = await getDormStatus(userId);
  const owner = ownerOf(link.members);
  if (status.status === "active" && owner) {
    await notify(owner.userId, "有人加入了宿舍课表", `${status.me.nickname || "新室友"} 加入了宿舍，现在可以一起看空闲时间了。`);
  }
  return status;
}

export async function updateDormSettings(userId: number, input: { name?: unknown; myColor?: unknown }) {
  const membership = await activeMembership(userId);
  const { link } = membership;

  if (input.name !== undefined) {
    if (link.members.find((member) => member.userId === userId)?.role !== "owner") throw Errors.forbidden("只有舍长能改宿舍名");
    await prisma.dormLink.update({ where: { id: membership.linkId }, data: { name: normalizeDormName(input.name) } });
  }
  if (input.myColor !== undefined) {
    if (!isDormColor(input.myColor)) throw Errors.badRequest("没有这种颜色");
    const colors = dormSwapColors(link.members, userId, input.myColor);
    await prisma.$transaction(link.members.map((member) => prisma.dormMember.update({
      where: { userId: member.userId },
      data: { color: colors.get(member.userId) ?? null },
    })));
  }
  return getDormStatus(userId);
}

/**
 * 退出宿舍。舍长退出时把身份转给最早加入的其他人；最后一个人退出就整条删除。
 */
export async function leaveDorm(userId: number) {
  const membership = await membershipOf(userId);
  if (!membership) return { status: "none" as const };
  const { link } = membership;
  const me = link.members.find((member) => member.userId === userId);
  const rest = link.members.filter((member) => member.userId !== userId);
  if (!rest.length) {
    await prisma.dormLink.deleteMany({ where: { id: link.id } });
    return { status: "none" as const };
  }
  await prisma.$transaction(async (tx) => {
    await tx.dormMember.deleteMany({ where: { userId } });
    if (me?.role === "owner") {
      const next = rest[0];
      await tx.dormMember.update({ where: { userId: next.userId }, data: { role: "owner" } });
    }
  });
  return { status: "none" as const };
}

/** 舍长把某人移出宿舍；被移出的人会收到站内通知。 */
export async function removeDormMember(userId: number, targetUserId: number) {
  const membership = await activeMembership(userId);
  const me = membership.link.members.find((member) => member.userId === userId);
  if (me?.role !== "owner") throw Errors.forbidden("只有舍长能移出成员");
  if (targetUserId === userId) throw Errors.badRequest("要退出宿舍请用「退出宿舍」");
  const target = membership.link.members.find((member) => member.userId === targetUserId);
  if (!target) throw Errors.notFound("这个人不在你的宿舍里");
  await prisma.dormMember.deleteMany({ where: { userId: targetUserId } });
  await notify(targetUserId, "你已被移出宿舍课表", `${membership.link.name || "宿舍"} 的舍长把你移出了宿舍，课表快照已删除。`);
  return getDormStatus(userId);
}

export async function saveDormScheduleSnapshot(userId: number, input: ScheduleShareInput, now = new Date()) {
  await activeMembership(userId);
  const normalized = normalizeSchedulePayload(input);
  const contentHash = crypto.createHash("sha256").update(normalized.payload).digest("hex");
  const existing = await prisma.dormScheduleSnapshot.findUnique({ where: { userId }, select: { contentHash: true } });
  const changed = existing?.contentHash !== contentHash;
  const snapshot = changed
    ? await prisma.dormScheduleSnapshot.upsert({
      where: { userId },
      create: { userId, semester: normalized.semester, payload: normalized.payload, contentHash, syncedAt: now, changedAt: now },
      update: { semester: normalized.semester, payload: normalized.payload, contentHash, syncedAt: now, changedAt: now },
    })
    : await prisma.dormScheduleSnapshot.update({ where: { userId }, data: { syncedAt: now } });
  return {
    changed,
    contentHash,
    semester: snapshot.semester,
    syncedAt: snapshot.syncedAt.toISOString(),
    changedAt: snapshot.changedAt.toISOString(),
  };
}

function parseSnapshot(row: { semester: string; payload: string; syncedAt: Date; changedAt: Date } | null) {
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload);
    return {
      semester: row.semester,
      syncedAt: row.syncedAt.toISOString(),
      changedAt: row.changedAt.toISOString(),
      schedule: parsed.schedule,
      calendar: parsed.calendar,
    };
  } catch {
    return null;
  }
}

/** 读取整个宿舍的课表快照，自己那份也在里面（前端按 userId 区分）。 */
export async function getDormSchedules(userId: number) {
  const membership = await activeMembership(userId);
  const { link } = membership;
  const colors = dormMemberColors(link.members);
  const rows = await prisma.dormScheduleSnapshot.findMany({
    where: { userId: { in: link.members.map((member) => member.userId) } },
  });
  const ordered = [...link.members].sort((a, b) => joinedTime(a.joinedAt) - joinedTime(b.joinedAt));
  return {
    members: ordered.map((member) => ({
      id: member.userId,
      color: colors.get(member.userId)!,
      nickname: member.user.nickname,
      snapshot: parseSnapshot(rows.find((row) => row.userId === member.userId) ?? null),
    })),
  };
}

/** 注销账号时调用：先把自己从宿舍里摘掉，宿舍因此空掉时整条删除。 */
export async function deleteDormDataForUser(tx: Prisma.TransactionClient, userId: number) {
  const member = await tx.dormMember.findUnique({ where: { userId }, select: { linkId: true, role: true } });
  if (!member) return;
  await tx.dormMember.deleteMany({ where: { userId } });
  const remaining = await tx.dormMember.findMany({ where: { linkId: member.linkId }, orderBy: { joinedAt: "asc" } });
  if (!remaining.length) {
    await tx.dormLink.deleteMany({ where: { id: member.linkId } });
    return;
  }
  // 舍长注销时把身份交给最早加入的其他人，避免宿舍变成没人能管理。
  if (member.role === "owner") {
    await tx.dormMember.update({ where: { userId: remaining[0].userId }, data: { role: "owner" } });
  }
}
