import { createHash } from "node:crypto";

export const FORUM_IMAGE_ARCHIVE_MIN_BYTES = 1536 * 1024;

export function buildOptimizedForumImagePath(buffer: Buffer) {
  const digest = createHash("sha256").update(buffer).digest("hex");
  return `forum/optimized/${digest.slice(0, 2)}/${digest.slice(0, 24)}.webp`;
}

export function replaceForumImageReference(value: string, oldPath: string, newPath: string) {
  if (!value || !oldPath || oldPath === newPath) return value;
  return value.split(oldPath).join(newPath);
}
