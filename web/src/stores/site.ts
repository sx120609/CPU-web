import { defineStore } from "pinia";
import { siteApi, type FeatureMap } from "@/api/site";

/**
 * 站点级开关：默认关闭可选功能，拉到后台真实开关后再展示入口。
 * 避免接口返回前短暂露出未开放功能。
 */
export const useSiteStore = defineStore("site", {
  state: () => ({
    features: { forum: false, market: false, coursereview: false, electric: false } as FeatureMap,
    loaded: false,
  }),
  actions: {
    async fetch() {
      try {
        const r = await siteApi.features();
        this.features = r;
      } catch {
        // 接口失败：维持默认关闭可选功能，避免误展示后台未开放入口。
      } finally {
        this.loaded = true;
      }
    },
    /** admin PATCH /admin/features 成功后调一次更新本地状态 */
    apply(map: FeatureMap) {
      this.features = map;
    },
  },
});
