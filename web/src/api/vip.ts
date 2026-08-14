import { request, type RequestOptions } from "./request";

export type VipBenefit = {
  key: string;
  title: string;
  description: string;
};

export type VipStatus = {
  vipLevel: number;
  vipExpiresAt: string | null;
  vipActive: boolean;
  sponsorTotalCents: number;
  benefits: VipBenefit[];
};

export type VipRedemption = {
  id: number;
  vipLevel: number;
  durationDays: number;
  expiresAt: string | null;
  redeemedAt: string;
  giftCode: { codePreview: string };
};

export const vipApi = {
  status: (options?: RequestOptions) => request.get<VipStatus>("/vip", undefined, options),
  redeem: (code: string) => request.post<{
    codePreview: string;
    vipLevel: number;
    vipExpiresAt: string;
    durationDays: number;
  }>("/vip/redeem", { code }),
  history: (options?: RequestOptions) => request.get<VipRedemption[]>("/vip/history", undefined, options),
};
