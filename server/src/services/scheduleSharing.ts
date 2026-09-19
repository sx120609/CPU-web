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

function normalizePayload(input: ScheduleShareInput) {
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

function publicShare(row: any) {
  const parsed = JSON.parse(row.payload);
  return {
    code: row.code,
    owner: row.ownerName,
    semester: row.semester,
    courseCount: parsed.schedule?.cells?.reduce((sum: number, cell: any) => sum + (cell.courses?.length || 0), 0) || 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    schedule: parsed.schedule,
    calendar: parsed.calendar,
  };
}

export async function createScheduleShare(userId: number, input: ScheduleShareInput) {
  const normalized = normalizePayload(input);
  const ownerName = String(input.ownerName || "").trim().slice(0, 40) || "同学";
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
      termSnapshot: JSON.stringify(JSON.parse(normalized.payload).calendar),
    },
  });
  return { ...publicShare(row), writeToken };
}

export async function getScheduleShare(code: string) {
  if (!CODE_PATTERN.test(code)) return null;
  const row = await prisma.scheduleShare.findFirst({ where: { code, revokedAt: null } });
  return row ? publicShare(row) : null;
}

export async function revokeScheduleShare(code: string, userId: number, writeToken: string) {
  const row = await prisma.scheduleShare.findFirst({ where: { code, ownerId: userId, revokedAt: null } });
  if (!row || !writeToken || !crypto.timingSafeEqual(Buffer.from(row.writeTokenHash), Buffer.from(hash(writeToken)))) return false;
  await prisma.scheduleShare.update({ where: { code }, data: { revokedAt: new Date() } });
  return true;
}
