import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { ok } from "../utils/response";
import { visibleBoardSlugFilter } from "../services/retiredBoards";
import { announcementOverridesFor, resolveAnnouncementSelection } from "../services/portalNotices";
import { isOwnCollegeBoard } from "../services/collegeFeedSources";

export const announcementsRouter = Router();

function slugList(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((slug): slug is string => typeof slug === "string") : [];
  } catch {
    return [];
  }
}

/** 公告板块以及它对这个用户是否默认显示：全站默认的，加上用户自己学院的。 */
async function announcementSources(userId: number) {
  const [boards, user] = await Promise.all([
    prisma.board.findMany({
      where: { type: "announce", ...visibleBoardSlugFilter() },
      select: { slug: true, announceDefault: true, feedDepartment: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { college: true } }),
  ]);
  return boards.map((board) => ({
    slug: board.slug,
    announceDefault: board.announceDefault || isOwnCollegeBoard(board, user?.college),
  }));
}

function defaultSlugs(sources: Array<{ slug: string; announceDefault: boolean }>) {
  return sources.filter((source) => source.announceDefault).map((source) => source.slug);
}

/** 当前用户选的公告部门；没选过时 customized=false，selected 就是 defaults。 */
announcementsRouter.get("/preference", authRequired, async (req, res, next) => {
  try {
    const [sources, row] = await Promise.all([
      announcementSources(req.user!.userId),
      prisma.announcementPreference.findUnique({ where: { userId: req.user!.userId } }),
    ]);
    const overrides = row ? { include: slugList(row.include), exclude: slugList(row.exclude) } : null;
    ok(res, { customized: Boolean(row), selected: resolveAnnouncementSelection(sources, overrides), defaults: defaultSlugs(sources) });
  } catch (e) { next(e); }
});

announcementsRouter.put("/preference", authRequired, validate(z.object({
  selected: z.array(z.string().regex(/^[\w-]{1,64}$/)).max(200),
})), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const sources = await announcementSources(userId);
    const overrides = announcementOverridesFor(sources, req.body.selected);
    const data = { include: JSON.stringify(overrides.include), exclude: JSON.stringify(overrides.exclude) };
    await prisma.announcementPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    ok(res, { customized: true, selected: resolveAnnouncementSelection(sources, overrides), defaults: defaultSlugs(sources) });
  } catch (e) { next(e); }
});

/** 恢复默认。 */
announcementsRouter.delete("/preference", authRequired, async (req, res, next) => {
  try {
    await prisma.announcementPreference.deleteMany({ where: { userId: req.user!.userId } });
    const defaults = defaultSlugs(await announcementSources(req.user!.userId));
    ok(res, { customized: false, selected: defaults, defaults });
  } catch (e) { next(e); }
});
