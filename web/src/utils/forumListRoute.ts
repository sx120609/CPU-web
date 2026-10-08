import { isNavigationFailure, NavigationFailureType, type LocationQuery, type RouteLocationNormalizedLoaded, type Router } from "vue-router";
import { getFormFactor, subscribeFormFactor } from "./formFactor";

/**
 * The phone forum (IndexMobile) shows 最新 / 热榜 / 二手 / 求助 / 新生 as `/forum?channel=…`, while the
 * desktop layout has separate routes for them. These helpers translate between the two so a link, a
 * reload or a rotation across the 1024 px tablet switch always lands on the matching page.
 */
export const FORUM_LIST_LAYOUT_ROUTES: ReadonlySet<string> = new Set(["forum", "forum-hot", "forum-latest", "market"]);

/** Phone channels that are ordinary boards on the desktop layout. */
const CHANNEL_BOARD_SLUGS: Readonly<Record<string, string>> = { question: "question", freshman: "freshman" };

export type ForumListRouteInput = {
  name?: unknown;
  query: LocationQuery;
};

export type ForumListTarget =
  | { name: "forum" | "forum-hot" | "forum-latest" | "market"; query: LocationQuery }
  | { name: "board"; params: { slug: string }; query: LocationQuery };

export type ForumListOptions = {
  /** `null` / `undefined` while the site settings are not loaded; the feature gate then decides. */
  marketEnabled?: boolean | null;
};

function channelOf(query: LocationQuery) {
  const value = Array.isArray(query.channel) ? query.channel[0] : query.channel;
  return typeof value === "string" ? value : value === null ? "" : undefined;
}

function withoutChannel(query: LocationQuery): LocationQuery {
  const { channel: _channel, ...rest } = query;
  return rest;
}

/** The route that renders the same list in the given layout, or `null` when the route already matches. */
export function forumListTarget(route: ForumListRouteInput, compact: boolean, options: ForumListOptions = {}): ForumListTarget | null {
  const name = String(route.name ?? "");
  if (!FORUM_LIST_LAYOUT_ROUTES.has(name)) return null;
  const query = route.query || {};

  if (compact) {
    if (name === "forum-hot") return { name: "forum", query: { ...query, channel: "hot" } };
    if (name === "forum-latest") return { name: "forum", query: withoutChannel(query) };
    if (name === "market") return { name: "forum", query: { ...query, channel: "market" } };
    return null;
  }

  if (name !== "forum") return null;
  const channel = channelOf(query);
  if (channel === undefined) return null;
  const rest = withoutChannel(query);
  if (channel === "hot") return { name: "forum-hot", query: rest };
  if (channel === "latest") return { name: "forum-latest", query: rest };
  if (channel === "market") return options.marketEnabled === false ? { name: "forum", query: rest } : { name: "market", query: rest };
  const slug = CHANNEL_BOARD_SLUGS[channel];
  if (slug) return { name: "board", params: { slug }, query: rest };
  // Unknown channels would otherwise stay in the URL of the desktop hub, which ignores them.
  return { name: "forum", query: rest };
}

/**
 * Like forumListTarget, plus the rule that only applies when the layout itself flips to expanded:
 * the phone forum without a channel shows 最新, so it continues as the desktop 最新 page rather than the hub.
 */
export function forumListFlipTarget(route: ForumListRouteInput, compact: boolean, options: ForumListOptions = {}): ForumListTarget | null {
  const target = forumListTarget(route, compact, options);
  if (target || compact) return target;
  if (String(route.name ?? "") === "forum" && channelOf(route.query || {}) === undefined) {
    return { name: "forum-latest", query: { ...(route.query || {}) } };
  }
  return null;
}

/**
 * Keeps the URL in step with the rendered forum variant when the layout changes without a navigation
 * (rotation, Split View, Stage Manager). Navigations in flight are left alone; their route guard sees
 * the new layout, and the current route is checked again once they settle.
 *
 * Install it before the app's own async beforeEach, so a navigation counts as pending while that guard waits.
 */
export function installForumListLayoutSync(router: Router, readOptions: () => ForumListOptions = () => ({})) {
  let pendingTarget: unknown = null;
  let changedWhilePending = false;
  // The layout the current /forum entry was opened in. Only the phone forum without a channel shows 最新;
  // a desktop hub that passes through the compact layout and back stays the hub.
  let forumEnteredCompact = false;

  const sync = (route: RouteLocationNormalizedLoaded, compact: boolean, flipped: boolean) => {
    const options = readOptions();
    const target = flipped && forumEnteredCompact
      ? forumListFlipTarget(route, compact, options)
      : forumListTarget(route, compact, options);
    if (target) void router.replace(target).catch(() => undefined);
  };

  const settle = (failed: boolean) => {
    pendingTarget = null;
    const flipped = changedWhilePending;
    changedWhilePending = false;
    const route = router.currentRoute.value;
    const compact = getFormFactor().compact;
    if (!failed) forumEnteredCompact = route.name === "forum" && compact;
    // Query-only changes reuse the route record, so beforeEnter does not see them.
    if (!failed || flipped) sync(route, compact, flipped);
  };

  const removeBefore = router.beforeEach((to) => {
    pendingTarget = to;
  });
  const removeAfter = router.afterEach((_to, _from, failure) => {
    // Only a cancelled navigation has a newer one in flight. Any other outcome settles, including a guard
    // redirect onto the current URL, whose afterEach reports a location beforeEach never saw.
    if (isNavigationFailure(failure, NavigationFailureType.cancelled)) return;
    settle(Boolean(failure));
  });
  const removeError = router.onError(() => {
    settle(true);
  });
  const unsubscribe = subscribeFormFactor((next, previous) => {
    if (next.compact === previous.compact) return;
    if (pendingTarget) {
      changedWhilePending = true;
      return;
    }
    sync(router.currentRoute.value, next.compact, true);
  });

  return () => {
    removeBefore();
    removeAfter();
    removeError();
    unsubscribe();
  };
}
