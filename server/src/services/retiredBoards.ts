/**
 * Boards retired from the public forum but kept in the database for history.
 * They must not be allowed back into public listings or direct topic access.
 */
const RETIRED_BOARD_SLUGS = ["campus-wall"] as const;

export function isRetiredBoardSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && (RETIRED_BOARD_SLUGS as readonly string[]).includes(slug);
}

export function visibleBoardSlugFilter() {
  return { slug: { notIn: [...RETIRED_BOARD_SLUGS] } };
}
