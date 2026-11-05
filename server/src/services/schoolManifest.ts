import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { findSchool } from "../schools/registry";

/**
 * 添加到主屏幕用的 web app manifest 按学校给名字：网页拿到学校后把 <link rel="manifest"> 指向
 * /manifest-v3.webmanifest?school=<id>（启动脚本 appearance-bootstrap.js 和 stores/site.ts），这里换上那所学校的品牌。
 * 不带学校或学校不存在时交给静态文件，原样返回打包里的那份。
 */
export function createSchoolManifestHandler(dist: string) {
  let template: Record<string, unknown> | null = null;
  return async (req: Request, res: Response, next: NextFunction) => {
    const schoolId = typeof req.query.school === "string" ? req.query.school.trim() : "";
    const school = schoolId ? findSchool(schoolId) : null;
    if (!school) return next();
    try {
      template ??= JSON.parse(await readFile(path.join(dist, "manifest-v3.webmanifest"), "utf8")) as Record<string, unknown>;
    } catch {
      return next();
    }
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(JSON.stringify(schoolManifest(template, school)));
  };
}

export function schoolManifest(template: Record<string, unknown>, school: { brandName: string; name: string }) {
  return {
    ...template,
    name: school.brandName,
    short_name: school.brandName,
    description: `${school.name}的课表、教务数据、校园公告与校园服务入口`,
  };
}
