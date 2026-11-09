import { Router } from "express";
import { ok } from "../utils/response";
import { DEFAULT_SCHOOL_ID, activeCelebration, getSchool, listSchools, type SchoolProfile } from "../schools/registry";
import { getEnabledSchoolModules, requestSchoolId } from "../schools/modules";
import { schoolModulePageMap } from "../schools/catalog";

export const schoolsRouter = Router();

function publicSchool(school: SchoolProfile) {
  return {
    id: school.id,
    name: school.name,
    shortName: school.shortName,
    brandName: school.brandName,
    tagline: school.tagline,
    academicSystem: school.academicSystem,
    academicViews: school.academicViews,
    academicPortals: school.academicPortals ?? null,
    ssoLogin: school.ssoLogin,
    /** 默认学校：历史数据和没有学校的访客都归它。网页只用来决定是否原样显示写给它的文字。 */
    isDefault: school.id === DEFAULT_SCHOOL_ID,
    clientApps: school.clientApps,
    /** 有融合门户（教务登录后能列出校内应用）的学校。 */
    campusPortal: Boolean(school.hosts.portal),
    campuses: school.campuses,
    userGroup: school.userGroup ?? null,
    publicLinks: school.publicLinks,
    periods: school.defaultPeriods,
    /** 校庆期内才给：网页据此提供并默认使用校庆主题。 */
    celebration: activeCelebration(school),
  };
}

/** 登录页可选的学校：只列开放中的。 */
schoolsRouter.get("/", (_req, res) => {
  ok(res, listSchools().filter((school) => school.enabled).map(publicSchool));
});

/** 当前访问者所属学校和这所学校开着的功能；访客按默认学校。 */
schoolsRouter.get("/current", (req, res) => {
  const school = getSchool(requestSchoolId(req));
  ok(res, { ...publicSchool(school), modules: getEnabledSchoolModules(school.id), ...schoolModulePageMap() });
});
