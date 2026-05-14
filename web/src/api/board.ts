import { request } from "./request";

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
  topicCount: number;
  feedSource?: { name: string; homepage: string; lastRunAt?: string; enabled: boolean };
}

export const boardApi = {
  list: () => request.get<Board[]>("/boards"),
  detail: (slug: string) => request.get<Board>(`/boards/${slug}`),
};
