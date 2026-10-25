import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import type { Prisma, TreeholeShift, TreeholeStaff } from "@prisma/client";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import {
  hostDisplayName,
  resolveHostPresence,
  TREEHOLE_CONSENT_VERSION,
} from "./treeholePolicy";

// 艾绒树洞的数据访问：身份、配置、权限、通知、私有图片和审计日志。规则说明见 docs/treehole.md。

export const TREEHOLE_CONFIG_KEY = "treehole.config";

export type TreeholeConfig = {
  open: boolean;
  studentOnly: boolean;
  centerName: string;
  centerHotline: string;
  centerLocation: string;
  centerHours: string;
  crisisGuide: string;
  emergencyNote: string;
};

export const DEFAULT_TREEHOLE_CONFIG: TreeholeConfig = {
  open: false,
  studentOnly: true,
  centerName: "校心理发展中心",
  centerHotline: "",
  centerLocation: "",
  centerHours: "",
  crisisGuide: "谢谢你愿意说出来。你的感受很重要，学校心理发展中心的老师可以给你更专业的陪伴，我们也会一直在这里。",
  emergencyNote: "如果你正处在危险之中，请立即拨打 110 或 120，或拨打全国心理援助热线 12356。",
};

const CONFIG_LIMITS: Record<Exclude<keyof TreeholeConfig, "open" | "studentOnly">, number> = {
  centerName: 40,
  centerHotline: 120,
  centerLocation: 120,
  centerHours: 120,
  crisisGuide: 400,
  emergencyNote: 200,
};

export function normalizeTreeholeConfig(raw: unknown): TreeholeConfig {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const config = { ...DEFAULT_TREEHOLE_CONFIG };
  if (typeof source.open === "boolean") config.open = source.open;
  if (typeof source.studentOnly === "boolean") config.studentOnly = source.studentOnly;
  for (const [key, limit] of Object.entries(CONFIG_LIMITS) as Array<[keyof typeof CONFIG_LIMITS, number]>) {
    if (typeof source[key] === "string") config[key] = String(source[key]).trim().slice(0, limit);
  }
  if (!config.centerName) config.centerName = DEFAULT_TREEHOLE_CONFIG.centerName;
  return config;
}

export async function loadTreeholeConfig(store: Pick<typeof prisma, "siteSetting"> = prisma) {
  const row = await store.siteSetting.findUnique({ where: { key: TREEHOLE_CONFIG_KEY } });
  if (!row) return { ...DEFAULT_TREEHOLE_CONFIG };
  try {
    return normalizeTreeholeConfig(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_TREEHOLE_CONFIG };
  }
}

export async function saveTreeholeConfig(config: TreeholeConfig) {
  const value = JSON.stringify(normalizeTreeholeConfig(config));
  await prisma.siteSetting.upsert({
    where: { key: TREEHOLE_CONFIG_KEY },
    create: { key: TREEHOLE_CONFIG_KEY, value },
    update: { value },
  });
  return normalizeTreeholeConfig(JSON.parse(value));
}

export function publicHelpChannels(config: TreeholeConfig) {
  return {
    centerName: config.centerName,
    centerHotline: config.centerHotline,
    centerLocation: config.centerLocation,
    centerHours: config.centerHours,
    crisisGuide: config.crisisGuide,
    emergencyNote: config.emergencyNote,
  };
}

export type TreeholeStaffWithShifts = TreeholeStaff & { shifts: TreeholeShift[] };

export type TreeholeViewer = {
  userId: number;
  siteRole: string;
  staff: TreeholeStaffWithShifts | null;
  isHost: boolean;
  isAdmin: boolean;
  isSiteAdmin: boolean;
};

export async function loadTreeholeViewer(user: { userId: number; role?: string | null }): Promise<TreeholeViewer> {
  const staff = await prisma.treeholeStaff.findUnique({ where: { userId: user.userId }, include: { shifts: true } });
  const enabled = Boolean(staff?.enabled);
  return {
    userId: user.userId,
    siteRole: String(user.role || "user"),
    staff,
    isHost: enabled && Boolean(staff?.isHost && staff.hostCode),
    isAdmin: enabled && Boolean(staff?.isAdmin),
    isSiteAdmin: user.role === "admin",
  };
}

/** treeholeRouter 的第一层中间件把当前身份放在 res.locals 里。 */
export function viewerOf(res: { locals: Record<string, unknown> }) {
  const viewer = res.locals.treehole as TreeholeViewer | undefined;
  if (!viewer) throw Errors.unauthorized();
  return viewer;
}

export function requireTreeholeHost(viewer: TreeholeViewer) {
  if (!viewer.isHost || !viewer.staff) throw Errors.forbidden("只有在任的洞主可以使用");
  return viewer.staff;
}

export function requireTreeholeAdmin(viewer: TreeholeViewer) {
  if (!viewer.isAdmin || !viewer.staff) throw Errors.forbidden("只有树洞核心管理员可以使用");
  return viewer.staff;
}

/** 人员任免：核心管理员和站点管理员（运维）都可以，站点管理员看不到会话内容。 */
export function requireTreeholeStaffManager(viewer: TreeholeViewer) {
  if (!viewer.isAdmin && !viewer.isSiteAdmin) throw Errors.forbidden("只有树洞核心管理员或站点管理员可以管理人员");
}

export function staffLabel(staff: Pick<TreeholeStaff, "hostCode" | "isHost" | "isAdmin"> | null | undefined) {
  if (!staff) return "已移除的人员";
  if (staff.isHost && staff.hostCode) return hostDisplayName(staff.hostCode);
  return staff.isAdmin ? "核心管理员" : "树洞人员";
}

export function presenceOf(staff: TreeholeStaffWithShifts, now = new Date()) {
  return resolveHostPresence({
    isHost: Boolean(staff.isHost && staff.hostCode),
    enabled: staff.enabled,
    presenceOverride: staff.presenceOverride,
    presenceOverrideUntil: staff.presenceOverrideUntil,
    shifts: staff.shifts,
  }, now);
}

export function publicHost(staff: TreeholeStaffWithShifts, now = new Date()) {
  const presence = presenceOf(staff, now);
  return {
    id: staff.id,
    code: staff.hostCode || "",
    name: hostDisplayName(staff.hostCode),
    intro: staff.intro,
    online: presence.online,
    onlineUntil: presence.online ? presence.until : null,
    nextShiftAt: presence.nextShiftAt,
    shifts: staff.shifts
      .map((shift) => ({ weekday: shift.weekday, startMinute: shift.startMinute, endMinute: shift.endMinute }))
      .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
  };
}

export async function hasCurrentConsent(userId: number) {
  const consent = await prisma.treeholeConsent.findUnique({ where: { userId } });
  return consent?.version === TREEHOLE_CONSENT_VERSION;
}

export async function requireConsent(userId: number) {
  if (!await hasCurrentConsent(userId)) throw Errors.forbidden("请先阅读并同意树洞知情同意书");
}

type AuditInput = {
  actor: TreeholeViewer;
  action: string;
  targetType: string;
  targetId?: number | null;
  detail?: Record<string, unknown>;
};

export function auditActorLabel(viewer: TreeholeViewer) {
  if (viewer.isAdmin) return `核心管理员（用户 ${viewer.userId}）`;
  if (viewer.isHost) return `${staffLabel(viewer.staff)}（用户 ${viewer.userId}）`;
  if (viewer.isSiteAdmin) return `站点管理员（用户 ${viewer.userId}）`;
  return `用户 ${viewer.userId}`;
}

export async function writeTreeholeAudit(input: AuditInput, store: Pick<typeof prisma, "treeholeAuditLog"> = prisma) {
  await store.treeholeAuditLog.create({
    data: {
      actorUserId: input.actor.userId,
      actorLabel: auditActorLabel(input.actor),
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      detail: JSON.stringify(input.detail ?? {}),
    },
  });
}

type NotifyInput = {
  title: string;
  content: string;
  link: string;
  type: string;
  level?: "strong" | "normal" | "weak";
  extra?: Record<string, unknown>;
};

/** 树洞提醒只写去向和事件，不带任何对话内容；QQ 私聊和微信服务号会原样转发这几句话。 */
export async function notifyTreehole(
  userIds: Iterable<number>,
  input: NotifyInput,
  store: Pick<typeof prisma, "notification"> | Prisma.TransactionClient = prisma,
) {
  const recipients = [...new Set([...userIds].filter((id) => Number.isInteger(id) && id > 0))];
  if (!recipients.length) return;
  await store.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      category: "treehole",
      level: input.level ?? "normal",
      title: input.title,
      content: input.content,
      link: input.link,
      source: "艾绒树洞",
      payload: JSON.stringify({ type: input.type, ...(input.extra ?? {}) }),
    })),
  });
}

export async function treeholeAdminUserIds(store: Pick<typeof prisma, "treeholeStaff"> = prisma) {
  const rows = await store.treeholeStaff.findMany({ where: { enabled: true, isAdmin: true }, select: { userId: true } });
  return rows.map((row) => row.userId);
}

// ---- 私有图片 ----

const IMAGE_MAX_DIMENSION = 1600;
const IMAGE_MAX_INPUT_PIXELS = 50_000_000;
export const TREEHOLE_IMAGE_MAX_SOURCE_BYTES = 15 * 1024 * 1024;

export function treeholeImageRoot() {
  return path.resolve(process.env.TREEHOLE_STORAGE_ROOT || path.join(process.cwd(), "runtime", "treehole-images"));
}

function storagePath(storageKey: string) {
  if (!/^\d{4}-\d{2}\/[0-9a-f-]{36}\.webp$/u.test(storageKey)) throw Errors.notFound("图片不存在");
  return path.join(treeholeImageRoot(), ...storageKey.split("/"));
}

/** 重新编码成 WebP：去掉 EXIF（含拍摄位置），限制尺寸，只保存这一份，不留原图。 */
export async function storeTreeholeImage(uploaderId: number, source: Buffer) {
  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    output = await sharp(source, { limitInputPixels: IMAGE_MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize({ width: IMAGE_MAX_DIMENSION, height: IMAGE_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw Errors.badRequest("无法识别这张图片，请换一张 JPG、PNG 或 WebP 图片");
  }
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const storageKey = `${month}/${randomUUID()}.webp`;
  const filePath = storagePath(storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, output.data, { flag: "wx" });
  return prisma.treeholeImage.create({
    data: {
      uploaderId,
      storageKey,
      mimeType: "image/webp",
      width: output.info.width,
      height: output.info.height,
      byteSize: output.data.length,
    },
  });
}

export async function readTreeholeImage(storageKey: string) {
  return readFile(storagePath(storageKey));
}

export async function claimTreeholeImage(tx: Prisma.TransactionClient, imageId: number, uploaderId: number) {
  const claimed = await tx.treeholeImage.updateMany({
    where: { id: imageId, uploaderId, attachedAt: null },
    data: { attachedAt: new Date() },
  });
  if (!claimed.count) throw Errors.badRequest("图片已失效，请重新选择");
  return tx.treeholeImage.findUniqueOrThrow({ where: { id: imageId }, select: { id: true, width: true, height: true } });
}

export async function imageSummaries(ids: Array<number | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  if (!unique.length) return new Map<number, { id: number; width: number; height: number }>();
  const rows = await prisma.treeholeImage.findMany({ where: { id: { in: unique } }, select: { id: true, width: true, height: true } });
  return new Map(rows.map((row) => [row.id, row]));
}

// ---- 简单限流（单进程内） ----

const rateBuckets = new Map<string, number[]>();

export function takeTreeholeRate(key: string, limit: number, windowMs: number, message: string, now = Date.now()) {
  const recent = (rateBuckets.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) throw Errors.badRequest(message);
  recent.push(now);
  rateBuckets.set(key, recent);
  if (rateBuckets.size > 5000) {
    for (const [bucketKey, times] of rateBuckets) {
      if (!times.some((time) => now - time < windowMs)) rateBuckets.delete(bucketKey);
    }
  }
}

export function parseTreeholeId(raw: unknown, label = "编号") {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw Errors.badRequest(`${label}不正确`);
  return id;
}
