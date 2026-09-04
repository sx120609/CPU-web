import { request, type RequestOptions } from "./request";

export type AccountVerificationType = "campus_organization";

export type AccountVerificationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "revoked"
  | "superseded";

export interface AccountVerification {
  type: AccountVerificationType;
  typeLabel: string;
  label: string;
  verifiedAt: string;
  expiresAt?: string | null;
}

export interface AccountVerificationApplication {
  id: number;
  userId: number;
  type: AccountVerificationType;
  requestedLabel: string;
  identityDescription: string;
  evidence: string;
  contact: string;
  status: AccountVerificationStatus;
  approvedLabel?: string | null;
  reviewNote: string;
  reviewedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  reviewer?: { id: number; nickname: string };
  user?: {
    id: number;
    username: string;
    nickname: string;
    avatar?: string | null;
    college?: string | null;
    enrollYear?: number | null;
    studentSso: boolean;
    role: string;
    currentVerification?: AccountVerification | null;
  };
}

export interface AccountVerificationMe {
  verification: AccountVerification | null;
  applications: AccountVerificationApplication[];
  submission: {
    limit: number;
    used: number;
    remaining: number;
    hasPending: boolean;
  };
}

export const accountVerificationApi = {
  me: (options?: RequestOptions) =>
    request.get<AccountVerificationMe>("/account-verification/me", undefined, options),
  apply: (payload: {
    type: AccountVerificationType;
    requestedLabel: string;
    identityDescription: string;
    evidence: string;
    contact?: string;
    acknowledged: true;
  }) => request.post<AccountVerificationApplication>("/account-verification/applications", payload),
  remove: () => request.post<{ ok: true }>("/account-verification/remove", { confirmation: "REMOVE_VERIFICATION" }),
  adminList: (
    params: { status?: AccountVerificationStatus | "all"; q?: string; page?: number; size?: number },
    options?: RequestOptions,
  ) => request.get<{
    page: number;
    size: number;
    total: number;
    pending: number;
    list: AccountVerificationApplication[];
  }>("/admin/account-verifications", params, options),
  review: (id: number, payload:
    | { action: "approve"; approvedLabel?: string; reviewNote?: string; expiresAt?: string | null }
    | { action: "reject"; reviewNote: string }) =>
    request.patch<{ id: number; status: AccountVerificationStatus; approvedLabel?: string; expiresAt?: string | null }>(
      `/admin/account-verifications/${id}/review`,
      payload,
    ),
  revoke: (id: number, reason: string) => request.post<{ id: number; status: AccountVerificationStatus }>(
    `/admin/account-verifications/${id}/revoke`,
    { reason, confirmation: "REVOKE_VERIFICATION" },
  ),
};
