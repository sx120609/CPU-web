import { request, type RequestOptions } from "./request";

export type PayType = "alipay" | "wxpay" | "qqpay" | "bank" | "jdpay";

export type SponsorCategory = {
  id: string;
  title: string;
  description: string;
  goalAmount: string | null;
  deadline: string | null;
  enabled: boolean;
  featured: boolean;
  raisedAmount: string;
  raisedAmountCents: number;
  paidOrderCount: number;
  supporterCount: number;
  progressPercent: number | null;
  goalReached: boolean;
  accepting: boolean;
};

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
  assistantPointsPerYuan: number;
  categories: SponsorCategory[];
};

export type SponsorWallItem = {
  id: number;
  amount: string;
  categoryId: string;
  categoryTitle: string;
  message?: string;
  paidAt?: string;
  anonymous: boolean;
  user?: {
    id: number;
    nickname: string;
    avatar?: string | null;
  } | null;
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
    categoryId: string;
    categoryTitle: string;
  };
  epay: EpaySubmit;
  checkoutUrl: string;
  paymentUrl?: string;
};

export function navigateToEpayCheckout(result: { checkoutUrl: string; paymentUrl?: string }) {
  const directPaymentUrl = result.paymentUrl?.trim();
  const target = new URL(directPaymentUrl || result.checkoutUrl, window.location.origin);
  if (directPaymentUrl) {
    if (target.protocol !== "https:") {
      throw new Error("支付平台返回了不可信的收银台地址");
    }
  } else if (target.origin !== window.location.origin || !target.pathname.startsWith("/api/")) {
    throw new Error("支付跳转地址不正确");
  }
  window.location.assign(target.href);
}

export const paymentsApi = {
  sponsorOptions: (options?: RequestOptions) => request.get<SponsorOptions>("/payments/sponsor/options", undefined, options),
  sponsorWall: (options?: RequestOptions) =>
    request.get<{ enabled: boolean; total: number; totalAmount?: string; categories: SponsorCategory[]; list: SponsorWallItem[] }>("/payments/sponsor/wall", undefined, options),
  sponsorOrders: (params?: { page?: number; size?: number; status?: "pending" | "paid" | "closed" }, options?: RequestOptions) =>
    request.get<{ page: number; size: number; total: number; list: any[] }>("/payments/sponsor/orders", params, options),
  createSponsorOrder: (payload: { amount: string | number; payType: PayType }) =>
    request.post<SponsorOrderResult>("/payments/sponsor/orders", payload),
  createSponsorOrderWithOptions: (payload: { amount: string | number; payType: PayType; categoryId: string; message?: string; displayMode?: "public" | "anonymous" | "hidden" }) =>
    request.post<SponsorOrderResult>("/payments/sponsor/orders", payload),
  paySponsorOrder: (outTradeNo: string) =>
    request.post<SponsorOrderResult>(`/payments/sponsor/orders/${outTradeNo}/pay`),
  closeSponsorOrder: (outTradeNo: string) =>
    request.post<any>(`/payments/sponsor/orders/${outTradeNo}/close`),
  sponsorOrder: (outTradeNo: string, options?: RequestOptions) =>
    request.get<any>(`/payments/sponsor/orders/${outTradeNo}`, undefined, options),
};
