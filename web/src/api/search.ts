import { request, type RequestOptions } from "./request";

export interface SearchResult {
  topics: any[];
  courses: any[];
  services: any[];
}

export interface CampusAssistantAction {
  id: string;
  label: string;
  description: string;
  url: string;
  icon: string;
  owner: string;
  requireLogin: boolean;
}

export interface CampusAssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CampusAssistantResponse {
  answer: string;
  actions: CampusAssistantAction[];
  suggestions: string[];
  fallback: boolean;
}

export const searchApi = {
  search: (q: string, options?: RequestOptions) => request.get<SearchResult>("/search", { q }, options),
  askAssistant: (message: string, history: CampusAssistantMessage[], options?: RequestOptions) =>
    request.post<CampusAssistantResponse>("/search/assistant", { message, history }, options),
};
