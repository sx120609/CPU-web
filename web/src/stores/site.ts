import { defineStore } from "pinia";
import { DEFAULT_TOP_NAVIGATION, siteApi, type FeatureMap, type PublicSiteConfig, type SchoolInfo, type TopNavigationItem } from "@/api/site";
import { isSchoolPathEnabled, isSchoolToolEnabled } from "@/utils/schoolModules";
import { setDocumentBrand } from "@/utils/documentTitle";
import { useSchoolSlots } from "@/views/schedule/slots";

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
    /** 拾间品牌下当前学校的名字；学校信息到之前用默认学校的，药大用户看不到闪变。 */
    brandName: (state) => state.school?.brandName || "药大拾间",
    brandTagline: (state) => (state.school ? state.school.tagline : "CPU 校园互助服务"),
    schoolName: (state) => state.school?.name || "中国药科大学",
    schoolShortName: (state) => state.school?.shortName || "药大",
    /** 手机 App、桌面端、NEXT 都是药大拾间的，只给默认学校露出下载和安装入口。 */
    clientAppsAvailable: (state) => !state.school || state.school.id === "cpu",
    /** 融合门户应用、公开外链这类直接指向药大自己系统的入口，只给默认学校。 */
    campusPortalAvailable: (state) => !state.school || state.school.id === "cpu",
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
            setDocumentBrand(this.brandName, this.schoolName);
            // 下次打开时启动画面先显示这所学校的品牌（public/appearance-bootstrap.js 读取）。
            try {
              window.localStorage.setItem("cpu-school-brand-v1", JSON.stringify({ brandName: this.brandName, schoolName: this.schoolName }));
            } catch { /* 无痕模式等存不了就算了 */ }
            if (schoolResult.value.periods?.length) useSchoolSlots(schoolResult.value.periods);
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
