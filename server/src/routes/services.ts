import { Router } from "express";
import { prisma } from "../prisma";
import { ok, Errors, HttpError } from "../utils/response";
import { withCache } from "../services/cache";
import { authRequired } from "../middleware/auth";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { queryDormElectric } from "../services/dormElectric";
import { isFeatureOn } from "../services/siteSettings";
import { isSchoolModuleEnabled, requestSchoolId } from "../schools/modules";
import { resolveSchoolId } from "../schools/registry";

export const servicesRouter = Router();

servicesRouter.get("/", async (req, res, next) => {
  try {
    const category = req.query.category ? String(req.query.category) : undefined;
    const schoolId = requestSchoolId(req);
    const list = await withCache("services", ["list", schoolId, category || "all"], 5 * 60_000, async () => prisma.serviceCard.findMany({
      where: visibleServiceWhere(schoolId, category ? { category } : undefined),
      orderBy: [{ order: "asc" }, { id: "asc" }],
    }));
    ok(res, list.map(normalizeServiceCard));
  } catch (e) { next(e); }
});

/**
 * 宿舍用电查询：站内代理，不外跳。学号取自当前登录用户。
 * 仅站内登录用户可用，避免被脚本拿来扫学号。
 */
servicesRouter.get("/dorm-electric", authRequired, async (req, res, next) => {
  try {
    if (!isFeatureOn("electric")) {
      throw Errors.forbidden("宿舍电费查询当前未开放");
    }
    // 查的是本校电表系统，学号只在本校内唯一：按登录账号自己的学校判断，别校学号不能拿来查。
    if (!isSchoolModuleEnabled(resolveSchoolId(req.user!.schoolId), "dormElectric")) {
      throw Errors.notFound("本校暂未开放宿舍电费查询");
    }
    const studentNo = (req.user!.studentId || "").trim();
    if (!studentNo) throw Errors.badRequest("当前账号未关联学号");
    const result = await queryDormElectric(studentNo);
    ok(res, result);
  } catch (e: any) {
    next(e instanceof HttpError ? e : e?.message ? Errors.badRequest(e.message) : e);
  }
});
