import { Router } from "express";
import { ok } from "../utils/response";
import { getFeatures, getSiteConfig } from "../services/siteSettings";

export const siteRouter = Router();

/** 公开：前端读功能开关，过滤导航 / 路由 / 占位页 */
siteRouter.get("/features", (_req, res) => {
  ok(res, getFeatures());
});

/** 公开：站点基础配置。不要放敏感内容。 */
siteRouter.get("/config", (_req, res) => {
  ok(res, getSiteConfig());
});
