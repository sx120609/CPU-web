import { request } from "./request";

export type PayType = "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";

export type SponsorOptions = {
  enabled: boolean;
  payTypes: PayType[];
  amounts: number[];
  minAmount: string;
  maxAmount: string;
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
  createSponsorOrder: (payload: { amount: string | number; payType: PayType }) =>
    request.post<SponsorOrderResult>("/payments/sponsor/orders", payload),
  sponsorOrder: (outTradeNo: string) =>
    request.get<{ outTradeNo: string; status: string; amount: string; paidAt?: string | null }>(`/payments/sponsor/orders/${outTradeNo}`),
};
