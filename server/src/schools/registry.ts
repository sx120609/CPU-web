import { cpuSchool } from "./cpu";
import { njmuSchool } from "./njmu/profile";

/** 一节课的时间。学校档案里给的是默认作息，后台在 SchedulePeriodConfig 里改过的以后台为准。 */
export type SchoolPeriod = {
  no: number;
  name: string;
  start: string;
  end: string;
};

/** 教务系统类型。同一类型的学校共用一套登录和解析代码，只换学校配置。 */
export type AcademicSystemKind = "qiangzhi-jsxsd" | "zhengfang-v9";

/**
 * 拾间品牌下的一所学校。名称、品牌名、标语、是否开放存在 School 表里，后台可改；
 * 教务对接、统一认证、默认作息这些要写代码的部分只有内置学校才有（见 cpu.ts）。
 */
export type SchoolProfile = {
  id: string;
  /** 学校全称，例如「中国药科大学」 */
  name: string;
  /** 简称，例如「药大」 */
  shortName: string;
  /** 站点在这所学校的名字，例如「药大拾间」 */
  brandName: string;
  /** 品牌名下面的一行小字，例如「CPU 校园互助服务」 */
  tagline: string;
  /** 关闭时登录页不再列出，已有账号照常使用。 */
  enabled: boolean;
  academicSystem: AcademicSystemKind | null;
  /** 能否用学校统一身份认证登录（要有该校的教务登录实现）；不能的学校只用站内账号登录。 */
  ssoLogin: boolean;
  /** 学校自己的系统域名，只用于展示和排查；请求地址仍在各自的客户端里。 */
  hosts: Record<string, string>;
  defaultPeriods: readonly SchoolPeriod[];
  /** 这所学校默认开着哪些功能；没列出的功能默认关闭。 */
  defaultModules: readonly string[];
};

/** School 表里一行能改的部分。 */
export type SchoolRow = {
  id: string;
  name: string;
  shortName: string;
  brandName: string;
  tagline: string;
  enabled: boolean;
};

/** 历史数据全部属于药大：没有 schoolId 的旧令牌、旧行和访客都按药大处理。 */
export const DEFAULT_SCHOOL_ID = "cpu";

/** 有代码实现的学校；School 表里没有它们的行时也照样可用。 */
export const BUILTIN_SCHOOLS: ReadonlyMap<string, SchoolProfile> = new Map([cpuSchool, njmuSchool].map((school) => [school.id, school]));

let schools: ReadonlyMap<string, SchoolProfile> = BUILTIN_SCHOOLS;

/** 后台新建的学校没有教务实现，只用站内账号；默认打开所有已按学校隔离的功能。 */
export function schoolFromRow(row: SchoolRow, allModules: readonly string[]): SchoolProfile {
  const builtin = BUILTIN_SCHOOLS.get(row.id);
  return {
    ...(builtin ?? { academicSystem: null, ssoLogin: false, hosts: {}, defaultPeriods: [], defaultModules: allModules }),
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    brandName: row.brandName,
    tagline: row.tagline,
    enabled: row.enabled,
  };
}

/** 用 School 表的内容替换内存里的学校表；内置学校缺行时保留代码里的默认档案。 */
export function applySchoolRows(rows: readonly SchoolRow[], allModules: readonly string[]) {
  const next = new Map(BUILTIN_SCHOOLS);
  for (const row of rows) next.set(row.id, schoolFromRow(row, allModules));
  schools = next;
}

export function listSchools(): SchoolProfile[] {
  return [...schools.values()];
}

export function findSchool(id: string | null | undefined): SchoolProfile | null {
  return (id && schools.get(id)) || null;
}

export function getSchool(id: string | null | undefined): SchoolProfile {
  return findSchool(id) ?? schools.get(DEFAULT_SCHOOL_ID)!;
}

export function resolveSchoolId(id: string | null | undefined): string {
  return getSchool(id).id;
}

export function getDefaultSchool(): SchoolProfile {
  return getSchool(DEFAULT_SCHOOL_ID);
}
