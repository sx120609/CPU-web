import { Router } from "express";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { withCache } from "../services/cache";
import { enabledBoardTypes, featureClosedMessage, isBoardTypeEnabled } from "../services/siteSettings";
import { ensureCanReadBoardType, resolveForumAccess } from "../services/forumAccess";

export const boardRouter = Router();

/** 板块列表（按 order） */
boardRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user?.userId ?? null;
    const role = req.user?.role ?? null;
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    const allowedTypes = forumAccessEnabled ? enabledBoardTypes() : ["announce"];
    const boards = await withCache("boards", ["list", forumAccessEnabled ? "forum-enabled" : "announce-only"], 5 * 60_000, async () => prisma.board.findMany({
      where: { type: { in: allowedTypes } },
      orderBy: { order: "asc" },
      include: {
        feedSource: { select: { name: true, homepage: true, lastRunAt: true, enabled: true } },
      },
    }));
    ok(res, boards);
  } catch (e) { next(e); }
});

/** 板块详情（含最近帖子聚合，可选） */
boardRouter.get("/:slug", async (req, res, next) => {
  try {
    const userId = req.user?.userId ?? null;
    const role = req.user?.role ?? null;
    const board = await withCache("boards", ["detail", req.params.slug], 5 * 60_000, async () => prisma.board.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        icon: true,
        color: true,
        order: true,
        type: true,
        readOnly: true,
        anonymousEnabled: true,
        topicCount: true,
        feedSource: { select: { name: true, homepage: true, lastRunAt: true, enabled: true } },
      },
    }));
    if (!board) return res.status(404).json({ code: 4004, data: null, message: "板块不存在" });
    if (!isBoardTypeEnabled(board.type)) throw Errors.forbidden(featureClosedMessage(board.type));
    await ensureCanReadBoardType(board.type, userId, role);
    ok(res, board);
  } catch (e) { next(e); }
});
