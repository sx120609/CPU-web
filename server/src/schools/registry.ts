import { cpuSchool } from "./cpu";

/** 一节课的时间。学校档案里给的是默认作息，后台在 SchedulePeriodConfig 里改过的以后台为准。 */
export type SchoolPeriod = {
  no: number;
  name: string;
  start: string;
  end: string;
};

/** 教务系统类型。同一类型的学校共用一套登录和解析代码，只换学校配置。 */
export type AcademicSystemKind = "qiangzhi-jsxsd";

export type SchoolProfile = {
  id: string;
  /** 学校全称，例如「中国药科大学」 */
  name: string;
  /** 简称，例如「药大」 */
  shortName: string;
  /** 站点在这所学校的名字，例如「药大拾间」 */
  brandName: string;
  academicSystem: AcademicSystemKind;
  /** 能否用学校统一身份认证登录（要有该校的教务登录实现）；不能的学校只用站内账号登录。 */
  ssoLogin: boolean;
  /** 学校自己的系统域名，只用于展示和排查；请求地址仍在各自的客户端里。 */
  hosts: Record<string, string>;
  defaultPeriods: readonly SchoolPeriod[];
  /** 这所学校默认开着哪些功能；没列出的功能默认关闭。 */
  defaultModules: readonly string[];
};

/** 历史数据全部属于药大：没有 schoolId 的旧令牌、旧行和访客都按药大处理。 */
export const DEFAULT_SCHOOL_ID = "cpu";

const SCHOOLS: ReadonlyMap<string, SchoolProfile> = new Map([cpuSchool].map((school) => [school.id, school]));

export function listSchools(): SchoolProfile[] {
  return [...SCHOOLS.values()];
}

export function findSchool(id: string | null | undefined): SchoolProfile | null {
  return (id && SCHOOLS.get(id)) || null;
}

export function getSchool(id: string | null | undefined): SchoolProfile {
  return findSchool(id) ?? SCHOOLS.get(DEFAULT_SCHOOL_ID)!;
}

export function resolveSchoolId(id: string | null | undefined): string {
  return getSchool(id).id;
}

export function getDefaultSchool(): SchoolProfile {
  return getSchool(DEFAULT_SCHOOL_ID);
}
