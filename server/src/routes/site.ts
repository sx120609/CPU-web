import { Router } from "express";
import { ok } from "../utils/response";
import { getFeatures } from "../services/siteSettings";

export const siteRouter = Router();

/** 公开：前端读功能开关，过滤导航 / 路由 / 占位页 */
siteRouter.get("/features", (_req, res) => {
  ok(res, getFeatures());
});
