import { request, type RequestOptions } from "./request";

export interface HomeSummary {
  identity: any;
  pinnedTopics: any[];
  hotTopics: any[];
  latestTopics: any[];
  announce: any[];
  services: any[];
}

export type HomeFeedStream = "all" | "forum" | "market";

function filterHomeStreamTopics<T extends { board?: { type?: string } }>(items: T[], stream?: HomeFeedStream) {
  if (!stream || stream === "all") return items;
  if (stream === "market") return items.filter((item) => item.board?.type === "market");
  return items.filter((item) => item.board?.type !== "market" && item.board?.type !== "announce");
}

export const homeApi = {
  summary: (options?: RequestOptions) => request.get<HomeSummary>("/home/summary", undefined, options),
  hotRanking: async (params?: { stream?: HomeFeedStream }, options?: RequestOptions) => {
    const list = await request.get<any[]>("/home/hot-ranking", params, options);
    return filterHomeStreamTopics(list, params?.stream);
  },
  latestFeed: async (params?: { page?: number; size?: number; stream?: HomeFeedStream }, options?: RequestOptions) => {
    const result = await request.get<{ page: number; size: number; total: number; pins: any[]; list: any[] }>("/home/latest-feed", params, options);
    return {
      ...result,
      pins: filterHomeStreamTopics(result.pins, params?.stream),
      list: filterHomeStreamTopics(result.list, params?.stream),
    };
  },
};
