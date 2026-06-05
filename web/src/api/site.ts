import { request } from "./request";

export type FeatureKey = "forum" | "market" | "coursereview" | "electric" | "sponsor";
export type FeatureMap = Record<FeatureKey, boolean>;
export type PublicSiteConfig = {
  siteOrigin: string;
  siteFilingNumber: string;
};

export const siteApi = {
  features: () => request.get<FeatureMap>("/site/features"),
  config: () => request.get<PublicSiteConfig>("/site/config"),
};
