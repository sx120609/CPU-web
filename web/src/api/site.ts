import { request } from "./request";

export type FeatureKey = "forum" | "market" | "coursereview" | "electric" | "sponsor";
export type FeatureMap = Record<FeatureKey, boolean>;
export type TopNavigationAudience = "all" | "guest" | "logged-in" | "staff";
export type TopNavigationIcon = "home" | "forum" | "lost-found" | "announcement" | "academic" | "schedule" | "service" | "course" | "market" | "search" | "link";
export type TopNavigationItem = {
  id: string;
  label: string;
  fullLabel: string;
  to: string;
  icon: TopNavigationIcon;
  enabled: boolean;
  primary: boolean;
  showInDrawer: boolean;
  audience: TopNavigationAudience;
  feature: FeatureKey | "";
  requireForumAccess: boolean;
  openInNewTab: boolean;
};
export type PublicSiteConfig = {
  siteOrigin: string;
  siteFilingNumber: string;
};

export const DEFAULT_TOP_NAVIGATION: TopNavigationItem[] = [
  { id: "home", label: "首页", fullLabel: "首页", to: "/home", icon: "home", enabled: true, primary: true, showInDrawer: false, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "forum", label: "论坛", fullLabel: "校园论坛", to: "/forum", icon: "forum", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "forum", requireForumAccess: false, openInNewTab: false },
  { id: "lost-found", label: "失物", fullLabel: "失物招领", to: "/lost-found", icon: "lost-found", enabled: true, primary: false, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "announcements", label: "公告", fullLabel: "校园公告", to: "/announcements", icon: "announcement", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "jwxt", label: "教务", fullLabel: "教务数据", to: "/jwxt", icon: "academic", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "schedule", label: "课表", fullLabel: "课表", to: "/schedule", icon: "schedule", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "services", label: "服务", fullLabel: "校园服务", to: "/services", icon: "service", enabled: true, primary: true, showInDrawer: true, audience: "all", feature: "", requireForumAccess: false, openInNewTab: false },
  { id: "coursereview", label: "课评", fullLabel: "课程点评", to: "/coursereview", icon: "course", enabled: true, primary: false, showInDrawer: true, audience: "all", feature: "coursereview", requireForumAccess: true, openInNewTab: false },
  { id: "market", label: "商城", fullLabel: "校园商城", to: "/market", icon: "market", enabled: true, primary: false, showInDrawer: true, audience: "all", feature: "market", requireForumAccess: true, openInNewTab: false },
];

export const siteApi = {
  features: () => request.get<FeatureMap>("/site/features"),
  config: () => request.get<PublicSiteConfig>("/site/config"),
  navigation: () => request.get<TopNavigationItem[]>("/site/navigation", undefined, { suppressErrorMessage: true }),
};
