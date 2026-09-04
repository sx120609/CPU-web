type Viewer = {
  userId?: number | null;
  role?: string | null;
} | null | undefined;

const MODERATION_PLACEHOLDER_RE = /(?:\bdata-(?:image|video)-review-state\s*=|\b(?:image|video)-review-placeholder(?:-[a-z_]+)?\b)/i;

export function editableForumContentForViewer(
  content: string | null | undefined,
  authorId: number | null | undefined,
  viewer?: Viewer,
) {
  const viewerId = Number(viewer?.userId || 0);
  const canEdit = viewerId > 0 && (
    viewerId === Number(authorId || 0)
    || viewer?.role === "admin"
    || viewer?.role === "mod"
  );
  return canEdit ? String(content || "") : undefined;
}

export function containsForumModerationPlaceholder(content: string | null | undefined) {
  return MODERATION_PLACEHOLDER_RE.test(String(content || ""));
}
