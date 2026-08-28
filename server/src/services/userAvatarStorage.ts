import { prisma } from "../prisma";
import { decodeDataAvatar } from "../utils/publicAvatar";
import { invalidateForumCaches } from "./cacheInvalidation";
import { buildUploadUrl, deleteMediaAsset, saveMediaAsset } from "./mediaStorage";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export async function storeUserAvatarDataUrl(userId: number, avatar: string) {
  const decoded = decodeDataAvatar(avatar);
  if (!decoded?.data.length) throw new Error("头像数据格式不正确");
  if (decoded.data.length > MAX_AVATAR_BYTES) throw new Error("头像不能超过 5MB");
  const relativePath = `avatars/${userId}/${decoded.version}.${extensionForContentType(decoded.contentType)}`;
  const saved = await saveMediaAsset({
    relativePath,
    buffer: decoded.data,
    contentType: decoded.contentType,
    mediaKind: "image",
  });
  return saved.url;
}

export async function deleteManagedUserAvatar(avatar: unknown) {
  const relativePath = managedAvatarRelativePath(avatar);
  if (!relativePath) return false;
  await deleteMediaAsset(relativePath);
  return true;
}

export async function migrateLegacyDataAvatars(input: { limit?: number; excludeUserIds?: number[] } = {}) {
  const startedAt = new Date().toISOString();
  const batchLimit = normalizeBatchLimit(input.limit);
  const excluded = [...new Set((input.excludeUserIds || []).filter((id) => Number.isInteger(id) && id > 0))];
  const where = {
    avatar: { startsWith: "data:image/" },
    ...(excluded.length ? { id: { notIn: excluded } } : {}),
  } as const;
  const eligible = await prisma.user.count({ where });
  const users = await prisma.user.findMany({
    where,
    select: { id: true, avatar: true },
    orderBy: { id: "asc" },
    take: batchLimit,
  });
  const list: Array<{ userId: number; status: "migrated" | "failed"; message: string }> = [];

  for (const user of users) {
    const legacyAvatar = String(user.avatar || "");
    try {
      const nextAvatar = await storeUserAvatarDataUrl(user.id, legacyAvatar);
      const updated = await prisma.user.updateMany({
        where: { id: user.id, avatar: legacyAvatar },
        data: { avatar: nextAvatar },
      });
      if (!updated.count) throw new Error("头像已被用户更新，本次未覆盖");
      list.push({ userId: user.id, status: "migrated", message: nextAvatar });
    } catch (error) {
      list.push({
        userId: user.id,
        status: "failed",
        message: String((error as any)?.message || error || "头像迁移失败").slice(0, 500),
      });
    }
  }

  if (list.some((item) => item.status === "migrated")) await invalidateForumCaches();
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    eligible,
    processed: users.length,
    remaining: Math.max(0, eligible - users.length),
    migrated: list.filter((item) => item.status === "migrated").length,
    failed: list.filter((item) => item.status === "failed").length,
    list,
  };
}

function managedAvatarRelativePath(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw.startsWith("/uploads/avatars/")) return "";
  const relativePath = raw.replace(/^\/uploads\/+/, "");
  return relativePath.startsWith("avatars/") ? relativePath : "";
}

function extensionForContentType(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/webp") return "webp";
  return "png";
}

function normalizeBatchLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(100, Math.max(1, Math.round(parsed)));
}
