import { request } from "./request";

export type FeatureKey = "forum" | "market" | "coursereview" | "electric";
export type FeatureMap = Record<FeatureKey, boolean>;

export const siteApi = {
  features: () => request.get<FeatureMap>("/site/features"),
};
