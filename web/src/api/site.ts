import { request } from "./request";

export type FeatureKey = "forum" | "market" | "coursereview" | "electric" | "sponsor" | "forumLoginRequired" | "assistantEntry";
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
  { id: "market", label: "二手", fullLabel: "二手交流", to: "/forum/b/market", icon: "market", enabled: true, primary: false, showInDrawer: true, audience: "all", feature: "market", requireForumAccess: true, openInNewTab: false },
];

export type DesktopDownloadInfo = {
  available: boolean;
  url: string;
  version: string;
  /** 网盘分享页的提取码；直链时为空 */
  password: string;
  fileName?: string;
  size?: number;
  platform?: "windows" | "macos";
};

export type NativeAppUpdateStatus = {
  updateAvailable: boolean;
  latestVersion?: string | null;
  /** The release notes of the version on sale, one change per line. */
  notes?: string[];
  storeUrl?: string;
};

export type IosAppUpdateStatus = NativeAppUpdateStatus & {
  currentVersion?: string | null;
  currentBuild?: string | null;
};

export type HarmonyAppUpdateStatus = NativeAppUpdateStatus & {
  latestVersionCode?: number | null;
  currentVersionCode?: number | null;
};

export type SchoolSummary = {
  id: string;
  name: string;
  shortName: string;
  brandName: string;
  tagline: string;
  ssoLogin: boolean;
  /** 教务系统类型（例如 qiangzhi-jsxsd、zhengfang-v9、shuwei-eams）；没有教务对接时为 null。 */
  academicSystem?: string | null;
  /** 这所学校教务页有哪些视图（服务端 schools/registry.ts 的 ACADEMIC_VIEWS）；旧服务端不给。 */
  academicViews?: string[];
  /** 教务页「前往原站」的入口。 */
  academicPortals?: { undergraduate: string; graduate?: string } | null;
  /** 默认学校（历史数据和访客都归它）。 */
  isDefault?: boolean;
  /** 拾间的手机 App、桌面端是否服务这所学校。 */
  clientApps?: boolean;
  /** 有融合门户（教务登录后能列出校内应用）。 */
  campusPortal?: boolean;
  /** 本校校区（失物、二手发布时的选项）。 */
  campuses?: string[];
  /** 用户交流 QQ 群。 */
  userGroup?: { qq: string; joinUrl: string } | null;
  /** 游客的公开校园入口。 */
  publicLinks?: Array<{ name: string; icon: string; url: string }>;
  /** 服务页顶部的站外推荐入口。 */
  featuredLinks?: Array<{ name: string; summary: string; icon: string; tone: string; url: string; hiddenInStoreApps?: boolean }>;
  /** 这所学校的默认作息（节次从 1 起连续编号）。 */
  periods?: Array<{ no: number; name: string; start: string; end: string }>;
  /** 校庆期内才有：建校年份、校庆日（北京时间 YYYY-MM-DD）、主题口号、校庆主题提供到哪天。 */
  celebration?: SchoolCelebration | null;
};

export type SchoolCelebration = { founded: number; date: string; motto: string; until: string };

/** 当前访问者所属学校：开着哪些功能，以及网页路径、服务卡片各归哪个功能。 */
export type SchoolInfo = SchoolSummary & {
  modules: string[];
  pages: Array<{ prefix: string; module: string }>;
  tools: Array<{ slug: string; module: string }>;
};

export const siteApi = {
  features: () => request.get<FeatureMap>("/site/features"),
  school: () => request.get<SchoolInfo>("/schools/current", undefined, { suppressErrorMessage: true }),
  schools: () => request.get<SchoolSummary[]>("/schools", undefined, { suppressErrorMessage: true }),
  config: () => request.get<PublicSiteConfig>("/site/config"),
  communityStats: () => request.get<{ users: number; topics: number; replies: number }>("/site/community-stats", undefined, { suppressErrorMessage: true }),
  navigation: () => request.get<TopNavigationItem[]>("/site/navigation", undefined, { suppressErrorMessage: true }),
  desktopDownload: () => request.get<DesktopDownloadInfo>("/site/downloads/desktop", undefined, { suppressErrorMessage: true }),
  macDesktopDownload: () => request.get<DesktopDownloadInfo>("/site/downloads/desktop-mac", undefined, { suppressErrorMessage: true }),
  iosAppUpdate: () => request.get<IosAppUpdateStatus>("/app-clients/ios/update", undefined, { suppressErrorMessage: true }),
  harmonyAppUpdate: (versionCode: number) => request.get<HarmonyAppUpdateStatus>("/app-clients/harmony/update", { versionCode }, { suppressErrorMessage: true }),
  assessmentFormDownload: () => request.get<DesktopDownloadInfo>("/site/downloads/assessment-form", undefined, { suppressErrorMessage: true }),
};

/** 桌面端安装包信息。尚未发布时 available 为 false，调用方据此显示"正在打包中"。 */
export async function getDesktopDownload(): Promise<DesktopDownloadInfo> {
  const empty: DesktopDownloadInfo = { available: false, url: "", version: "", password: "" };
  try {
    const info = await siteApi.desktopDownload();
    return info.available ? info : empty;
  } catch {
    return empty;
  }
}

export async function getAssessmentFormDownload(): Promise<DesktopDownloadInfo> {
  const empty: DesktopDownloadInfo = { available: false, url: "", version: "", password: "" };
  try {
    const info = await siteApi.assessmentFormDownload();
    return info.available ? info : empty;
  } catch {
    return empty;
  }
}

/** Apple Silicon（M 系列）macOS 客户端安装包信息。 */
export async function getMacDesktopDownload(): Promise<DesktopDownloadInfo> {
  const empty: DesktopDownloadInfo = { available: false, url: "", version: "", password: "" };
  try {
    const info = await siteApi.macDesktopDownload();
    return info.available ? info : empty;
  } catch {
    return empty;
  }
}
