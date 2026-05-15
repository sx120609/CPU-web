import { defineStore } from "pinia";
import { siteApi, type FeatureMap } from "@/api/site";

/**
 * 站点级开关：默认乐观地认为全开（避免拉接口前导航闪烁消失）。
 * 拉到真实开关后再覆盖。
 */
export const useSiteStore = defineStore("site", {
  state: () => ({
    features: { forum: true, market: true, coursereview: true } as FeatureMap,
    loaded: false,
  }),
  actions: {
    async fetch() {
      try {
        const r = await siteApi.features();
        this.features = r;
      } catch {
        // 接口失败：维持乐观默认，避免误关功能
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
