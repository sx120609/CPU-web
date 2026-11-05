import { Router } from "express";
import { ok } from "../utils/response";
import { getSchool, listSchools, type SchoolProfile } from "../schools/registry";
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
    periods: school.defaultPeriods,
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
