import { request, type RequestOptions } from "./request";

export interface Board {
  id: number;
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  order: number;
  type: "normal" | "announce" | "market" | "question" | "coursereview";
  readOnly: boolean;
  anonymousEnabled: boolean;
  topicCount: number;
  feedSource?: { name: string; homepage: string; lastRunAt?: string; enabled: boolean };
}

export const boardApi = {
  list: (options?: RequestOptions) => request.get<Board[]>("/boards", undefined, options),
  detail: (slug: string, options?: RequestOptions) => request.get<Board>(`/boards/${slug}`, undefined, options),
};
