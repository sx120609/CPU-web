import { request, type RequestOptions } from "./request";

export type VipBenefit = {
  key: string;
  title: string;
  description: string;
};

export type VipStatus = {
  vipActive: boolean;
  sponsorTotalCents: number;
  benefits: VipBenefit[];
};

export type VipRedemption = {
  id: number;
  redeemedAt: string;
  giftCode: { codePreview: string };
};

export const vipApi = {
  status: (options?: RequestOptions) => request.get<VipStatus>("/vip", undefined, options),
  redeem: (code: string) => request.post<{
    codePreview: string;
    vipActive: true;
    permanent: true;
  }>("/vip/redeem", { code }),
  history: (options?: RequestOptions) => request.get<VipRedemption[]>("/vip/history", undefined, options),
};
