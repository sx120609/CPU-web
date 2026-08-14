import { request, type RequestOptions } from "./request";

export type ForumAdPlacement = "forum-index-top" | "forum-home-pinned" | "forum-home-hot" | "forum-feed-inline" | "forum-board-top";

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

export const forumAdsApi = {
  list: (placement: ForumAdPlacement, options?: RequestOptions) =>
    request.get<ForumAd[]>("/forum-ads", { placement }, { cacheTtlMs: 60_000, suppressErrorMessage: true, ...options }),
};
