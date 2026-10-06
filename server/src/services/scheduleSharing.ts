import crypto from "node:crypto";
import { prisma } from "../prisma";

const MAX_COURSES = 600;
const MAX_PAYLOAD_BYTES = 512 * 1024;
const CODE_PATTERN = /^[A-Z2-9]{8}$/u;

export type ScheduleShareInput = {
  semester: string;
  ownerName?: string;
  schedule: unknown;
  calendar: unknown;
};

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomCode() {
  return crypto.randomBytes(8).toString("base64url").replace(/[-_]/g, "").toUpperCase().replace(/[01IO]/g, "X").slice(0, 8);
}

export function normalizeSchedulePayload(input: ScheduleShareInput) {
  const semester = String(input.semester || "").trim();
  if (!semester || semester.length > 80) throw new Error("学期 ID 无效");
  const schedule = input.schedule && typeof input.schedule === "object" ? input.schedule as Record<string, unknown> : null;
  const calendar = input.calendar && typeof input.calendar === "object" ? input.calendar as Record<string, unknown> : null;
  if (!schedule || !calendar) throw new Error("缺少课表或校历快照");
  const cells = Array.isArray(schedule.cells) ? schedule.cells : [];
  const courseCount = cells.reduce((sum, cell) => sum + (cell && typeof cell === "object" && Array.isArray((cell as any).courses) ? (cell as any).courses.length : 0), 0);
  if (courseCount > MAX_COURSES) throw new Error(`一张课表最多 ${MAX_COURSES} 门课程`);
  for (const cell of cells) {
    if (!cell || typeof cell !== "object" || !Array.isArray((cell as any).courses)) throw new Error("课表单元格格式无效");
    for (const course of (cell as any).courses) {
      if (!course || typeof course !== "object" || typeof course.name !== "string" || !course.name.trim()) throw new Error("每门课程都需要名称");
    }
  }
  const payload = JSON.stringify({ semester, schedule, calendar }, (_key, value) => value, 0);
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("课表内容过大，无法分享");
  return { semester, payload, courseCount };
}

function courseCountOf(parsed: any) {
  return parsed?.schedule?.cells?.reduce((sum: number, cell: any) => sum + (cell.courses?.length || 0), 0) || 0;
}

/** 不含课表本身：读取方用它判断要不要重新下载，发布者用它列出自己的分享。 */
function shareMeta(row: any) {
  let parsed: any = null;
  try { parsed = JSON.parse(row.payload); } catch { parsed = null; }
  return {
    code: row.code,
    owner: row.ownerName,
    semester: row.semester,
    courseCount: courseCountOf(parsed),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function publicShare(row: any) {
  const parsed = JSON.parse(row.payload);
  return { ...shareMeta(row), schedule: parsed.schedule, calendar: parsed.calendar };
}

/**
 * 每个账号每个学期只有一个分享码。再次发布时内容没变就原样返回，变了就原地更新：
 * 码不变，已经拿到码的人下次刷新就能看到新课表。`writeToken` 只在新建时返回一次。
 */
export async function createScheduleShare(userId: number, input: ScheduleShareInput) {
  const normalized = normalizeSchedulePayload(input);
  const ownerName = String(input.ownerName || "").trim().slice(0, 40) || "同学";
  const termSnapshot = JSON.stringify(JSON.parse(normalized.payload).calendar);
  const existing = await prisma.scheduleShare.findFirst({
    where: { ownerId: userId, semester: normalized.semester, revokedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) {
    if (existing.payload === normalized.payload && existing.ownerName === ownerName) {
      return { ...publicShare(existing), created: false, changed: false };
    }
    const row = await prisma.scheduleShare.update({
      where: { code: existing.code },
      data: { ownerName, payload: normalized.payload, termSnapshot },
    });
    return { ...publicShare(row), created: false, changed: true };
  }
  let code = randomCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!await prisma.scheduleShare.findUnique({ where: { code }, select: { code: true } })) break;
    code = randomCode();
  }
  const writeToken = `cpu_share_${crypto.randomBytes(24).toString("base64url")}`;
  const row = await prisma.scheduleShare.create({
    data: {
      code,
      writeTokenHash: hash(writeToken),
      ownerId: userId,
      ownerName,
      semester: normalized.semester,
      payload: normalized.payload,
      termSnapshot,
    },
  });
  return { ...publicShare(row), created: true, changed: true, writeToken };
}

export async function listScheduleShares(userId: number) {
  const rows = await prisma.scheduleShare.findMany({
    where: { ownerId: userId, revokedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return rows.map(shareMeta);
}

export async function getScheduleShare(code: string) {
  if (!CODE_PATTERN.test(code)) return null;
  const row = await prisma.scheduleShare.findFirst({ where: { code, revokedAt: null } });
  return row ? publicShare(row) : null;
}

export async function getScheduleShareMeta(code: string) {
  if (!CODE_PATTERN.test(code)) return null;
  const row = await prisma.scheduleShare.findFirst({ where: { code, revokedAt: null } });
  return row ? shareMeta(row) : null;
}

/**
 * 登录的发布者本人就能撤销。早期客户端会带 `writeToken`，带了就必须对得上。
 * 撤销后课表内容一并清掉，只留下这条记录本身。
 */
export async function revokeScheduleShare(code: string, userId: number, writeToken = "") {
  if (!CODE_PATTERN.test(code)) return false;
  const row = await prisma.scheduleShare.findFirst({ where: { code, ownerId: userId, revokedAt: null } });
  if (!row) return false;
  if (writeToken && !crypto.timingSafeEqual(Buffer.from(row.writeTokenHash), Buffer.from(hash(writeToken)))) return false;
  await prisma.scheduleShare.update({ where: { code }, data: { revokedAt: new Date(), payload: "{}", termSnapshot: "{}" } });
  return true;
}
