import { defineStore } from "pinia";
import { DEFAULT_TOP_NAVIGATION, siteApi, type FeatureMap, type PublicSiteConfig, type SchoolInfo, type TopNavigationItem } from "@/api/site";
import { isSchoolPathEnabled, isSchoolToolEnabled } from "@/utils/schoolModules";

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
  actions: {
    async fetch(force = false) {
      if (this._pendingFetch) return this._pendingFetch;
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
