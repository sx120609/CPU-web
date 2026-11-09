import { defineStore } from "pinia";
import { watch } from "vue";
import { useSiteStore } from "./site";

/**
 * 站点主题：和浅色 / 深色（stores/appearance.ts）是两回事，两种主题都有浅色和深色。
 * - classic：平时的青绿。
 * - anniversary：校庆主题，学校档案里有正在进行的校庆（site.celebration）时才提供，
 *   没有自己选过的用户默认用它；校庆期一过自动回到 classic。
 */
export type SiteTheme = "classic" | "anniversary";

/** 用户自己选的主题；没选过时不存。 */
const PREFERENCE_KEY = "cpu-site-theme-v1";
/** 上次实际用的主题，给启动脚本 public/appearance-bootstrap.js 在首屏前先套上，免得先闪一下青绿。 */
const ACTIVE_KEY = "cpu-site-theme-active-v1";

function readPreference(): SiteTheme | null {
  try {
    const value = localStorage.getItem(PREFERENCE_KEY);
    return value === "classic" || value === "anniversary" ? value : null;
  } catch {
    return null;
  }
}

let stylesRequested = false;

/** 校庆主题的样式不进首屏包，用到时再拉（启动脚本已套上校庆主题时立刻拉，和其他启动请求并行）。 */
function loadAnniversaryStyles() {
  if (stylesRequested) return;
  stylesRequested = true;
  void import("@/styles/anniversary.scss").catch(() => {
    stylesRequested = false;
  });
}

function applyTheme(theme: SiteTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "classic") delete root.dataset.cpuTheme;
  else root.dataset.cpuTheme = theme;
  try {
    localStorage.setItem(ACTIVE_KEY, theme);
  } catch {
    /* 存不了就每次等学校信息到了再套 */
  }
}

export const useSiteThemeStore = defineStore("siteTheme", {
  state: () => ({
    preference: readPreference(),
  }),
  getters: {
    /** 本校现在能不能选校庆主题。 */
    anniversaryAvailable: () => Boolean(useSiteStore().celebration),
    theme(): SiteTheme {
      if (!this.anniversaryAvailable) return "classic";
      return this.preference ?? "anniversary";
    },
  },
  actions: {
    setTheme(theme: SiteTheme) {
      this.preference = theme;
      try {
        localStorage.setItem(PREFERENCE_KEY, theme);
      } catch {
        /* 无痕模式等存不了，本次打开仍然生效 */
      }
    },
    /** 学校信息到了以后按它套主题；之前（以及学校信息拉取失败时）保持启动脚本套上的那个。 */
    install() {
      const site = useSiteStore();
      if (typeof document !== "undefined" && document.documentElement.dataset.cpuTheme === "anniversary") loadAnniversaryStyles();
      watch(() => this.anniversaryAvailable, (available) => {
        if (available) loadAnniversaryStyles();
      }, { immediate: true });
      watch(
        () => (site.school ? this.theme : null),
        (theme) => {
          if (theme) applyTheme(theme);
        },
        { immediate: true },
      );
    },
  },
});

export const siteThemeOptions: Array<{ value: SiteTheme; label: string }> = [
  { value: "anniversary", label: "校庆" },
  { value: "classic", label: "经典" },
];
