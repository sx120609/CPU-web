import { request } from "./request";

export interface HomeSummary {
  identity: any;
  pinnedTopics: any[];
  hotTopics: any[];
  latestTopics: any[];
  announce: any[];
  services: any[];
}

export const homeApi = {
  summary: () => request.get<HomeSummary>("/home/summary"),
  hotRanking: () => request.get<any[]>("/home/hot-ranking"),
  latestFeed: (params?: { page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; pins: any[]; list: any[] }>("/home/latest-feed", params),
};
