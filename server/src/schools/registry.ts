import { cpuSchool } from "./cpu";
import { njmuSchool } from "./njmu/profile";
import { njucmSchool } from "./njucm/profile";

/** 一节课的时间。学校档案里给的是默认作息，后台在 SchedulePeriodConfig 里改过的以后台为准。 */
export type SchoolPeriod = {
  no: number;
  name: string;
  start: string;
  end: string;
};

/**
 * 教务页上的视图：主标签（课表、成绩、学业完成情况、培养方案、选课、教室）和其中的子视图。
 * 每所学校在档案里列出自己接了哪些，网页只按这份清单显示，不按学校名判断。
 */
export const ACADEMIC_VIEWS = [
  "schedule",
  "grades",
  "levelExams",
  "exams",
  "transcript",
  "progress",
  "graduationAudit",
  "retake",
  "studentStatus",
  "pyfa",
  "selection",
  "freeRooms",
  "timetableSearch",
] as const;
export type AcademicView = typeof ACADEMIC_VIEWS[number];

/** 教务系统类型。同一类型的学校共用一套登录和解析代码，只换学校配置。 */
export type AcademicSystemKind = "qiangzhi-jsxsd" | "zhengfang-v9" | "shuwei-eams";

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
  /** 教务页显示哪些视图（见 ACADEMIC_VIEWS）；没有教务对接的学校为空。 */
  academicViews: readonly AcademicView[];
  /** 教务页「前往原站」的入口：本科教务，以及有研究生系统的学校的研究生入口。 */
  academicPortals?: { undergraduate: string; graduate?: string };
  /** 拾间的手机 App、桌面端是否服务这所学校：下载页、安装提示、原生版推荐只给为 true 的学校。 */
  clientApps: boolean;
  /** 本校校区，失物招领、二手发布时给的选项；为空时只能自己填。 */
  campuses: readonly string[];
  /** 用户交流 QQ 群；没有就不显示。 */
  userGroup?: { qq: string; joinUrl: string };
  /** 没登录教务时服务页给游客的公开校园入口（图书馆、教务处、新闻网等）。 */
  publicLinks: ReadonlyArray<{ name: string; icon: string; url: string }>;
  /** 服务页顶部的站外推荐入口，在新页面打开；没有就不显示。 */
  featuredLinks?: ReadonlyArray<SchoolFeaturedLink>;
  defaultPeriods: readonly SchoolPeriod[];
  /** 校庆：在 until 之前网页提供校庆主题并默认使用，首页显示校庆横幅。没有校庆的学校不填。 */
  celebration?: SchoolCelebration;
  /** 这所学校默认开着哪些功能；没列出的功能默认关闭。 */
  defaultModules: readonly string[];
};

export type SchoolFeaturedLink = {
  name: string;
  summary: string;
  icon: string;
  /** 卡片图标的色调。 */
  tone: string;
  url: string;
  /** iOS、鸿蒙 App 内不给游客和内网限制账号看（和小游戏同一条判断），其他账号照常显示。 */
  hiddenInStoreApps?: boolean;
};

export type SchoolCelebration = {
  /** 建校年份，周年数按 date 的年份减它算。 */
  founded: number;
  /** 校庆日，北京时间的日期，YYYY-MM-DD。 */
  date: string;
  /** 校庆主题口号，例如「九秩华章 铸梦健康」。 */
  motto: string;
  /** 校庆主题停止提供的日期（北京时间零点），YYYY-MM-DD。 */
  until: string;
};

/** 校庆主题还在提供期内（按北京时间）就返回校庆信息，过了 until 返回 null。 */
export function activeCelebration(school: SchoolProfile, now = new Date()): SchoolCelebration | null {
  const celebration = school.celebration;
  if (!celebration) return null;
  const ends = Date.parse(`${celebration.until}T00:00:00+08:00`);
  return Number.isFinite(ends) && now.getTime() < ends ? celebration : null;
}

/** School 表里一行能改的部分。 */
export type SchoolRow = {
  id: string;
  name: string;
  shortName: string;
  brandName: string;
  tagline: string;
  enabled: boolean;
};

/** 拾间平台本身的品牌：赞助、微信服务号、文件收集这类全平台共用的东西用它，不用某一所学校的品牌。 */
export const PLATFORM_BRAND = "拾间";

/** 历史数据全部属于药大：没有 schoolId 的旧令牌、旧行和访客都按药大处理。 */
export const DEFAULT_SCHOOL_ID = "cpu";

/** 有代码实现的学校；School 表里没有它们的行时也照样可用。 */
export const BUILTIN_SCHOOLS: ReadonlyMap<string, SchoolProfile> = new Map([cpuSchool, njmuSchool, njucmSchool].map((school) => [school.id, school]));

let schools: ReadonlyMap<string, SchoolProfile> = BUILTIN_SCHOOLS;

/** 后台新建的学校没有教务实现，只用站内账号；默认打开所有已按学校隔离的功能。 */
export function schoolFromRow(row: SchoolRow, allModules: readonly string[]): SchoolProfile {
  const builtin = BUILTIN_SCHOOLS.get(row.id);
  return {
    ...(builtin ?? { academicSystem: null, ssoLogin: false, hosts: {}, academicViews: [], clientApps: false, campuses: [], publicLinks: [], defaultPeriods: [], defaultModules: allModules }),
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
