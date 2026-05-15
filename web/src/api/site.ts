import { request } from "./request";

export type FeatureKey = "forum" | "market" | "coursereview";
export type FeatureMap = Record<FeatureKey, boolean>;

export const siteApi = {
  features: () => request.get<FeatureMap>("/site/features"),
};
