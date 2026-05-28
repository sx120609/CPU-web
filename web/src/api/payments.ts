import { request } from "./request";

export type PayType = "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";

export type SponsorOptions = {
  enabled: boolean;
  payTypes: PayType[];
  amounts: number[];
  minAmount: string;
  maxAmount: string;
  title: string;
  description: string;
  wallEnabled: boolean;
  allowMessage: boolean;
};

export type EpaySubmit = {
  submitUrl: string;
  method: "POST";
  params: Record<string, string>;
};

export type SponsorOrderResult = {
  order: {
    id: number;
    outTradeNo: string;
    amount: string;
    status: string;
  };
  epay: EpaySubmit;
};

export const paymentsApi = {
  sponsorOptions: () => request.get<SponsorOptions>("/payments/sponsor/options"),
  sponsorWall: () => request.get<{ enabled: boolean; total: number; totalAmount?: string; list: any[] }>("/payments/sponsor/wall"),
  sponsorOrders: (params?: { page?: number; size?: number }) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/payments/sponsor/orders", params),
  createSponsorOrder: (payload: { amount: string | number; payType: PayType }) =>
    request.post<SponsorOrderResult>("/payments/sponsor/orders", payload),
  createSponsorOrderWithOptions: (payload: { amount: string | number; payType: PayType; message?: string; displayMode?: "public" | "anonymous" | "hidden" }) =>
    request.post<SponsorOrderResult>("/payments/sponsor/orders", payload),
  paySponsorOrder: (outTradeNo: string) =>
    request.post<SponsorOrderResult>(`/payments/sponsor/orders/${outTradeNo}/pay`),
  closeSponsorOrder: (outTradeNo: string) =>
    request.post<any>(`/payments/sponsor/orders/${outTradeNo}/close`),
  sponsorOrder: (outTradeNo: string) =>
    request.get<any>(`/payments/sponsor/orders/${outTradeNo}`),
};
