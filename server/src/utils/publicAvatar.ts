import { createHash } from "node:crypto";

const DATA_AVATAR_RE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\r\n]+)$/i;
const avatarVersionCache = new Map<string, string>();
const AVATAR_VERSION_CACHE_MAX = 100;

export function dataAvatarVersion(avatar: string) {
  const cached = avatarVersionCache.get(avatar);
  if (cached) return cached;
  const version = createHash("sha256").update(avatar).digest("hex").slice(0, 16);
  if (avatarVersionCache.size >= AVATAR_VERSION_CACHE_MAX) {
    const oldest = avatarVersionCache.keys().next().value;
    if (oldest) avatarVersionCache.delete(oldest);
  }
  avatarVersionCache.set(avatar, version);
  return version;
}

export function publicAvatarValue(user: { id?: unknown; avatar?: unknown } | null | undefined) {
  const avatar = typeof user?.avatar === "string" ? user.avatar.trim() : "";
  const id = Number(user?.id);
  if (!avatar || !Number.isInteger(id) || id <= 0 || !DATA_AVATAR_RE.test(avatar)) return avatar || null;
  return `/api/user-avatars/${id}?v=${dataAvatarVersion(avatar)}`;
}

export function compactUserAvatar<T extends { id?: unknown; avatar?: unknown } | null | undefined>(user: T): T {
  if (!user) return user;
  const avatar = publicAvatarValue(user);
  if (avatar === user.avatar) return user;
  return { ...user, avatar } as T;
}

export function compactTopicAuthors<T extends { author?: any }>(items: T[]) {
  return items.map((item) => {
    const author = compactUserAvatar(item.author);
    return author === item.author ? item : { ...item, author };
  });
}

export function decodeDataAvatar(avatar: string) {
  const match = DATA_AVATAR_RE.exec(avatar.trim());
  if (!match) return null;
  return {
    contentType: match[1].toLowerCase(),
    data: Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
    version: dataAvatarVersion(avatar.trim()),
  };
}
