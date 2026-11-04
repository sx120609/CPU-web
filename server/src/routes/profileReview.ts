import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { decideProfileReview } from "../services/profileReview";
import { deleteManagedUserAvatar } from "../services/userAvatarStorage";
import { invalidateForumCaches } from "../services/cacheInvalidation";
import { requestSchoolId } from "../schools/modules";

export const profileReviewAdminRouter = Router();
/** 资料审核只处理本校账号。 */
async function ensureUserInViewerSchool(req: Request, userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { schoolId: true } });
  if (!user || user.schoolId !== requestSchoolId(req)) throw Errors.notFound();
}

profileReviewAdminRouter.get("/", async (req, res, next) => {
  try {
    ok(res, await prisma.user.findMany({ where: { schoolId: requestSchoolId(req), profileReviewStatus: "pending", status: { notIn: ["deleting", "deleted"] } }, orderBy: { updatedAt: "asc" }, take: 100, select: { id: true, nickname: true, avatar: true, bio: true, pendingProfile: true, updatedAt: true } }));
  } catch (error) { next(error); }
});
profileReviewAdminRouter.post("/:id", validate(z.object({ snapshot: z.string().max(10000), approve: z.boolean(), note: z.string().trim().max(1000) })), async (req, res, next) => {
  try {
    await ensureUserInViewerSchool(req, Number(req.params.id));
    await decideProfileReview(Number(req.params.id), req.user!.userId, req.body.snapshot, req.body.approve, req.body.note);
    ok(res, { handled: true });
  }
  catch (error) { next(error); }
});
profileReviewAdminRouter.post("/:id/clear", validate(z.object({ reason: z.string().trim().min(2).max(1000) })), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.schoolId !== requestSchoolId(req) || ["deleting", "deleted"].includes(user.status)) throw Errors.notFound();
    if (user.role === "admin" && req.user!.role !== "admin") throw Errors.forbidden();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { nickname: "用户", avatar: null, bio: null, college: null, pendingProfile: null, pendingNickname: null, nicknameReviewStatus: "rejected", nicknameReviewReason: req.body.reason, profileReviewStatus: "rejected", profileReviewReason: req.body.reason } });
      await tx.notification.create({ data: { userId: id, category: "profile-review", title: "公开资料已被清除", content: req.body.reason, source: "人工审核", link: "/profile", payload: JSON.stringify({ reviewerId: req.user!.userId, action: "clear-profile" }) } });
    });
    await deleteManagedUserAvatar(user.avatar);
    if (user.pendingProfile) {
      const pending = JSON.parse(user.pendingProfile);
      if (pending.avatar !== user.avatar) await deleteManagedUserAvatar(pending.avatar);
    }
    await invalidateForumCaches();
    ok(res, { handled: true });
  } catch (error) { next(error); }
});
