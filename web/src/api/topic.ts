import axios from "axios";
import { request, type RequestOptions } from "./request";

export interface Topic {
  id: number;
  boardId: number;
  authorId: number;
  title: string;
  content: string;
  metadata: Record<string, any>;
  isAnonymous?: boolean;
  anonymousAlias?: string | null;
  pinned: boolean;
  globalPinned?: boolean;
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
  author?: { id: number | null; nickname: string; username?: string; avatar?: string | null; role: string; bio?: string; status?: string; mutedUntil?: string | null; anonymous?: boolean };
  realAuthor?: { id: number; nickname: string; username?: string; avatar?: string | null; role: string; bio?: string; status?: string; mutedUntil?: string | null; reputation?: number; reputationLevel?: { level: number; name: string; minReputation: number } };
  board?: { id?: number; slug: string; name: string; color?: string; icon?: string; type?: string; readOnly?: boolean; anonymousEnabled?: boolean };
  imageReview?: {
    enabled: boolean;
    totalCount: number;
    pendingCount: number;
    rejectedCount: number;
    approvedCount: number;
  };
  videoReview?: {
    enabled: boolean;
    totalCount: number;
    pendingCount: number;
    rejectedCount: number;
    approvedCount: number;
    manualReviewCount: number;
  };
}

export interface Reply {
  id: number;
  topicId: number;
  authorId: number | null;
  content: string;
  isAnonymous?: boolean;
  anonymousAlias?: string | null;
  parentReplyId?: number | null;
  floor: number;
  likeCount: number;
  createdAt: string;
  author?: { id: number | null; nickname: string; username?: string; avatar?: string | null; role: string; status?: string; mutedUntil?: string | null; anonymous?: boolean };
  realAuthor?: { id: number; nickname: string; username?: string; avatar?: string | null; role: string; status?: string; mutedUntil?: string | null; reputation?: number; reputationLevel?: { level: number; name: string; minReputation: number } };
  imageReview?: {
    enabled: boolean;
    totalCount: number;
    pendingCount: number;
    rejectedCount: number;
    approvedCount: number;
  };
  videoReview?: {
    enabled: boolean;
    totalCount: number;
    pendingCount: number;
    rejectedCount: number;
    approvedCount: number;
    manualReviewCount: number;
  };
}

export type ImageReviewSummary = {
  enabled: boolean;
  totalCount: number;
  pendingCount: number;
  rejectedCount: number;
  approvedCount: number;
};

export type VideoReviewSummary = {
  enabled: boolean;
  totalCount: number;
  pendingCount: number;
  rejectedCount: number;
  approvedCount: number;
  manualReviewCount: number;
};

export type TopicAutoFormatResult = {
  content: string;
  provider: "ai" | "fallback";
  model: string | null;
  summary: string;
};

export const topicApi = {
  list: (params: { board?: string; page?: number; size?: number; sort?: "new" | "hot"; pinned?: "only" | "exclude" }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: Topic[] }>("/topics", params, options),
  detail: (id: number, options?: RequestOptions) => request.get<Topic>(`/topics/${id}`, undefined, options),
  replies: (id: number, options?: RequestOptions) => request.get<Reply[]>(`/topics/${id}/replies`, undefined, options),
  create: (payload: { boardSlug: string; title: string; content: string; metadata?: any; tags?: string[]; anonymous?: boolean }) =>
    request.post<Topic & { submissionResult?: { status: string; riskLevel?: string; riskScore?: number; reason?: string; imageReview?: ImageReviewSummary | null; videoReview?: VideoReviewSummary | null } }>("/topics", payload),
  update: (id: number, payload: Partial<Topic>) =>
    request.patch<Topic & { submissionResult?: { status: string; riskLevel?: string; riskScore?: number; reason?: string; imageReview?: ImageReviewSummary | null; videoReview?: VideoReviewSummary | null } }>(`/topics/${id}`, payload),
  autoFormat: (payload: { title?: string; content: string; boardSlug?: string; editorMode?: "visual" | "markup" }) =>
    request.post<TopicAutoFormatResult>("/topics/format", payload, { timeout: 60000 }),
  remove: (id: number) => request.delete<any>(`/topics/${id}`),
  requestManualReview: (id: number) => request.post<{ ok: true }>(`/topics/${id}/request-manual-review`),
};

export const replyApi = {
  create: (payload: { topicId: number; content: string; parentReplyId?: number; anonymous?: boolean }) =>
    request.post<Reply & { blocked?: boolean; submissionResult?: { status: string; riskLevel?: string; riskScore?: number; reason?: string }; imageReview?: ImageReviewSummary | null; videoReview?: VideoReviewSummary | null }>("/replies", payload),
  update: (id: number, payload: { content: string }) =>
    request.patch<Reply & { imageReview?: ImageReviewSummary | null; videoReview?: VideoReviewSummary | null }>(`/replies/${id}`, payload),
  remove: (id: number) => request.delete<any>(`/replies/${id}`),
  requestManualReview: (id: number) => request.post<{ ok: true }>(`/replies/${id}/request-manual-review`),
};

export const likeApi = {
  toggleTopic: (id: number) => request.post<{ liked: boolean; likeCount: number }>(`/likes/topic/${id}`),
  toggleReply: (id: number) => request.post<{ liked: boolean; likeCount: number }>(`/likes/reply/${id}`),
  mine: (topicIds: number[], replyIds: number[] = [], options?: RequestOptions) =>
    request.get<{ topics: number[]; replies: number[] }>("/likes/mine", {
      topics: topicIds.join(","), replies: replyIds.join(","),
    }, options),
};

export const uploadApi = {
  image: (image: string) => request.post<{ url: string }>("/uploads/images", { image }),
  media: async (
    file: Blob,
    fileName: string,
    options?: {
      forceProxy?: boolean;
      onProgress?: (state: {
        stage: "preparing" | "uploading" | "processing";
        loaded: number;
        total: number;
        percent: number;
      }) => void;
    },
  ) => {
    const reportProgress = (
      stage: "preparing" | "uploading" | "processing",
      loaded: number,
      total: number,
    ) => {
      const safeTotal = Math.max(0, Number(total) || 0);
      const safeLoaded = Math.max(0, Math.min(Number(loaded) || 0, safeTotal || Number(loaded) || 0));
      const percent = safeTotal > 0 ? Math.max(0, Math.min(100, Math.round((safeLoaded / safeTotal) * 100))) : 0;
      options?.onProgress?.({
        stage,
        loaded: safeLoaded,
        total: safeTotal,
        percent,
      });
    };

    const shouldForceProxy = options?.forceProxy === true;
    if (!shouldForceProxy) {
      const init = await request.post<{
        mode: "direct" | "proxy";
        kind: "image" | "video";
        url?: string;
        uploadUrl?: string;
        uploadToken?: string;
        expiresAt?: string;
        mimeType?: string;
      }>("/uploads/media/init", {
        fileName,
        mimeType: file.type || "",
        fileSize: file.size,
      }, { timeout: 30000 });

      if (init.mode === "direct" && init.uploadUrl && init.uploadToken) {
        await uploadFileToOneDriveSession(init.uploadUrl, file, file.type || init.mimeType || "application/octet-stream", reportProgress);
        reportProgress("processing", file.size, file.size);
        return request.post<{
          kind: "image" | "video";
          url: string;
          posterUrl?: string;
          mimeType?: string;
        }>("/uploads/media/complete", {
          uploadToken: init.uploadToken,
        }, { timeout: 180000 });
      }
    }

    const formData = new FormData();
    formData.append("file", file, fileName);
    return request.post<{
      kind: "image" | "video";
      url: string;
      posterUrl?: string;
      mimeType?: string;
    }>("/uploads/media", formData, {
      timeout: 180000,
      onUploadProgress: (event) => {
        const total = Number(event.total || file.size || 0);
        const loaded = Math.min(Number(event.loaded || 0), total || Number(event.loaded || 0));
        reportProgress(loaded >= total && total > 0 ? "processing" : "uploading", loaded, total);
      },
    });
  },
};

const ONEDRIVE_UPLOAD_CHUNK_BYTES = 32 * 320 * 1024;

async function uploadFileToOneDriveSession(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  reportProgress: (stage: "preparing" | "uploading" | "processing", loaded: number, total: number) => void,
) {
  const total = file.size;
  let uploaded = 0;
  reportProgress("uploading", 0, total);
  while (uploaded < total) {
    const end = Math.min(uploaded + ONEDRIVE_UPLOAD_CHUNK_BYTES, total);
    const chunk = file.slice(uploaded, end);
    await axios.put(uploadUrl, chunk, {
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Range": `bytes ${uploaded}-${end - 1}/${total}`,
      },
      timeout: 180000,
      onUploadProgress: (event) => {
        const currentLoaded = uploaded + Math.min(Number(event.loaded || 0), chunk.size);
        reportProgress("uploading", currentLoaded, total);
      },
    });
    uploaded = end;
    reportProgress("uploading", uploaded, total);
  }
}
