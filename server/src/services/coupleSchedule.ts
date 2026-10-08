import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { publicAvatarValue } from "../utils/publicAvatar";
import { normalizeSchedulePayload, type ScheduleShareInput } from "./scheduleSharing";

export const COUPLE_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_LENGTH = 6;
const INVITE_PATTERN = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LENGTH}}$`, "u");
const COUPLE_LINK = "/schedule?couple=1";

const memberUserSelect = { id: true, nickname: true, avatar: true } as const;
export const COUPLE_COLORS = ["blue", "pink", "purple", "teal", "green", "amber", "orange"] as const;
export type CoupleColor = (typeof COUPLE_COLORS)[number];

function isCoupleColor(value: unknown): value is CoupleColor {
  return COUPLE_COLORS.includes(value as CoupleColor);
}

/**
 * 一名成员的颜色。自己选过就用自己选的；没选过时沿用旧的方式：邀请方用关系上保存的
 * 颜色（蓝或粉），接受方取另一种。
 */
export function coupleMemberColor(role: string, inviterColor: string, chosen?: string | null): CoupleColor {
  if (isCoupleColor(chosen)) return chosen;
  const inviter: CoupleColor = inviterColor === "pink" ? "pink" : "blue";
  if (role === "inviter") return inviter;
  return inviter === "blue" ? "pink" : "blue";
}

/**
 * 两人的颜色，保证不相同：只有一方选过、又正好撞上另一方按旧方式推出的颜色时，
 * 没选过的那一方换成蓝或粉里不冲突的那个。
 */
export function coupleColorsFor(
  members: { userId: number; role: string; color?: string | null }[],
  inviterColor: string,
): Map<number, CoupleColor> {
  const colors = new Map<number, CoupleColor>();
  for (const member of members) colors.set(member.userId, coupleMemberColor(member.role, inviterColor, member.color));
  if (members.length === 2 && colors.get(members[0].userId) === colors.get(members[1].userId)) {
    const follower = members.find((member) => !isCoupleColor(member.color)) ?? members[1];
    const taken = colors.get(members.find((member) => member !== follower)!.userId);
    colors.set(follower.userId, taken === "blue" ? "pink" : "blue");
  }
  return colors;
}

export function generateCoupleInviteCode() {
  let code = "";
  for (let i = 0; i < INVITE_LENGTH; i += 1) code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  return code;
}

/** 容忍用户粘贴时带空格、连字符或小写；字母表本身不含易混的 0/O、1/I。 */
export function normalizeCoupleInviteCode(value: unknown) {
  const code = String(value ?? "").toUpperCase().replace(/[\s-]/gu, "");
  return INVITE_PATTERN.test(code) ? code : null;
}

/** 纪念日只接受真实存在、且不晚于今天（北京时间）的日期；空值表示清除。 */
export function normalizeAnniversary(value: unknown, now = new Date()) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) throw Errors.badRequest("纪念日格式应为 YYYY-MM-DD");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== text) throw Errors.badRequest("纪念日不是有效日期");
  const today = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (text > today) throw Errors.badRequest("纪念日不能晚于今天");
  if (text < "1970-01-01") throw Errors.badRequest("纪念日过早");
  return text;
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
      link: COUPLE_LINK,
      source: "情侣课表",
      payload: JSON.stringify({ type: "couple-schedule" }),
    },
  }).catch(() => null);
}

async function membershipOf(userId: number) {
  return prisma.coupleMember.findUnique({
    where: { userId },
    include: {
      link: {
        include: {
          members: {
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

function presentMember(member: Membership["link"]["members"][number], color: CoupleColor) {
  return {
    id: member.user.id,
    color,
    nickname: member.user.nickname,
    avatar: publicAvatarValue(member.user),
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
  const me = link.members.find((member) => member.userId === userId);
  const partner = link.members.find((member) => member.userId !== userId);
  if (!partner || !me) {
    return {
      status: "pending" as const,
      invite: {
        code: link.inviteCode,
        expiresAt: link.inviteExpiresAt?.toISOString() ?? null,
        expired: !link.inviteExpiresAt || link.inviteExpiresAt.getTime() <= now.getTime(),
      },
    };
  }
  return {
    status: "active" as const,
    since: (link.acceptedAt ?? link.createdAt).toISOString(),
    anniversary: link.anniversary,
    me: presentMember(me, coupleColorsFor(link.members, link.inviterColor).get(me.userId)!),
    partner: presentMember(partner, coupleColorsFor(link.members, link.inviterColor).get(partner.userId)!),
  };
}

async function activeMembership(userId: number) {
  const membership = await membershipOf(userId);
  if (!membership || membership.link.members.length < 2) throw Errors.notFound("还没有绑定情侣课表");
  return membership;
}

export async function getCoupleStatus(userId: number) {
  return presentStatus(await membershipOf(userId), userId);
}

export async function createCoupleInvite(userId: number, now = new Date()) {
  const existing = await membershipOf(userId);
  if (existing && existing.link.members.length >= 2) throw Errors.conflict("你已经绑定了情侣课表，请先解除绑定");
  const expiresAt = new Date(now.getTime() + COUPLE_INVITE_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateCoupleInviteCode();
    try {
      if (existing) {
        await prisma.coupleLink.update({ where: { id: existing.linkId }, data: { inviteCode, inviteExpiresAt: expiresAt } });
      } else {
        await prisma.coupleLink.create({
          data: { inviteCode, inviteExpiresAt: expiresAt, members: { create: { userId, role: "inviter" } } },
        });
      }
      return getCoupleStatus(userId);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // 成员主键冲突说明并发请求已经建好了邀请，直接返回现状。
      const current = await membershipOf(userId);
      if (current) return presentStatus(current, userId, now);
    }
  }
  throw Errors.server("邀请码生成失败，请重试");
}

export async function cancelCoupleInvite(userId: number) {
  const membership = await membershipOf(userId);
  if (!membership || membership.link.members.length >= 2) return { status: "none" as const };
  await prisma.coupleLink.deleteMany({ where: { id: membership.linkId } });
  return { status: "none" as const };
}

export async function acceptCoupleInvite(userId: number, rawCode: unknown, now = new Date()) {
  const code = normalizeCoupleInviteCode(rawCode);
  if (!code) throw Errors.badRequest("邀请码应为 6 位字母或数字");
  const link = await prisma.coupleLink.findUnique({ where: { inviteCode: code }, include: { members: true } });
  if (!link || !link.inviteExpiresAt || link.inviteExpiresAt.getTime() <= now.getTime() || link.members.length !== 1) {
    throw Errors.notFound("邀请码不存在或已过期");
  }
  const inviterId = link.members[0].userId;
  if (inviterId === userId) throw Errors.badRequest("不能接受自己的邀请码，请把它发给 TA");
  const own = await membershipOf(userId);
  if (own && own.link.members.length >= 2) throw Errors.conflict("你已经绑定了情侣课表，请先解除绑定");

  try {
    await prisma.$transaction(async (tx) => {
      // 自己未被接受的邀请随之作废，保证每个账号只属于一条关系。
      if (own) await tx.coupleLink.deleteMany({ where: { id: own.linkId, acceptedAt: null } });
      const claimed = await tx.coupleLink.updateMany({
        where: { id: link.id, inviteCode: code, acceptedAt: null, inviteExpiresAt: { gt: now } },
        data: { inviteCode: null, inviteExpiresAt: null, acceptedAt: now },
      });
      if (claimed.count !== 1) throw Errors.notFound("邀请码不存在或已过期");
      await tx.coupleMember.create({ data: { userId, linkId: link.id, role: "invitee" } });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict("你已经绑定了情侣课表，请刷新页面");
    throw error;
  }

  const status = await getCoupleStatus(userId);
  if (status.status === "active") {
    await notify(inviterId, "情侣课表绑定成功", `${status.me.nickname || "TA"} 接受了你的邀请，现在可以一起看课表了。`);
  }
  return status;
}

export async function unbindCouple(userId: number) {
  const membership = await membershipOf(userId);
  if (!membership) return { status: "none" as const };
  const me = membership.link.members.find((member) => member.userId === userId);
  const partner = membership.link.members.find((member) => member.userId !== userId);
  await prisma.coupleLink.deleteMany({ where: { id: membership.linkId } });
  if (partner) {
    await notify(partner.userId, "情侣课表已解除", `${me?.user.nickname || "TA"} 解除了情侣课表绑定，双方的课表快照已删除。`);
  }
  return { status: "none" as const };
}

export async function updateCoupleSettings(userId: number, input: { anniversary?: unknown; myColor?: unknown }) {
  const data: { anniversary?: string | null } = {};
  if (input.anniversary !== undefined) data.anniversary = normalizeAnniversary(input.anniversary);
  const membership = await activeMembership(userId);
  if (input.myColor !== undefined) {
    if (!isCoupleColor(input.myColor)) throw Errors.badRequest("没有这种颜色");
    const mine = input.myColor;
    const { link } = membership;
    const partner = link.members.find((member) => member.userId !== userId)!;
    const colors = coupleColorsFor(link.members, link.inviterColor);
    const before = colors.get(userId)!;
    // 每人存自己的颜色。选了对方正在用的颜色就是两人互换，两人的颜色始终不同。
    const theirs = mine === colors.get(partner.userId) ? before : colors.get(partner.userId)!;
    await prisma.$transaction([
      prisma.coupleMember.update({ where: { userId }, data: { color: mine } }),
      prisma.coupleMember.update({ where: { userId: partner.userId }, data: { color: theirs } }),
    ]);
  }
  if (Object.keys(data).length) await prisma.coupleLink.update({ where: { id: membership.linkId }, data });
  return getCoupleStatus(userId);
}

export async function saveCoupleScheduleSnapshot(userId: number, input: ScheduleShareInput, now = new Date()) {
  await activeMembership(userId);
  const normalized = normalizeSchedulePayload(input);
  const contentHash = crypto.createHash("sha256").update(normalized.payload).digest("hex");
  const existing = await prisma.coupleScheduleSnapshot.findUnique({ where: { userId }, select: { contentHash: true } });
  const changed = existing?.contentHash !== contentHash;
  const snapshot = changed
    ? await prisma.coupleScheduleSnapshot.upsert({
      where: { userId },
      create: { userId, semester: normalized.semester, payload: normalized.payload, contentHash, syncedAt: now, changedAt: now },
      update: { semester: normalized.semester, payload: normalized.payload, contentHash, syncedAt: now, changedAt: now },
    })
    : await prisma.coupleScheduleSnapshot.update({ where: { userId }, data: { syncedAt: now } });
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

export async function getCoupleSchedules(userId: number) {
  const membership = await activeMembership(userId);
  const partnerId = membership.link.members.find((member) => member.userId !== userId)!.userId;
  const rows = await prisma.coupleScheduleSnapshot.findMany({ where: { userId: { in: [userId, partnerId] } } });
  return {
    me: parseSnapshot(rows.find((row) => row.userId === userId) ?? null),
    partner: parseSnapshot(rows.find((row) => row.userId === partnerId) ?? null),
  };
}

/** 注销账号时调用：删除整条关系，对方的快照也一并清除。 */
export async function deleteCoupleDataForUser(tx: Prisma.TransactionClient, userId: number) {
  const member = await tx.coupleMember.findUnique({ where: { userId }, select: { linkId: true } });
  if (member) await tx.coupleLink.deleteMany({ where: { id: member.linkId } });
}
