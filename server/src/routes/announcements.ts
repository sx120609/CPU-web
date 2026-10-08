import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authRequired } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { ok } from "../utils/response";
import { visibleBoardSlugFilter } from "../services/retiredBoards";
import { announcementOverridesFor, resolveAnnouncementSelection } from "../services/portalNotices";

export const announcementsRouter = Router();

function slugList(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((slug): slug is string => typeof slug === "string") : [];
  } catch {
    return [];
  }
}

function announcementSources() {
  return prisma.board.findMany({
    where: { type: "announce", ...visibleBoardSlugFilter() },
    select: { slug: true, announceDefault: true },
  });
}

/** 当前用户选的公告部门；没选过时 customized=false，selected 是默认集合。 */
announcementsRouter.get("/preference", authRequired, async (req, res, next) => {
  try {
    const [sources, row] = await Promise.all([
      announcementSources(),
      prisma.announcementPreference.findUnique({ where: { userId: req.user!.userId } }),
    ]);
    const overrides = row ? { include: slugList(row.include), exclude: slugList(row.exclude) } : null;
    ok(res, { customized: Boolean(row), selected: resolveAnnouncementSelection(sources, overrides) });
  } catch (e) { next(e); }
});

announcementsRouter.put("/preference", authRequired, validate(z.object({
  selected: z.array(z.string().regex(/^[\w-]{1,64}$/)).max(200),
})), async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const sources = await announcementSources();
    const overrides = announcementOverridesFor(sources, req.body.selected);
    const data = { include: JSON.stringify(overrides.include), exclude: JSON.stringify(overrides.exclude) };
    await prisma.announcementPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    ok(res, { customized: true, selected: resolveAnnouncementSelection(sources, overrides) });
  } catch (e) { next(e); }
});

/** 恢复默认。 */
announcementsRouter.delete("/preference", authRequired, async (req, res, next) => {
  try {
    await prisma.announcementPreference.deleteMany({ where: { userId: req.user!.userId } });
    ok(res, { customized: false, selected: resolveAnnouncementSelection(await announcementSources(), null) });
  } catch (e) { next(e); }
});
