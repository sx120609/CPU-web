import { Router } from "express";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { withCache } from "../services/cache";
import { featureClosedMessage } from "../services/siteSettings";
import { ensureCanReadBoardType, resolveForumAccess } from "../services/forumAccess";
import { isRetiredBoardSlug, visibleBoardSlugFilter } from "../services/retiredBoards";
import { isBoardTypeOpen, openBoardTypes, requestSchoolId } from "../schools/modules";
import { boardSlugKey } from "../schools/forumScope";

export const boardRouter = Router();

/** 板块列表（按 order） */
boardRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user?.userId ?? null;
    const role = req.user?.role ?? null;
    const schoolId = requestSchoolId(req);
    const forumAccessEnabled = await resolveForumAccess(userId, role);
    const allowedTypes = forumAccessEnabled ? openBoardTypes(requestSchoolId(req)) : ["announce"];
    const boards = await withCache("boards", ["list-v3", schoolId, forumAccessEnabled ? "forum-enabled" : "announce-only"], 5 * 60_000, async () => prisma.board.findMany({
      where: { schoolId, type: { in: allowedTypes }, ...visibleBoardSlugFilter() },
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
    if (isRetiredBoardSlug(req.params.slug)) {
      return res.status(404).json({ code: 4004, data: null, message: "板块不存在" });
    }
    const schoolId = requestSchoolId(req);
    const board = await withCache("boards", ["detail-v3", schoolId, req.params.slug], 5 * 60_000, async () => prisma.board.findUnique({
      where: boardSlugKey(schoolId, req.params.slug),
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
    if (!isBoardTypeOpen(requestSchoolId(req), board.type)) throw Errors.forbidden(featureClosedMessage(board.type));
    await ensureCanReadBoardType(board.type, userId, role);
    ok(res, board);
  } catch (e) { next(e); }
});
