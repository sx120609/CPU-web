import { request, type RequestOptions } from "./request";

export type LostFoundKind = "found" | "lost";
export type LostFoundStatus = "reviewing" | "active" | "claimed" | "closed" | "hidden";
export type LostFoundClaimStatus = "pending" | "accepted" | "rejected" | "withdrawn";

export type LostFoundImage = { id: number; url: string; sort: number };
export type LostFoundUser = { id: number; nickname: string; avatar?: string | null; role: string; studentSso: boolean };

export type LostFoundClaim = {
  id: number;
  itemId: number;
  claimantId: number;
  message: string;
  evidence: string;
  contact: string;
  status: LostFoundClaimStatus;
  claimant?: LostFoundUser;
  item?: LostFoundItem;
  createdAt: string;
  updatedAt: string;
};

export type LostFoundItem = {
  id: number;
  topicId: number;
  publisherId: number;
  kind: LostFoundKind;
  itemName: string;
  description: string;
  campus: string;
  location: string;
  happenedAt: string;
  status: LostFoundStatus;
  pinned: boolean;
  claimedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  images: LostFoundImage[];
  cover: string;
  publisher: LostFoundUser;
  topic: { id: number; hidden: boolean; pinned: boolean; locked: boolean; replyCount: number; likeCount: number; aiReviewStatus: string };
  claimCount: number;
  mine: boolean;
  contact?: string;
  claims?: LostFoundClaim[];
  myClaim?: LostFoundClaim | null;
};

export type LostFoundInput = {
  kind: LostFoundKind;
  itemName: string;
  description: string;
  campus: string;
  location: string;
  happenedAt: string;
  contact: string;
  images: string[];
};

export const lostFoundApi = {
  meta: (options?: RequestOptions) => request.get<{ campuses: string[]; kinds: LostFoundKind[]; statuses: Array<"active" | "claimed"> }>("/lost-found/meta", undefined, options),
  items: (params: { q?: string; kind?: string; campus?: string; location?: string; status?: string; from?: string; to?: string; page?: number; size?: number }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: LostFoundItem[] }>("/lost-found/items", params, options),
  item: (id: number, options?: RequestOptions) => request.get<LostFoundItem>(`/lost-found/items/${id}`, undefined, options),
  create: (payload: LostFoundInput) => request.post<LostFoundItem & { review?: { status: string; reason?: string } | null }>("/lost-found/items", payload),
  updateStatus: (id: number, status: "active" | "claimed" | "closed") => request.patch<LostFoundItem>(`/lost-found/items/${id}/status`, { status }),
  claim: (id: number, payload: { message: string; evidence: string; contact: string }) => request.post<LostFoundClaim>(`/lost-found/items/${id}/claims`, payload),
  updateClaim: (id: number, status: "accepted" | "rejected" | "withdrawn") => request.patch<LostFoundClaim>(`/lost-found/claims/${id}`, { status }),
  mine: (options?: RequestOptions) => request.get<{ published: LostFoundItem[]; claims: LostFoundClaim[] }>("/lost-found/mine", undefined, options),
  adminItems: (params?: { q?: string; status?: string }, options?: RequestOptions) => request.get<LostFoundItem[]>("/lost-found/admin/items", params, options),
  adminUpdate: (id: number, payload: { status?: LostFoundStatus; pinned?: boolean; note?: string }) => request.patch<LostFoundItem>(`/lost-found/admin/items/${id}`, payload),
};
