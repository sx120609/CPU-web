import { request, type RequestOptions } from "./request";
import type { EpaySubmit, PayType } from "./payments";

export type MarketCategory = string;
export type MarketCondition = "new" | "like_new" | "good" | "fair" | "wanted";
export type MarketTradeMode = "meetup" | "shipping" | "both" | "online";
export type MarketListingType = "sell" | "wanted";

export interface MarketCategoryOption {
  id: number;
  slug: string;
  name: string;
  icon: string;
  description: string;
  fulfillmentType: "physical" | "digital";
  imageRequired: boolean;
  enabled: boolean;
  sort: number;
  itemCount?: number;
}

export interface MarketUser {
  id: number;
  username?: string;
  nickname: string;
  avatar?: string | null;
  role: string;
  studentSso?: boolean;
  createdAt?: string;
}

export interface MarketItem {
  id: number;
  topicId?: number | null;
  sellerId: number;
  listingType: MarketListingType;
  title: string;
  description: string;
  category: MarketCategory;
  deliveryType: "physical" | "digital";
  hasDigitalDelivery: boolean;
  price: string;
  priceCents: number;
  originalPrice?: string | null;
  originalPriceCents?: number | null;
  negotiable: boolean;
  condition: MarketCondition;
  tradeMode: MarketTradeMode;
  campus: string;
  location: string;
  status: string;
  viewCount: number;
  favoriteCount: number;
  offerCount: number;
  images: Array<{ id: number; url: string; sort: number }>;
  cover: string;
  seller: MarketUser;
  topic?: { id: number; replyCount: number; likeCount: number; hidden: boolean; aiReviewStatus: string } | null;
  favorited: boolean;
  mine: boolean;
  sellerRating?: number;
  sellerReviewCount?: number;
  soldAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketOrder {
  id: number;
  itemId: number;
  offerId: number;
  buyerId: number;
  sellerId: number;
  outTradeNo: string;
  payType: string;
  amount: string;
  amountCents: number;
  platformFee: string;
  sellerAmount: string;
  status: string;
  expiresAt?: string | null;
  paidAt?: string | null;
  completedAt?: string | null;
  refundedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  meetupTime?: string | null;
  meetupLocation?: string;
  buyerConfirmedAt?: string | null;
  sellerConfirmedAt?: string | null;
  deliveryType: "physical" | "digital";
  digitalDelivery?: string | null;
  digitalDeliveredAt?: string | null;
  item?: MarketItem;
  buyer?: MarketUser;
  seller?: MarketUser;
  refunds?: any[];
  reviews?: any[];
  settlement?: any;
  conversation?: { id: number } | null;
}

export interface MarketSellerDashboard {
  config: { commissionBps: number; commissionRate: number; updatedAt: string };
  stats: {
    activeListings: number;
    reservedListings: number;
    soldListings: number;
    pendingDeliveryOrders: number;
    pendingSettlementOrders: number;
  };
  balance: {
    grossCents: number;
    commissionCents: number;
    pendingCents: number;
    frozenCents: number;
    availableCents: number;
    settledCents: number;
  };
  items: MarketItem[];
  orders: MarketOrder[];
  settlements: any[];
  timeline: Array<{
    key: string;
    orderId: number;
    type: "payment" | "settlement" | "refunded";
    title: string;
    amount: string;
    amountCents: number;
    platformFee: string;
    platformFeeCents: number;
    status: string;
    occurredAt: string;
    reference?: string;
  }>;
  payoutProfile?: any;
}

export interface MarketConversation {
  id: number;
  itemId: number;
  orderId?: number | null;
  buyerId: number;
  sellerId: number;
  item: MarketItem;
  buyer: MarketUser;
  seller: MarketUser;
  counterpart: MarketUser;
  order?: MarketOrder | null;
  lastMessage?: MarketMessage | null;
  lastMessageAt?: string | null;
}

export interface MarketMessage {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  readAt?: string | null;
  createdAt: string;
  sender?: MarketUser;
}

export interface MarketItemInput {
  listingType: MarketListingType;
  title: string;
  description: string;
  category: MarketCategory;
  price: string | number;
  originalPrice?: string | number | null;
  negotiable?: boolean;
  condition: MarketCondition;
  tradeMode: MarketTradeMode;
  campus?: string;
  location?: string;
  images?: string[];
  digitalDelivery?: string;
  draft?: boolean;
  status?: string;
}

export type MarketListParams = {
  page?: number;
  size?: number;
  q?: string;
  category?: string;
  listingType?: string;
  condition?: string;
  tradeMode?: string;
  campus?: string;
  minPrice?: number | string;
  maxPrice?: number | string;
  sort?: "new" | "price_asc" | "price_desc" | "popular";
  status?: string;
};

export const marketApi = {
  meta: (options?: RequestOptions) => request.get<{ categories: MarketCategoryOption[]; conditions: string[]; tradeModes: string[]; listingTypes: string[]; payTypes: PayType[]; paymentEnabled: boolean; commissionBps: number; commissionRate: number }>("/market/meta", undefined, options),
  items: (params?: MarketListParams, options?: RequestOptions) => request.get<{ page: number; size: number; total: number; list: MarketItem[] }>("/market/items", params, options),
  item: (id: number, options?: RequestOptions) => request.get<MarketItem>(`/market/items/${id}`, undefined, options),
  createItem: (payload: MarketItemInput) => request.post<MarketItem>("/market/items", payload),
  updateItem: (id: number, payload: Partial<MarketItemInput>) => request.patch<MarketItem>(`/market/items/${id}`, payload),
  removeItem: (id: number) => request.delete<{ ok: true }>(`/market/items/${id}`),
  favorite: (id: number) => request.post<{ favorited: boolean; favoriteCount: number }>(`/market/items/${id}/favorite`),
  createOffer: (id: number, payload: { price: string | number; message?: string }) => request.post<any>(`/market/items/${id}/offers`, payload),
  updateOffer: (id: number, action: "accept" | "reject" | "cancel") => request.patch<any>(`/market/offers/${id}`, { action }),
  payOrder: (id: number, payType: PayType) => request.post<{ order: MarketOrder; epay: EpaySubmit }>(`/market/orders/${id}/pay`, { payType }),
  updateOrder: (id: number, payload: { action: string; meetupTime?: string; meetupLocation?: string; note?: string; reason?: string }) => request.patch<any>(`/market/orders/${id}`, payload),
  reviewOrder: (id: number, payload: { rating: number; content?: string }) => request.post<any>(`/market/orders/${id}/reviews`, payload),
  createConversation: (itemId: number, message = "") => request.post<MarketConversation>(`/market/items/${itemId}/conversations`, { message }),
  conversations: (options?: RequestOptions) => request.get<MarketConversation[]>("/market/conversations", undefined, options),
  messages: (id: number, options?: RequestOptions) => request.get<MarketMessage[]>(`/market/conversations/${id}/messages`, undefined, options),
  sendMessage: (id: number, content: string) => request.post<MarketMessage>(`/market/conversations/${id}/messages`, { content }),
  mine: (options?: RequestOptions) => request.get<{ selling: MarketItem[]; favorites: MarketItem[]; offers: any[]; sellerOffers: any[]; orders: MarketOrder[]; conversationCount: number; payoutProfile?: any }>("/market/mine", undefined, options),
  sellerDashboard: (options?: RequestOptions) => request.get<MarketSellerDashboard>("/market/seller/dashboard", undefined, options),
  reviews: (userId: number, options?: RequestOptions) => request.get<{ list: any[]; average: number; total: number }>(`/market/users/${userId}/reviews`, undefined, options),
  report: (itemId: number, payload: { reason: string; detail?: string }) => request.post<any>(`/market/items/${itemId}/reports`, payload),
  savePayoutProfile: (payload: { method: "alipay" | "wxpay" | "bank"; account: string; realName: string }) => request.patch<any>("/market/payout-profile", payload),
  adminOverview: (options?: RequestOptions) => request.get<any>("/market/admin/overview", undefined, options),
  adminConfig: (options?: RequestOptions) => request.get<{ commissionBps: number; commissionRate: number; updatedAt: string }>("/market/admin/config", undefined, options),
  adminUpdateConfig: (commissionRate: number) => request.patch<{ commissionBps: number; commissionRate: number; updatedAt: string }>("/market/admin/config", { commissionRate }),
  adminCategories: (options?: RequestOptions) => request.get<MarketCategoryOption[]>("/market/admin/categories", undefined, options),
  adminCreateCategory: (payload: Omit<MarketCategoryOption, "id" | "itemCount">) => request.post<MarketCategoryOption>("/market/admin/categories", payload),
  adminUpdateCategory: (id: number, payload: Partial<Omit<MarketCategoryOption, "id" | "slug" | "itemCount">>) => request.patch<MarketCategoryOption>(`/market/admin/categories/${id}`, payload),
  adminDeleteCategory: (id: number) => request.delete<{ ok: true }>(`/market/admin/categories/${id}`),
  adminUpdateItem: (id: number, payload: { status: string; note?: string }) => request.patch<any>(`/market/admin/items/${id}`, payload),
  adminHandleReport: (id: number, payload: { status: "resolved" | "rejected"; note?: string; hideItem?: boolean }) => request.patch<any>(`/market/admin/reports/${id}`, payload),
  adminHandleRefund: (id: number, payload: { status: "approved" | "completed" | "rejected" | "failed"; providerRefundNo?: string; note?: string }) => request.patch<any>(`/market/admin/refunds/${id}`, payload),
  adminHandleSettlement: (id: number, payload: { status: "available" | "held" | "settled"; reference?: string; note?: string }) => request.patch<any>(`/market/admin/settlements/${id}`, payload),
  adminPayoutProfile: (id: number) => request.get<any>(`/market/admin/settlements/${id}/payout-profile`),
};

export function submitMarketEpay(result: { epay: EpaySubmit }) {
  const form = document.createElement("form");
  form.method = result.epay.method;
  form.action = result.epay.submitUrl;
  form.style.display = "none";
  for (const [key, value] of Object.entries(result.epay.params)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
