import { Router } from "express";
import { z } from "zod";
import { departmentContactsTool, getDepartmentContact } from "../services/departmentContacts";
import { Errors, ok } from "../utils/response";

export const departmentContactsRouter = Router();
const querySchema = z.object({
  q: z.string().trim().max(160).optional(),
  category: z.string().max(80).optional(),
  campus: z.string().max(30).optional(),
  includeSpecial: z.enum(["0", "1"]).optional(),
  offset: z.coerce.number().int().min(0).max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

// Published department records are public and read-only. No login, database
// write, manager privilege or contact side effect is needed.
departmentContactsRouter.get("/", (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw Errors.badRequest("查询参数无效，关键词最多160字");
    res.setHeader("Cache-Control", "public, max-age=60");
    ok(res, departmentContactsTool.execute({ ...parsed.data, includeSpecial: parsed.data.includeSpecial === "1" }));
  } catch (error) { next(error); }
});

departmentContactsRouter.get("/:id", (req, res, next) => {
  try {
    if (!/^CPU-\d{4}$/u.test(req.params.id)) throw Errors.badRequest("联系记录编号无效");
    const contact = getDepartmentContact(req.params.id);
    if (!contact) throw Errors.notFound("没有找到这条联系记录");
    ok(res, contact);
  } catch (error) { next(error); }
});
