import { request, type RequestOptions } from "./request";

export interface SearchResult {
  topics: any[];
  courses: any[];
  services: any[];
}

export const searchApi = {
  search: (q: string, options?: RequestOptions) => request.get<SearchResult>("/search", { q }, options),
};
