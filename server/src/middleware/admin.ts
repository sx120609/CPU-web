import type { Request, Response, NextFunction } from "express";
import { Errors } from "../utils/response";
import { isModuleSuperAdmin } from "../utils/moduleRoles";
import { isPlatformAdmin } from "../schools/store";

/**
 * 仅平台管理员（默认学校的站点管理员）可访问：部署、备份、AI、支付、站点设置等全站功能。
 * 其他学校的管理员只能用按学校划分过的后台功能，见 schoolAdminOnly。
 */
export function adminOnly(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(Errors.unauthorized());
  if (req.user.role !== "admin") return next(Errors.forbidden("仅管理员可操作"));
  if (!isPlatformAdmin(req.user)) return next(Errors.forbidden("仅平台管理员可操作"));
  next();
}

/** 任一学校的站点管理员；接口内部只读写本校的数据。 */
export function schoolAdminOnly(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(Errors.unauthorized());
  if (req.user.role !== "admin") return next(Errors.forbidden("仅管理员可操作"));
  next();
}

/** mod 或 admin */
export function modOrAbove(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(Errors.unauthorized());
  if (req.user.role !== "admin" && req.user.role !== "mod") {
    return next(Errors.forbidden("仅论坛管理员 / 超级管理员可操作"));
  }
  next();
}

/** 主站管理人员或任一模块超级管理员，可读取用户目录。 */
export function userDirectoryAccess(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(Errors.unauthorized());
  if (
    req.user.role !== "admin"
    && req.user.role !== "mod"
    && !isModuleSuperAdmin(req.user, "voiceHubRole")
    && !isModuleSuperAdmin(req.user, "lostFoundRole")
  ) {
    return next(Errors.forbidden("需要用户管理权限"));
  }
  next();
}
