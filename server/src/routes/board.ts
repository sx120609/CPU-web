import { Router } from "express";
import { prisma } from "../prisma";
import { ok } from "../utils/response";

export const boardRouter = Router();

/** 板块列表（按 order） */
boardRouter.get("/", async (_req, res, next) => {
  try {
    const boards = await prisma.board.findMany({
      orderBy: { order: "asc" },
      include: {
        feedSource: { select: { name: true, homepage: true, lastRunAt: true, enabled: true } },
      },
    });
    ok(res, boards);
  } catch (e) { next(e); }
});

/** 板块详情（含最近帖子聚合，可选） */
boardRouter.get("/:slug", async (req, res, next) => {
  try {
    const board = await prisma.board.findUnique({
      where: { slug: req.params.slug },
      include: {
        feedSource: { select: { name: true, homepage: true, lastRunAt: true } },
      },
    });
    if (!board) return res.status(404).json({ code: 4004, data: null, message: "板块不存在" });
    ok(res, board);
  } catch (e) { next(e); }
});
