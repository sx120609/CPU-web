import { defineStore } from "pinia";
import { siteApi, type FeatureMap } from "@/api/site";

/**
 * 站点级开关：默认关闭可选功能，拉到后台真实开关后再展示入口。
 * 避免接口返回前短暂露出未开放功能。
 */
export const useSiteStore = defineStore("site", {
  state: () => ({
    features: { forum: false, market: false, coursereview: false, electric: false, sponsor: false } as FeatureMap,
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
          const r = await siteApi.features();
          this.features = r;
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
    /** admin PATCH /admin/features 成功后调一次更新本地状态 */
    apply(map: FeatureMap) {
      this.features = map;
    },
  },
});
