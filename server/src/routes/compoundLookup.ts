import { Router } from "express";
import { z } from "zod";
import { securityRateLimit } from "../middleware/securityRateLimit";
import { CompoundUpstreamError, compoundLibraryMeta, getCompoundDetail, getStructureImage, lookupCompound, searchLibrary } from "../services/compoundLookup";
import { Errors, ok } from "../utils/response";

// 公开只读：不需要登录，不写库。每次查询最多触发 4 个 PubChem 请求，按账号（未登录按 IP）限速。
export const compoundLookupRouter = Router();

const lookupLimit = securityRateLimit("compound-lookup", 40, 60_000);
const querySchema = z.object({ q: z.string().trim().min(1).max(120) }).strict();

function upstream(error: unknown): never {
  if (error instanceof CompoundUpstreamError) {
    throw Errors.badGateway("PubChem 暂时连不上，请稍后再试");
  }
  throw error;
}

compoundLookupRouter.get("/meta", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  ok(res, compoundLibraryMeta);
});

compoundLookupRouter.get("/suggest", (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw Errors.badRequest("请输入要查的物质，最多 120 字");
    res.setHeader("Cache-Control", "public, max-age=300");
    ok(res, searchLibrary(parsed.data.q, 8));
  } catch (error) { next(error); }
});

compoundLookupRouter.get("/lookup", lookupLimit, async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw Errors.badRequest("请输入要查的物质，最多 120 字");
    ok(res, await lookupCompound(parsed.data.q).catch(upstream));
  } catch (error) { next(error); }
});

// 图片按 CID 固定不变，浏览器可以长缓存；单独限速，防止有人按 CID 批量拉图。
compoundLookupRouter.get("/cid/:cid/structure.png", securityRateLimit("compound-structure", 120, 60_000), async (req, res, next) => {
  try {
    if (!/^\d{1,10}$/u.test(req.params.cid)) throw Errors.badRequest("CID 只能是数字");
    const image = await getStructureImage(Number(req.params.cid)).catch(upstream);
    if (!image) throw Errors.notFound("没有这个物质的结构图");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(image);
  } catch (error) { next(error); }
});

compoundLookupRouter.get("/cid/:cid", lookupLimit, async (req, res, next) => {
  try {
    if (!/^\d{1,10}$/u.test(req.params.cid)) throw Errors.badRequest("CID 只能是数字");
    const detail = await getCompoundDetail(Number(req.params.cid)).catch(upstream);
    if (!detail) throw Errors.notFound("PubChem 没有这个 CID");
    ok(res, detail);
  } catch (error) { next(error); }
});
