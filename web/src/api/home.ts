import { request } from "./request";

export interface HomeSummary {
  identity: any;
  hotTopics: any[];
  latestTopics: any[];
  announce: any[];
  services: any[];
}

export const homeApi = {
  summary: () => request.get<HomeSummary>("/home/summary"),
};
