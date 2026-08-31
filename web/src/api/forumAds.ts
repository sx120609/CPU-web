import { getCsrfToken, request, type RequestOptions } from "./request";

export type ForumAdPlacement = "home-mobile-top" | "compose-mobile-campaign" | "forum-index-top" | "forum-home-pinned" | "forum-home-hot" | "forum-feed-inline" | "forum-board-top";

export type ForumAd = {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  linkUrl: string;
  buttonText: string | null;
  placement: ForumAdPlacement;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
};

export type ForumAdDevice = "mobile" | "desktop";
export type ForumAdEventType = "impression" | "click";

export function currentForumAdDevice(): ForumAdDevice {
  return window.matchMedia?.("(max-width: 768px)").matches || window.innerWidth <= 768 ? "mobile" : "desktop";
}

function trackForumAdEvent(ad: ForumAd, type: ForumAdEventType) {
  const csrf = getCsrfToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return fetch(`/api/forum-ads/${ad.id}/events`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers,
    body: JSON.stringify({ type, placement: ad.placement, device: currentForumAdDevice() }),
  }).catch(() => undefined);
}

export const forumAdsApi = {
  list: (placement: ForumAdPlacement, options?: RequestOptions) =>
    request.get<ForumAd[]>("/forum-ads", { placement }, { cacheTtlMs: 60_000, suppressErrorMessage: true, ...options }),
  track: (ad: ForumAd, type: ForumAdEventType) => trackForumAdEvent(ad, type),
};
