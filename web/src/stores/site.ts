import { defineStore } from "pinia";
import { DEFAULT_TOP_NAVIGATION, siteApi, type FeatureMap, type PublicSiteConfig, type SchoolInfo, type TopNavigationItem } from "@/api/site";
import { isSchoolPathEnabled, isSchoolToolEnabled } from "@/utils/schoolModules";
import { setDocumentBrand } from "@/utils/documentTitle";
import { useSchoolSlots } from "@/views/schedule/slots";

type CachedBrand = { schoolId?: string; isDefault?: boolean; brandName?: string; schoolName?: string; shortName?: string };

/** 上次访问时记下的学校品牌（同一份也给启动画面 appearance-bootstrap.js 用），学校信息到之前先显示它，免得闪成别的学校。 */
function cachedBrand(): CachedBrand {
  try {
    const value = JSON.parse(window.localStorage.getItem("cpu-school-brand-v1") || "null");
    return value && typeof value === "object" ? value as CachedBrand : {};
  } catch {
    return {};
  }
}

const initialBrand = typeof window === "undefined" ? {} : cachedBrand();

/** 添加到主屏幕时的名字跟着当前学校：iOS 的两个 meta 和安卓读的 manifest（启动脚本在首屏前也做一遍）。 */
function applyInstallBrand(brandName: string, schoolId: string | undefined) {
  if (typeof document === "undefined") return;
  for (const meta of Array.from(document.querySelectorAll('meta[name="apple-mobile-web-app-title"], meta[name="application-name"]'))) {
    meta.setAttribute("content", brandName);
  }
  const manifest = document.querySelector('link[rel="manifest"]');
  if (!manifest || !schoolId) return;
  const url = new URL(manifest.getAttribute("href") || "/manifest-v3.webmanifest", window.location.origin);
  url.searchParams.set("school", schoolId);
  manifest.setAttribute("href", url.pathname + url.search);
}

/**
 * 站点级开关：默认关闭可选功能，拉到后台真实开关后再展示入口。
 * 避免接口返回前短暂露出未开放功能。
 */
export const useSiteStore = defineStore("site", {
  state: () => ({
    features: { forumLoginRequired: true, assistantEntry: false, forum: false, market: false, coursereview: false, electric: false, sponsor: false } as FeatureMap,
    siteOrigin: "",
    siteFilingNumber: "",
    topNavigation: DEFAULT_TOP_NAVIGATION.map((item) => ({ ...item })) as TopNavigationItem[],
    school: null as SchoolInfo | null,
    loaded: false,
    loading: false,
    _pendingFetch: null as Promise<void> | null,
  }),
  getters: {
    /** 拾间品牌下当前学校的名字；学校信息到之前用上次记下的，从没来过时用总品牌「拾间」。 */
    brandName: (state) => state.school?.brandName || initialBrand.brandName || "拾间",
    brandTagline: (state) => state.school?.tagline ?? "",
    schoolName: (state) => state.school?.name || initialBrand.schoolName || "",
    schoolShortName: (state) => state.school?.shortName || initialBrand.shortName || "",
    /** 默认学校：写给它的文字原样显示，其他学校换成本校名字。学校信息到之前按上次记下的学校算。 */
    isDefaultSchool: (state) => (state.school ? Boolean(state.school.isDefault) : initialBrand.isDefault ?? true),
    /** 拾间的手机 App、桌面端是否服务本校（学校档案的 clientApps）；学校信息到之前不露出。 */
    clientAppsAvailable: (state) => Boolean(state.school?.clientApps),
    /** 本校有融合门户（教务登录后列出校内应用）。 */
    campusPortalAvailable: (state) => Boolean(state.school?.campusPortal),
    /** 本校有研究生系统入口：登录提示里才讲本科生 / 研究生两种入口。 */
    hasGraduatePortal: (state) => Boolean(state.school?.academicPortals?.graduate),
    campuses: (state) => state.school?.campuses ?? [],
    userGroupQq: (state) => state.school?.userGroup?.qq ?? "",
    userGroupJoinUrl: (state) => state.school?.userGroup?.joinUrl ?? "",
    publicLinks: (state) => state.school?.publicLinks ?? []
  },
  actions: {
    async fetch(force = false): Promise<void> {
      if (this._pendingFetch) {
        if (!force) return this._pendingFetch;
        // 换学校、登录退出时要的是新结果：等在途的那次结束后再拉一次，不能拿旧学校的结果顶替。
        await this._pendingFetch.catch(() => undefined);
        return this.fetch(true);
      }
      if (this.loaded && !force) return;
      this.loading = true;
      const task = (async () => {
        try {
          const [featureResult, configResult, navigationResult, schoolResult] = await Promise.allSettled([
            siteApi.features(),
            siteApi.config(),
            siteApi.navigation(),
            siteApi.school(),
          ]);
          if (featureResult.status === "fulfilled") {
            this.features = featureResult.value;
          }
          if (schoolResult.status === "fulfilled") {
            this.school = schoolResult.value;
            setDocumentBrand(this.brandName, this.schoolName, this.schoolShortName, this.isDefaultSchool);
            // 下次打开时启动画面先显示这所学校的品牌（public/appearance-bootstrap.js 读取）。
            try {
              window.localStorage.setItem("cpu-school-brand-v1", JSON.stringify({ schoolId: this.school?.id, isDefault: this.isDefaultSchool, brandName: this.brandName, schoolName: this.schoolName, shortName: this.schoolShortName }));
            } catch { /* 无痕模式等存不了就算了 */ }
            if (schoolResult.value.periods?.length) useSchoolSlots(schoolResult.value.periods);
            applyInstallBrand(this.brandName, this.school?.id);
          }
          if (configResult.status === "fulfilled") {
            this.siteOrigin = configResult.value.siteOrigin || "";
            this.siteFilingNumber = configResult.value.siteFilingNumber || "";
          }
          if (navigationResult.status === "fulfilled") {
            this.topNavigation = navigationResult.value.map((item) => ({ ...item }));
          }
        } catch {
          // 接口失败：维持默认关闭可选功能，避免误展示后台未开放入口。
        } finally {
          this.loaded = true;
          this.loading = false;
          this._pendingFetch = null;
        }
      })();
      this._pendingFetch = task;
      return task;
    },
    /** 功能开关按学校下发：登录、退出后所属学校变了就重新拉一次。 */
    async refreshForSchool(schoolId: string | null | undefined) {
      if (!this.loaded) return;
      if (schoolId && this.school?.id === schoolId) return;
      await this.fetch(true);
    },
    pathEnabled(path: string) {
      return isSchoolPathEnabled(this.school, path);
    },
    toolEnabled(slug: string) {
      return isSchoolToolEnabled(this.school, slug);
    },
    /** 本校开着某个功能（schools/catalog.ts 的模块 key）；学校信息到之前按关着算。 */
    moduleEnabled(key: string) {
      return Boolean(this.school?.modules.includes(key));
    },
    /** admin PATCH /admin/features 成功后调一次更新本地状态 */
    apply(map: FeatureMap) {
      this.features = map;
    },
    applyConfig(config: Partial<PublicSiteConfig>) {
      if (config.siteOrigin !== undefined) this.siteOrigin = config.siteOrigin || "";
      if (config.siteFilingNumber !== undefined) this.siteFilingNumber = config.siteFilingNumber || "";
    },
    applyTopNavigation(items: TopNavigationItem[]) {
      this.topNavigation = items.map((item) => ({ ...item }));
    },
  },
});
