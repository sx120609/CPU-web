// The grades pane picks cards or a table from its own width, not the viewport: the same width can mean a
// phone, an iPad in portrait or a narrow desktop window, and only the pane width says whether the table fits.
// Pure, so tests can run it without a DOM.

export type GradesLayoutTier = "cards" | "compact" | "full";

/** Below this pane width the table no longer fits; the card list is used. */
export const GRADES_COMPACT_TABLE_MIN_WIDTH = 820;
/** From this pane width every column fits (their widths add up to about 1134 px). */
export const GRADES_FULL_TABLE_MIN_WIDTH = 1140;
/** Growing into a wider tier needs this much extra width, so a scrollbar appearing or disappearing cannot flip-flop it. */
export const GRADES_LAYOUT_HYSTERESIS = 24;
/** Viewport fallback when ResizeObserver is unavailable; the card list used to switch here. */
export const GRADES_CARDS_FALLBACK_QUERY = "(max-width: 760px)";

const TIER_RANK: Record<GradesLayoutTier, number> = { cards: 0, compact: 1, full: 2 };

function tierForWidth(width: number, margin: number): GradesLayoutTier {
  if (width >= GRADES_FULL_TABLE_MIN_WIDTH + margin) return "full";
  if (width >= GRADES_COMPACT_TABLE_MIN_WIDTH + margin) return "compact";
  return "cards";
}

/**
 * The layout tier for a pane `width`. Shrinking switches at the threshold; growing needs
 * `GRADES_LAYOUT_HYSTERESIS` more. A width of 0 (a hidden tab) keeps the previous tier.
 */
export function gradesLayoutTier(width: number, previous?: GradesLayoutTier | null): GradesLayoutTier {
  if (!Number.isFinite(width) || width <= 0) return previous ?? "full";
  const plain = tierForWidth(width, 0);
  if (!previous || TIER_RANK[plain] <= TIER_RANK[previous]) return plain;
  const grown = tierForWidth(width, GRADES_LAYOUT_HYSTERESIS);
  return TIER_RANK[grown] > TIER_RANK[previous] ? grown : previous;
}
