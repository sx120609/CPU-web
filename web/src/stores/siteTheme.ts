import { defineStore } from "pinia";

/**
 * 站点主题：和浅色 / 深色（stores/appearance.ts）相互独立，每套主题同时提供浅色与深色配色。
 * 默认使用经典青绿（classic）；旧「校庆」主题键值（anniversary）自动归并到丹霞红（crimson）。
 */
export const SITE_THEMES = ["classic", "crimson", "ocean", "emerald", "violet", "amber"] as const;
export type SiteTheme = (typeof SITE_THEMES)[number];
export const DEFAULT_SITE_THEME: SiteTheme = "classic";

export interface SiteThemeOption {
  value: SiteTheme;
  label: string;
  swatch: string;
}

export const siteThemeOptions: readonly SiteThemeOption[] = [
  { value: "classic", label: "经典青绿", swatch: "linear-gradient(135deg, #086f63 0%, #2a9d8c 100%)" },
  { value: "crimson", label: "丹霞红", swatch: "linear-gradient(135deg, #b8232b 0%, #e0525a 100%)" },
  { value: "ocean", label: "晴空蓝", swatch: "linear-gradient(135deg, #1a56c4 0%, #4b83f2 100%)" },
  { value: "emerald", label: "松石绿", swatch: "linear-gradient(135deg, #1b7346 0%, #3aa36c 100%)" },
  { value: "violet", label: "藤萝紫", swatch: "linear-gradient(135deg, #6538c9 0%, #8f65eb 100%)" },
  { value: "amber", label: "琥珀橙", swatch: "linear-gradient(135deg, #a84708 0%, #ea7c2b 100%)" },
];

const PREFERENCE_KEY = "cpu-site-theme-v1";
const LEGACY_ACTIVE_KEY = "cpu-site-theme-active-v1";

export function normalizeSiteTheme(value: unknown): SiteTheme {
  if (value === "anniversary") return "crimson";
  return typeof value === "string" && (SITE_THEMES as readonly string[]).includes(value)
    ? (value as SiteTheme)
    : DEFAULT_SITE_THEME;
}

function readStoredTheme(): SiteTheme {
  if (typeof localStorage === "undefined") return DEFAULT_SITE_THEME;
  try {
    const raw = localStorage.getItem(PREFERENCE_KEY);
    const resolved = normalizeSiteTheme(raw);
    if (raw === "anniversary") localStorage.setItem(PREFERENCE_KEY, resolved);
    localStorage.removeItem(LEGACY_ACTIVE_KEY);
    return resolved;
  } catch {
    return DEFAULT_SITE_THEME;
  }
}

let stylesRequested = false;

/** 非默认主题的样式不进首屏包，用到或打开主题切换面板时按需加载。 */
export function preloadSiteThemeStyles() {
  if (stylesRequested || typeof document === "undefined") return;
  stylesRequested = true;
  void import("@/styles/site-themes.scss").catch(() => {
    stylesRequested = false;
  });
}

function applySiteTheme(theme: SiteTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === DEFAULT_SITE_THEME) delete root.dataset.cpuTheme;
  else root.dataset.cpuTheme = theme;
}

export const useSiteThemeStore = defineStore("siteTheme", {
  state: () => ({
    theme: readStoredTheme() as SiteTheme,
  }),
  getters: {
    themeLabel: (state): string => (
      siteThemeOptions.find((item) => item.value === state.theme)?.label ?? "经典青绿"
    ),
  },
  actions: {
    setTheme(next: unknown) {
      const resolved = normalizeSiteTheme(next);
      this.theme = resolved;
      if (resolved !== DEFAULT_SITE_THEME) preloadSiteThemeStyles();
      applySiteTheme(resolved);
      try {
        localStorage.setItem(PREFERENCE_KEY, resolved);
        localStorage.removeItem(LEGACY_ACTIVE_KEY);
      } catch {
        /* 无痕模式等存不了，本次打开仍然生效 */
      }
    },
    install() {
      this.theme = readStoredTheme();
      if (this.theme !== DEFAULT_SITE_THEME) preloadSiteThemeStyles();
      applySiteTheme(this.theme);
    },
  },
});
