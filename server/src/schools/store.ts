import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { broadcastSiteSettingsReload } from "../services/runtimeBroadcast";
import { invalidateSiteSettingCaches } from "../services/cacheInvalidation";
import { SCHOOL_MODULE_KEYS } from "./catalog";
import {
  BUILTIN_SCHOOLS,
  DEFAULT_SCHOOL_ID,
  applySchoolRows,
  findSchool,
  resolveSchoolId,
  type SchoolProfile,
  type SchoolRow,
} from "./registry";

const SCHOOL_ROW_SELECT = { id: true, name: true, shortName: true, brandName: true, tagline: true, enabled: true } as const;
const SCHOOL_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/u;

/**
 * 平台管理员（默认学校的站点管理员）管所有学校；其他学校的管理员只管本校。
 * 不知道属于哪所学校的身份一律不算，免得漏传 schoolId 时把外校管理员当成平台管理员。
 */
export function isPlatformAdmin(user: { role?: string | null; schoolId?: string | null } | null | undefined) {
  return user?.role === "admin" && user.schoolId === DEFAULT_SCHOOL_ID;
}

/**
 * 后台「正在管理的学校」。平台管理员在后台顶部切换学校，请求带 X-Admin-School；
 * 各校管理员只能是自己学校，带了别的学校也不认。
 */
export function adminSchoolId(req: { user?: { role?: string | null; schoolId?: string | null } | null; headers?: Record<string, unknown> }) {
  const own = resolveSchoolId(req.user?.schoolId);
  if (!isPlatformAdmin(req.user)) return own;
  const raw = req.headers?.["x-admin-school"];
  const requested = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return requested && findSchool(requested) ? requested : own;
}

export function ensureCanManageSchool(user: { role?: string | null; schoolId?: string | null } | null | undefined, schoolId: string) {
  if (isPlatformAdmin(user)) return;
  if (user?.role === "admin" && user.schoolId === schoolId) return;
  throw Errors.notFound("学校不存在");
}

/** 内置学校第一次启动时写进 School 表，之后名称等以表里为准。 */
export async function ensureBuiltinSchools() {
  if (!process.env.DATABASE_URL) return;
  for (const school of BUILTIN_SCHOOLS.values()) {
    await prisma.school.upsert({
      where: { id: school.id },
      create: {
        id: school.id,
        name: school.name,
        shortName: school.shortName,
        brandName: school.brandName,
        tagline: school.tagline,
        enabled: school.enabled,
      },
      update: {},
    });
  }
}

export async function loadSchools() {
  if (!process.env.DATABASE_URL) return;
  const rows = await prisma.school.findMany({ select: SCHOOL_ROW_SELECT, orderBy: { createdAt: "asc" } });
  applySchoolRows(rows, SCHOOL_MODULE_KEYS);
}

function cleanText(value: unknown, label: string, max: number, required: boolean) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw Errors.badRequest(`请填写${label}`);
  if (text.length > max) throw Errors.badRequest(`${label}不能超过 ${max} 个字`);
  return text;
}

async function afterSchoolsChanged() {
  await loadSchools();
  await invalidateSiteSettingCaches();
  await broadcastSiteSettingsReload();
}

export async function createSchool(input: Record<string, unknown>): Promise<SchoolProfile> {
  const id = String(input.id ?? "").trim().toLowerCase();
  if (!SCHOOL_ID_PATTERN.test(id)) throw Errors.badRequest("学校代号用 2-32 位小写字母、数字或中划线，以字母开头");
  if (findSchool(id) || await prisma.school.findUnique({ where: { id }, select: { id: true } })) {
    throw Errors.conflict("这个学校代号已经有了");
  }
  const name = cleanText(input.name, "学校全称", 40, true);
  const shortName = cleanText(input.shortName, "学校简称", 12, true);
  const row: SchoolRow = {
    id,
    name,
    shortName,
    brandName: cleanText(input.brandName, "品牌名", 20, false) || `${shortName}拾间`,
    tagline: cleanText(input.tagline, "标语", 40, false),
    enabled: input.enabled === undefined ? false : Boolean(input.enabled),
  };
  await prisma.school.create({ data: row });
  await afterSchoolsChanged();
  return findSchool(id)!;
}

export async function updateSchool(id: string, input: Record<string, unknown>, options: { canToggleEnabled: boolean }): Promise<SchoolProfile> {
  const current = findSchool(id);
  if (!current) throw Errors.notFound("学校不存在");
  const data: Partial<SchoolRow> = {};
  if (input.name !== undefined) data.name = cleanText(input.name, "学校全称", 40, true);
  if (input.shortName !== undefined) data.shortName = cleanText(input.shortName, "学校简称", 12, true);
  if (input.brandName !== undefined) data.brandName = cleanText(input.brandName, "品牌名", 20, true);
  if (input.tagline !== undefined) data.tagline = cleanText(input.tagline, "标语", 40, false);
  if (input.enabled !== undefined) {
    if (!options.canToggleEnabled) throw Errors.forbidden("只有平台管理员可以开放或关闭学校");
    if (id === DEFAULT_SCHOOL_ID && !input.enabled) throw Errors.badRequest("默认学校不能关闭");
    data.enabled = Boolean(input.enabled);
  }
  await prisma.school.upsert({
    where: { id },
    create: {
      id,
      name: data.name ?? current.name,
      shortName: data.shortName ?? current.shortName,
      brandName: data.brandName ?? current.brandName,
      tagline: data.tagline ?? current.tagline,
      enabled: data.enabled ?? current.enabled,
    },
    update: data,
  });
  await afterSchoolsChanged();
  return findSchool(id)!;
}
