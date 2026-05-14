import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";

export const servicesRouter = Router();

servicesRouter.get("/", async (req, res, next) => {
  try {
    const category = req.query.category ? String(req.query.category) : undefined;
    const where: any = { hidden: false };
    if (category) where.category = category;
    const list = await prisma.serviceCard.findMany({
      where,
      orderBy: [{ order: "asc" }, { id: "asc" }],
    });
    ok(res, list);
  } catch (e) { next(e); }
});
