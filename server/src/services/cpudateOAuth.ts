import type { User } from "@prisma/client";
import { publicAvatarValue } from "../utils/publicAvatar";

type CpudateUser = Pick<User, "id" | "username" | "studentSso" | "schoolId" | "nickname" | "avatar">;

export function buildCpudateUserInfo(user: CpudateUser, siteOrigin = "https://cputime.cn") {
  const publicAvatar = publicAvatarValue(user);
  let avatar: string | null = null;
  if (publicAvatar) {
    try {
      const url = new URL(publicAvatar, siteOrigin);
      if (url.protocol === "https:" || url.protocol === "http:") avatar = url.toString();
    } catch { /* An invalid legacy avatar must not prevent account login. */ }
  }
  return {
    sub: String(user.id),
    user: {
      id: user.id,
      // Local passwords can use arbitrary usernames; only school SSO proves this identity.
      studentId: user.studentSso ? user.username : null,
      studentSso: user.studentSso,
      schoolId: user.schoolId,
      nickname: user.nickname,
      avatar,
    },
  };
}
