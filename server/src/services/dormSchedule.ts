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

async function membershipOf(userId: number, db: Prisma.TransactionClient = prisma) {
  return db.dormMember.findUnique({
    where: { userId },
    include: {
      link: {
        include: {
          members: {
            orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
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

// Always lock the acting user before the dorm. The user lock also covers users
// who have no membership yet; the dorm row serializes joins, departures and
// permission checks, including account erasure. Never act on a pre-lock roster.
async function lockDormUser(tx: Prisma.TransactionClient, userId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${20261022}::int, ${userId}::int)`;
}

async function lockDorm(tx: Prisma.TransactionClient, linkId: number) {
  await tx.$queryRaw`SELECT "id" FROM "DormLink" WHERE "id" = ${linkId} FOR UPDATE`;
}

async function lockedMembership(tx: Prisma.TransactionClient, userId: number) {
  await lockDormUser(tx, userId);
  const member = await tx.dormMember.findUnique({ where: { userId }, select: { linkId: true } });
  if (!member) return null;
  await lockDorm(tx, member.linkId);
  const current = await membershipOf(userId, tx);
  return current?.linkId === member.linkId ? current : null;
}

async function activeMembership(tx: Prisma.TransactionClient, userId: number) {
  const membership = await lockedMembership(tx, userId);
  if (!membership) throw Errors.notFound("你还没有加入宿舍课表");
  return membership;
}

export async function getDormStatus(userId: number) {
  return prisma.$transaction(async (tx) => presentStatus(await lockedMembership(tx, userId), userId));
}

/**
 * 生成或刷新邀请码。还没加入任何宿舍时，这一步就是创建宿舍：自己成为创建者。
 * 已有宿舍时只有创建者能换码。
 */
export async function createDormInvite(userId: number, now = new Date()) {
  const expiresAt = new Date(now.getTime() + DORM_INVITE_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateDormInviteCode();
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await lockedMembership(tx, userId);
        if (existing) {
          if (existing.role !== "owner") throw Errors.forbidden("只有舍长能生成宿舍码");
          await tx.dormLink.update({ where: { id: existing.linkId }, data: { inviteCode, inviteExpiresAt: expiresAt } });
        } else {
          await tx.dormLink.create({
            data: {
              inviteCode,
              inviteExpiresAt: expiresAt,
              memberLimit: DORM_MEMBER_LIMIT,
              members: { create: { userId, role: "owner" } },
            },
          });
        }
        return presentStatus(await membershipOf(userId, tx), userId, now);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Invite-code collisions roll the transaction back; retry with a new code.
    }
  }
  throw Errors.server("邀请码生成失败，请重试");
}

export async function cancelDormInvite(userId: number) {
  return prisma.$transaction(async (tx) => {
    const membership = await lockedMembership(tx, userId);
    if (!membership) return { status: "none" as const };
    if (membership.role !== "owner") throw Errors.forbidden("只有舍长能取消宿舍码");
    await tx.dormLink.update({ where: { id: membership.linkId }, data: { inviteCode: null, inviteExpiresAt: null } });
    return presentStatus(await membershipOf(userId, tx), userId);
  });
}

/**
 * 用宿舍码加入。码在有效期内可以被多人重复使用，所以这里只校验有效期和容量，
 * 未满员时不消耗邀请码。锁定宿舍后检查容量，避免并发加入超过上限。
 */
export async function joinDorm(userId: number, rawCode: unknown, now = new Date()) {
  const code = normalizeDormInviteCode(rawCode);
  if (!code) throw Errors.badRequest("宿舍码应为 6 位字母或数字");
  let result: { status: Awaited<ReturnType<typeof getDormStatus>>; ownerId: number | null };
  try {
    result = await prisma.$transaction(async (tx) => {
      await lockDormUser(tx, userId);
      const target = await tx.dormLink.findUnique({ where: { inviteCode: code }, select: { id: true } });
      if (!target) throw Errors.notFound("宿舍码不存在或已过期");
      await lockDorm(tx, target.id);
      const link = await tx.dormLink.findUnique({ where: { id: target.id }, include: { members: true } });
      if (!link || link.inviteCode !== code || !link.inviteExpiresAt || link.inviteExpiresAt.getTime() <= now.getTime()) {
        throw Errors.notFound("宿舍码不存在或已过期");
      }
      const own = await tx.dormMember.findUnique({ where: { userId } });
      if (own?.linkId === link.id) return { status: presentStatus(await membershipOf(userId, tx), userId, now), ownerId: null };
      if (own) throw Errors.conflict("你已经加入了别的宿舍，请先退出");
      const limit = Math.min(DORM_MEMBER_MAX, link.memberLimit);
      if (link.members.length >= limit) throw Errors.conflict("这个宿舍已经满了");
      await tx.dormMember.create({ data: { userId, linkId: link.id, role: "member" } });
      if (link.members.length + 1 >= limit) {
        await tx.dormLink.update({ where: { id: link.id }, data: { inviteCode: null, inviteExpiresAt: null } });
      }
      return { status: presentStatus(await membershipOf(userId, tx), userId, now), ownerId: ownerOf(link.members)?.userId ?? null };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict("你已经在宿舍课表里了，请刷新页面");
    throw error;
  }

  const { status, ownerId } = result;
  if (status.status === "active" && ownerId) {
    await notify(ownerId, "有人加入了宿舍课表", `${status.me.nickname || "新室友"} 加入了宿舍，现在可以一起看空闲时间了。`);
  }
  return status;
}

export async function updateDormSettings(userId: number, input: { name?: unknown; myColor?: unknown }) {
  const name = input.name === undefined ? undefined : normalizeDormName(input.name);
  const myColor = input.myColor;
  if (myColor !== undefined && !isDormColor(myColor)) throw Errors.badRequest("没有这种颜色");
  return prisma.$transaction(async (tx) => {
    const membership = await activeMembership(tx, userId);
    const { link } = membership;
    if (name !== undefined) {
      if (membership.role !== "owner") throw Errors.forbidden("只有舍长能改宿舍名");
      await tx.dormLink.update({ where: { id: link.id }, data: { name } });
    }
    if (isDormColor(myColor)) {
      const colors = dormSwapColors(link.members, userId, myColor);
      for (const member of link.members) {
        await tx.dormMember.updateMany({ where: { userId: member.userId, linkId: link.id }, data: { color: colors.get(member.userId) } });
      }
    }
    return presentStatus(await membershipOf(userId, tx), userId);
  });
}

/**
 * 退出宿舍。舍长退出时把身份转给最早加入的其他人；最后一个人退出就整条删除。
 */
export async function leaveDorm(userId: number) {
  await prisma.$transaction((tx) => deleteDormDataForUser(tx, userId));
  return { status: "none" as const };
}

/** 舍长把某人移出宿舍；被移出的人会收到站内通知。 */
export async function removeDormMember(userId: number, targetUserId: number) {
  if (targetUserId === userId) throw Errors.badRequest("要退出宿舍请用「退出宿舍」");
  const result = await prisma.$transaction(async (tx) => {
    const membership = await activeMembership(tx, userId);
    if (membership.role !== "owner") throw Errors.forbidden("只有舍长能移出成员");
    const target = membership.link.members.find((member) => member.userId === targetUserId);
    if (!target) throw Errors.notFound("这个人不在你的宿舍里");
    await tx.dormMember.deleteMany({ where: { userId: targetUserId, linkId: membership.linkId } });
    return { name: membership.link.name, status: presentStatus(await membershipOf(userId, tx), userId) };
  });
  await notify(targetUserId, "你已被移出宿舍课表", `${result.name || "宿舍"} 的舍长把你移出了宿舍，课表快照已删除。`);
  return result.status;
}

export async function saveDormScheduleSnapshot(userId: number, input: ScheduleShareInput, now = new Date()) {
  const normalized = normalizeSchedulePayload(input);
  const contentHash = crypto.createHash("sha256").update(normalized.payload).digest("hex");
  return prisma.$transaction(async (tx) => {
    await activeMembership(tx, userId);
    const existing = await tx.dormScheduleSnapshot.findUnique({ where: { userId }, select: { contentHash: true } });
    const changed = existing?.contentHash !== contentHash;
    const snapshot = changed
      ? await tx.dormScheduleSnapshot.upsert({
        where: { userId },
        create: { userId, semester: normalized.semester, payload: normalized.payload, contentHash, syncedAt: now, changedAt: now },
        update: { semester: normalized.semester, payload: normalized.payload, contentHash, syncedAt: now, changedAt: now },
      })
      : await tx.dormScheduleSnapshot.update({ where: { userId }, data: { syncedAt: now } });
    return {
      changed,
      contentHash,
      semester: snapshot.semester,
      syncedAt: snapshot.syncedAt.toISOString(),
      changedAt: snapshot.changedAt.toISOString(),
    };
  });
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
  return prisma.$transaction(async (tx) => {
    const membership = await activeMembership(tx, userId);
    const { link } = membership;
    const colors = dormMemberColors(link.members);
    const rows = await tx.dormScheduleSnapshot.findMany({
      where: { member: { linkId: link.id } },
    });
    return {
      members: link.members.map((member) => ({
        id: member.userId,
        color: colors.get(member.userId)!,
        nickname: member.user.nickname,
        snapshot: parseSnapshot(rows.find((row) => row.userId === member.userId) ?? null),
      })),
    };
  });
}

/** 注销账号时调用：先把自己从宿舍里摘掉，宿舍因此空掉时整条删除。 */
export async function deleteDormDataForUser(tx: Prisma.TransactionClient, userId: number) {
  const member = await lockedMembership(tx, userId);
  if (!member) return;
  await tx.dormMember.deleteMany({ where: { userId, linkId: member.linkId } });
  const remaining = await tx.dormMember.findMany({ where: { linkId: member.linkId }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }] });
  if (!remaining.length) {
    await tx.dormLink.deleteMany({ where: { id: member.linkId } });
    return;
  }
  // 舍长注销时把身份交给最早加入的其他人，避免宿舍变成没人能管理。
  if (member.role === "owner") {
    await tx.dormMember.update({ where: { userId: remaining[0].userId }, data: { role: "owner" } });
  }
}
