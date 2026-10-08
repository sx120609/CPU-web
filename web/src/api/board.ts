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
  /** 融合门户里的发布部门名；只有门户同步的公告板块有。 */
  feedDepartment?: string | null;
  /** 用户没选过部门时，公告页“全部”里是否默认包含。 */
  announceDefault?: boolean;
  feedSource?: { name: string; homepage: string; lastRunAt?: string; enabled: boolean };
}

export const boardApi = {
  list: (options?: RequestOptions) => request.get<Board[]>("/boards", undefined, options),
  detail: (slug: string, options?: RequestOptions) => request.get<Board>(`/boards/${slug}`, undefined, options),
};
