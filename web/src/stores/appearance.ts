import { defineStore } from "pinia";

export type AppearanceMode = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

const STORAGE_KEY = "cpu-appearance-mode-v1";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const THEME_COLORS: Record<ResolvedAppearance, string> = {
  light: "#168776",
  dark: "#0f766e",
};

let mediaQuery: MediaQueryList | null = null;
let mediaListenerInstalled = false;

function normalizeMode(value: unknown): AppearanceMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function readStoredMode(): AppearanceMode {
  try {
    return normalizeMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

function writeStoredMode(mode: AppearanceMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* localStorage can be blocked in private or embedded contexts */
  }
}

function systemPrefersDark() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  mediaQuery ??= window.matchMedia(DARK_QUERY);
  return mediaQuery.matches;
}

function resolveMode(mode: AppearanceMode): ResolvedAppearance {
  if (mode === "dark" || mode === "light") return mode;
  return systemPrefersDark() ? "dark" : "light";
}

function applyAppearance(mode: AppearanceMode) {
  if (typeof document === "undefined") return;
  const resolved = resolveMode(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.appearanceMode = mode;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  const themeMeta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
  if (themeMeta) themeMeta.content = THEME_COLORS[resolved];
}

export const useAppearanceStore = defineStore("appearance", {
  state: () => ({
    mode: "system" as AppearanceMode,
    resolved: "light" as ResolvedAppearance,
  }),
  getters: {
    isDark: (state) => state.resolved === "dark",
    modeLabel: (state) => {
      if (state.mode === "dark") return "深色";
      if (state.mode === "light") return "浅色";
      return "跟随系统";
    },
  },
  actions: {
    hydrate() {
      this.mode = readStoredMode();
      this.syncResolved();
      this.installSystemListener();
    },
    setMode(mode: AppearanceMode) {
      this.mode = normalizeMode(mode);
      writeStoredMode(this.mode);
      this.syncResolved();
    },
    cycleMode() {
      const next: AppearanceMode = this.mode === "system" ? "dark" : this.mode === "dark" ? "light" : "system";
      this.setMode(next);
    },
    syncResolved() {
      this.resolved = resolveMode(this.mode);
      applyAppearance(this.mode);
    },
    installSystemListener() {
      if (typeof window === "undefined" || !window.matchMedia || mediaListenerInstalled) return;
      mediaQuery ??= window.matchMedia(DARK_QUERY);
      mediaQuery.addEventListener("change", () => {
        if (this.mode === "system") this.syncResolved();
      });
      mediaListenerInstalled = true;
    },
  },
});

export function applyInitialAppearance() {
  applyAppearance(readStoredMode());
}
