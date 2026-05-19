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
  editCount?: number;
  lastReplyAt?: string;
  aiReviewStatus?: string;
  aiRiskLevel?: string | null;
  aiRiskScore?: number | null;
  aiReviewReason?: string | null;
  aiModel?: string | null;
  tags?: Array<{ id: number; name: string }>;
  createdAt: string;
  updatedAt: string;
  author?: { id: number; nickname: string; username: string; avatar?: string; role: string; bio?: string; status?: string; mutedUntil?: string | null };
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
  author?: { id: number; nickname: string; username: string; avatar?: string; role: string; status?: string; mutedUntil?: string | null };
}

export const topicApi = {
  list: (params: { board?: string; page?: number; size?: number; sort?: "new" | "hot" }) =>
    request.get<{ page: number; size: number; total: number; list: Topic[] }>("/topics", params),
  detail: (id: number) => request.get<Topic>(`/topics/${id}`),
  replies: (id: number) => request.get<Reply[]>(`/topics/${id}/replies`),
  create: (payload: { boardSlug: string; title: string; content: string; metadata?: any; tags?: string[] }) =>
    request.post<Topic & { submissionResult?: { status: string; riskLevel?: string; riskScore?: number; reason?: string } }>("/topics", payload),
  update: (id: number, payload: Partial<Topic>) =>
    request.patch<Topic & { submissionResult?: { status: string; riskLevel?: string; riskScore?: number; reason?: string } }>(`/topics/${id}`, payload),
  remove: (id: number) => request.delete<any>(`/topics/${id}`),
  requestManualReview: (id: number) => request.post<{ ok: true }>(`/topics/${id}/request-manual-review`),
};

export const replyApi = {
  create: (payload: { topicId: number; content: string; parentReplyId?: number }) =>
    request.post<Reply & { blocked?: boolean; submissionResult?: { status: string; riskLevel?: string; riskScore?: number; reason?: string } }>("/replies", payload),
  remove: (id: number) => request.delete<any>(`/replies/${id}`),
  requestManualReview: (id: number) => request.post<{ ok: true }>(`/replies/${id}/request-manual-review`),
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
