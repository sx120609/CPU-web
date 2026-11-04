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
    academicSystem: school.academicSystem,
    ssoLogin: school.ssoLogin,
    periods: school.defaultPeriods,
  };
}

schoolsRouter.get("/", (_req, res) => {
  ok(res, listSchools().map(publicSchool));
});

/** 当前访问者所属学校和这所学校开着的功能；访客按默认学校。 */
schoolsRouter.get("/current", (req, res) => {
  const school = getSchool(requestSchoolId(req));
  ok(res, { ...publicSchool(school), modules: getEnabledSchoolModules(school.id), ...schoolModulePageMap() });
});
