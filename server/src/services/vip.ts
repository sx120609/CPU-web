import { prisma } from "../prisma";

export const VIP_PROFILE_THEMES = ["mint", "sunset", "ocean", "lavender"] as const;
export const VIP_PROFILE_FRAMES = ["gold", "neon", "campus"] as const;

export function isVipActive(user: { isVip?: boolean | null } | null | undefined) {
  return Boolean(user?.isVip);
}

export async function isUserVip(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isVip: true },
  });
  return isVipActive(user);
}
