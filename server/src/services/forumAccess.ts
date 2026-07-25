export const FORUM_CONFIRM_TEXT = "我知道了";

export function isForumStaffRole(role?: string | null) {
  return role === "admin" || role === "mod" || role === "bot";
}

export function forumAccessErrorMessage(isLoggedIn: boolean) {
  return isLoggedIn
    ? "论坛已向全部用户开放"
    : "请先登录后使用此功能";
}

export async function resolveForumAccess(_userId?: number | null, _role?: string | null) {
  return true;
}

export async function ensureForumAccessEnabled(_userId: number, _role?: string | null) {
  return;
}

export async function ensureCanReadBoardType(
  _boardType: string | null | undefined,
  _userId?: number | null,
  _role?: string | null,
) {
  return;
}
