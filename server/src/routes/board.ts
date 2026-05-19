import { Router } from "express";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { enabledBoardTypes, featureClosedMessage, isBoardTypeEnabled } from "../services/siteSettings";
import { ensureCanReadBoardType, resolveForumAccess } from "../services/forumAccess";
import { verifyToken } from "../utils/jwt";

export const boardRouter = Router();

/** 板块列表（按 order） */
boardRouter.get("/", async (req, res, next) => {
  try {
    let userId: number | null = null;
    let role: string | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const token = verifyToken(auth.slice(7));
        userId = token.userId;
        role = token.role;
      } catch { /* ignore */ }
    }
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    const boards = await prisma.board.findMany({
      where: { type: { in: forumAccessEnabled ? enabledBoardTypes() : ["announce"] } },
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
    let userId: number | null = null;
    let role: string | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const token = verifyToken(auth.slice(7));
        userId = token.userId;
        role = token.role;
      } catch { /* ignore */ }
    }
    const board = await prisma.board.findUnique({
      where: { slug: req.params.slug },
      include: {
        feedSource: { select: { name: true, homepage: true, lastRunAt: true } },
      },
    });
    if (!board) return res.status(404).json({ code: 4004, data: null, message: "板块不存在" });
    if (!isBoardTypeEnabled(board.type)) throw Errors.forbidden(featureClosedMessage(board.type));
    await ensureCanReadBoardType(board.type, userId, role);
    ok(res, board);
  } catch (e) { next(e); }
});
