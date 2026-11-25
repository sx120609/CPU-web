import { request, type RequestOptions } from "./request";
import { isForumDestination } from "@/utils/nativeForumVisibility";

export interface HomeSummary {
  identity: any;
  pinnedTopics: any[];
  hotTopics: any[];
  latestTopics: any[];
  announce: any[];
  services: any[];
}

export type HomeFeedStream = "all" | "forum" | "market" | "lost-found";

function filterHomeStreamTopics<T extends { board?: { slug?: string; type?: string } }>(items: T[], stream?: HomeFeedStream) {
  if (!stream || stream === "all") return items;
  if (stream === "market") return items.filter((item) => item.board?.type === "market");
  if (stream === "lost-found") return items.filter((item) => item.board?.slug === "lost-found");
  return items.filter((item) => item.board?.type !== "market" && item.board?.type !== "announce" && item.board?.slug !== "lost-found");
}

export const homeApi = {
  summary: async (options?: RequestOptions, servicesOnly = false): Promise<HomeSummary> => {
    if (!servicesOnly) return request.get<HomeSummary>("/home/summary", undefined, options);
    const services = await request.get<any[]>("/services", undefined, options);
    return { identity: null, pinnedTopics: [], hotTopics: [], latestTopics: [], announce: [],
      services: services.filter((service) => !isForumDestination(String(service?.url || ""))) };
  },
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
