import type { NextFunction, Request, Response } from "express";
import { prisma } from "../prisma";
import { Errors } from "../utils/response";
import { verifyToken } from "../utils/jwt";
import { broadcastSiteSettingsReload } from "../services/runtimeBroadcast";
import { SCHOOL_MODULES, findSchoolModule, type SchoolModuleDefinition } from "./catalog";
import { DEFAULT_SCHOOL_ID, findSchool, getSchool, resolveSchoolId, type SchoolProfile } from "./registry";

const SETTING_KEY = "school.modules.v1";

/** 后台对默认档案的改动：{ 学校 id: { 功能: 开/关 } }。没写的功能沿用学校档案的默认值。 */
export type SchoolModuleOverrides = Record<string, Record<string, boolean>>;

let overrides: SchoolModuleOverrides = {};

/** 这所学校能不能打开这个功能：没实现、或还没按学校隔离的，只有默认学校能开。 */
export function isSchoolModuleAvailable(school: SchoolProfile, module: SchoolModuleDefinition) {
  if (module.implementedFor && !module.implementedFor.includes(school.id)) return false;
  return module.isolation !== "pending" || school.id === DEFAULT_SCHOOL_ID;
}

export function isSchoolModuleEnabled(schoolId: string | null | undefined, key: string) {
  const school = getSchool(schoolId);
  const module = findSchoolModule(key);
  if (!module || !isSchoolModuleAvailable(school, module)) return false;
  return overrides[school.id]?.[key] ?? school.defaultModules.includes(key);
}

export function getSchoolModuleStates(schoolId: string | null | undefined) {
  const school = getSchool(schoolId);
  return SCHOOL_MODULES.map((module) => ({
    key: module.key,
    label: module.label,
    isolation: module.isolation,
    available: isSchoolModuleAvailable(school, module),
    defaultEnabled: school.defaultModules.includes(module.key),
    override: overrides[school.id]?.[module.key] ?? null,
    enabled: isSchoolModuleEnabled(school.id, module.key),
  }));
}

export function getEnabledSchoolModules(schoolId: string | null | undefined) {
  return SCHOOL_MODULES.filter((module) => isSchoolModuleEnabled(schoolId, module.key)).map((module) => module.key);
}

function normalizeOverrides(input: unknown): SchoolModuleOverrides {
  const raw = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const result: SchoolModuleOverrides = {};
  for (const [schoolId, value] of Object.entries(raw)) {
    if (!findSchool(schoolId) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const modules: Record<string, boolean> = {};
    for (const [key, enabled] of Object.entries(value as Record<string, unknown>)) {
      if (findSchoolModule(key) && typeof enabled === "boolean") modules[key] = enabled;
    }
    if (Object.keys(modules).length) result[schoolId] = modules;
  }
  return result;
}

export async function loadSchoolModuleOverrides() {
  if (!process.env.DATABASE_URL) return overrides;
  const row = await prisma.siteSetting.findUnique({ where: { key: SETTING_KEY }, select: { value: true } });
  try {
    overrides = normalizeOverrides(row?.value ? JSON.parse(row.value) : {});
  } catch (error) {
    console.warn("[schools] 功能开关配置无效，按学校档案默认值处理", error);
    overrides = {};
  }
  return overrides;
}

/** 整体替换一所学校的开关。等于默认值的项不存，档案默认值以后变了能跟着走。 */
export async function saveSchoolModuleOverrides(schoolId: string, input: unknown) {
  const school = findSchool(schoolId);
  if (!school) throw Errors.notFound("学校不存在");
  const raw = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const modules: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(raw)) {
    const module = findSchoolModule(key);
    if (!module) throw Errors.badRequest(`未知功能：${key}`);
    if (typeof enabled !== "boolean") throw Errors.badRequest(`${module.label} 的开关必须是布尔值`);
    if (enabled && !isSchoolModuleAvailable(school, module)) {
      throw Errors.badRequest(`${school.shortName}还不能打开「${module.label}」：这个功能尚未按学校隔离或没有该校的实现`);
    }
    if (enabled !== school.defaultModules.includes(key)) modules[key] = enabled;
  }
  const latest = await loadSchoolModuleOverrides();
  const next = { ...latest };
  if (Object.keys(modules).length) next[school.id] = modules;
  else delete next[school.id];
  const value = JSON.stringify(next);
  await prisma.siteSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
  overrides = next;
  await broadcastSiteSettingsReload();
  return getSchoolModuleStates(school.id);
}

/**
 * 请求属于哪所学校。挂载层的守卫跑在各路由自己的鉴权之前，所以没有 req.user 时
 * 直接验令牌签名取 schoolId，不查库；旧令牌和访客都按默认学校。
 */
export function requestSchoolId(req: Request): string {
  if (req.user?.schoolId) return resolveSchoolId(req.user.schoolId);
  const header = req.headers.authorization;
  const token = req.browserSession?.siteToken || (header?.startsWith("Bearer ") ? header.slice(7) : "");
  if (token) {
    try {
      return resolveSchoolId(verifyToken(token).schoolId);
    } catch {
      // 令牌无效时交给后面的鉴权去回 401，这里只决定按哪所学校的开关放行。
    }
  }
  return DEFAULT_SCHOOL_ID;
}

export function requireSchoolModule(key: string) {
  if (!findSchoolModule(key)) throw new Error(`Unknown school module: ${key}`);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (isSchoolModuleEnabled(requestSchoolId(req), key)) return next();
    next(Errors.notFound("本校暂未开放这个功能"));
  };
}

/** /api 下的路径前缀归哪个功能管，供挂载时套守卫。 */
export function schoolModuleForRoute(path: string) {
  return SCHOOL_MODULES.find((module) => module.routes.includes(path))?.key;
}
