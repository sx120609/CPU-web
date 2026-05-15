import { Router } from "express";
import { prisma } from "../prisma";
import { ok, Errors } from "../utils/response";
import { authRequired } from "../middleware/auth";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";
import { queryDormElectric } from "../services/dormElectric";

export const servicesRouter = Router();

servicesRouter.get("/", async (req, res, next) => {
  try {
    const category = req.query.category ? String(req.query.category) : undefined;
    const list = await prisma.serviceCard.findMany({
      where: visibleServiceWhere(category ? { category } : undefined),
      orderBy: [{ order: "asc" }, { id: "asc" }],
    });
    ok(res, list.map(normalizeServiceCard));
  } catch (e) { next(e); }
});

/**
 * 宿舍用电查询：站内代理，不外跳。学号取自当前登录用户。
 * 仅站内登录用户可用，避免被脚本拿来扫学号。
 */
servicesRouter.get("/dorm-electric", authRequired, async (req, res, next) => {
  try {
    // username 即学号（SSO 登录建账号时 username = studentId）
    const studentNo = (req.user!.studentId || "").trim();
    if (!studentNo) throw Errors.badRequest("当前账号未关联学号");
    const result = await queryDormElectric(studentNo);
    ok(res, result);
  } catch (e: any) {
    // 把 service 抛出的中文错误透出给前端
    next(e?.message ? Errors.badRequest(e.message) : e);
  }
});
