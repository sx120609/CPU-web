import { request, type RequestOptions } from "./request";

export interface HomeSummary {
  identity: any;
  pinnedTopics: any[];
  hotTopics: any[];
  latestTopics: any[];
  announce: any[];
  services: any[];
}

export const homeApi = {
  summary: (options?: RequestOptions) => request.get<HomeSummary>("/home/summary", undefined, options),
  hotRanking: (options?: RequestOptions) => request.get<any[]>("/home/hot-ranking", undefined, options),
  latestFeed: (params?: { page?: number; size?: number }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; pins: any[]; list: any[] }>("/home/latest-feed", params, options),
};
