import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";
import { normalizeServiceCard, visibleServiceWhere } from "../services/serviceCards";

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
