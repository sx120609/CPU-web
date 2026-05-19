import { request } from "./request";

export interface Topic {
  id: number;
  boardId: number;
  authorId: number;
  title: string;
  content: string;
  metadata: Record<string, any>;
  pinned: boolean;
  locked: boolean;
  hidden: boolean;
  viewCount: number;
  replyCount: number;
  likeCount: number;
  lastReplyAt?: string;
  createdAt: string;
  updatedAt: string;
  author?: { id: number; nickname: string; username: string; avatar?: string; role: string; bio?: string };
  board?: { id?: number; slug: string; name: string; color?: string; type?: string; readOnly?: boolean };
}

export interface Reply {
  id: number;
  topicId: number;
  authorId: number;
  content: string;
  parentReplyId?: number | null;
  floor: number;
  likeCount: number;
  createdAt: string;
  author?: { id: number; nickname: string; username: string; avatar?: string; role: string };
}

export const topicApi = {
  list: (params: { board?: string; page?: number; size?: number; sort?: "new" | "hot" }) =>
    request.get<{ page: number; size: number; total: number; list: Topic[] }>("/topics", params),
  detail: (id: number) => request.get<Topic>(`/topics/${id}`),
  replies: (id: number) => request.get<Reply[]>(`/topics/${id}/replies`),
  create: (payload: { boardSlug: string; title: string; content: string; metadata?: any; tags?: string[] }) =>
    request.post<Topic>("/topics", payload),
  update: (id: number, payload: Partial<Topic>) => request.patch<Topic>(`/topics/${id}`, payload),
  remove: (id: number) => request.delete<any>(`/topics/${id}`),
};

export const replyApi = {
  create: (payload: { topicId: number; content: string; parentReplyId?: number }) =>
    request.post<Reply>("/replies", payload),
  remove: (id: number) => request.delete<any>(`/replies/${id}`),
};

export const likeApi = {
  toggleTopic: (id: number) => request.post<{ liked: boolean; likeCount: number }>(`/likes/topic/${id}`),
  toggleReply: (id: number) => request.post<{ liked: boolean; likeCount: number }>(`/likes/reply/${id}`),
  mine: (topicIds: number[], replyIds: number[] = []) =>
    request.get<{ topics: number[]; replies: number[] }>("/likes/mine", {
      topics: topicIds.join(","), replies: replyIds.join(","),
    }),
};

export const uploadApi = {
  image: (image: string) => request.post<{ url: string }>("/uploads/images", { image }),
};
