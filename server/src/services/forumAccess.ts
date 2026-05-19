import { prisma } from "../prisma";
import { Errors } from "../utils/response";

export const FORUM_CONFIRM_TEXT = "我知道了";

export function isForumStaffRole(role?: string | null) {
  return role === "admin" || role === "mod" || role === "bot";
}

export function forumAccessErrorMessage(isLoggedIn: boolean) {
  return isLoggedIn
    ? "请先开启论坛功能并确认使用须知"
    : "请先登录并开启论坛功能";
}

export async function resolveForumAccess(userId?: number | null, role?: string | null) {
  if (isForumStaffRole(role)) return true;
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { forumEnabled: true },
  });
  return Boolean(user?.forumEnabled);
}

export async function ensureForumAccessEnabled(userId: number, role?: string | null) {
  if (isForumStaffRole(role)) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { forumEnabled: true },
  });
  if (!user) throw Errors.notFound("用户不存在");
  if (!user.forumEnabled) throw Errors.forbidden(forumAccessErrorMessage(true));
}

export async function ensureCanReadBoardType(boardType: string | null | undefined, userId?: number | null, role?: string | null) {
  if (boardType === "announce") return;
  const allowed = await resolveForumAccess(userId, role);
  if (!allowed) throw Errors.forbidden(forumAccessErrorMessage(Boolean(userId)));
}
