import { request } from "./request";

export interface SearchResult {
  topics: any[];
  courses: any[];
  services: any[];
}

export const searchApi = {
  search: (q: string) => request.get<SearchResult>("/search", { q }),
};
