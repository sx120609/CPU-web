// 课表页面的底色、面板、文字和分隔线变量。课表主页面和只读的共享课表页面共用，
// 两边的深浅色就不会各改各的。课程颜色不在这里：那是各端共用的另一套。
export const SCHEDULE_THEME_STORAGE_KEY = "cpu-schedule-theme-v2";

export function scheduleSurfaceCssVars(input: {
  dark: boolean;
  hasBackground?: boolean;
  /** 背景图上那层遮罩的不透明度，0…1。 */
  overlayOpacity?: number;
}): Record<string, string> {
  const hasBackground = Boolean(input.hasBackground);
  const overlayOpacity = input.overlayOpacity ?? 0.84;
  if (input.dark) {
    // 深色用站点深色主题的中性灰（--cpu-bg、--cpu-card、--cpu-text），和 iOS 一致。
    return {
      "--schedule-page-bg": "linear-gradient(180deg, #15181c 0%, #0e1012 100%)",
      "--schedule-bg-overlay": hasBackground
        ? `rgba(14, 16, 18, ${Math.max(0.22, overlayOpacity * 0.58)})`
        : "rgba(14, 16, 18, 0.78)",
      "--schedule-surface-bg": hasBackground ? "rgba(26, 29, 33, 0.62)" : "rgba(26, 29, 33, 0.94)",
      "--schedule-surface-bg-soft": hasBackground ? "rgba(35, 39, 44, 0.68)" : "rgba(35, 39, 44, 0.88)",
      "--schedule-text": "#eceef1",
      "--schedule-text-secondary": "#b0b7c1",
      "--schedule-text-muted": "#8e96a2",
      "--schedule-border": "rgba(176, 183, 193, 0.28)",
      "--schedule-cell-bg": "rgba(30, 34, 38, 0.52)",
      "--schedule-cell-bg-strong": "rgba(42, 47, 53, 0.68)",
      "--schedule-cell-border": "rgba(176, 183, 193, 0.20)",
      "--schedule-panel-shadow": "0 14px 34px rgba(0, 0, 0, 0.22)",
    };
  }
  return {
    "--schedule-bg-overlay": `rgba(248, 251, 255, ${hasBackground ? overlayOpacity : 0.84})`,
    "--schedule-surface-bg": hasBackground ? "rgba(255, 255, 255, 0.60)" : "#ffffff",
    "--schedule-surface-bg-soft": hasBackground ? "rgba(255, 255, 255, 0.72)" : "#f9fafb",
    "--schedule-text": "#172033",
    "--schedule-text-secondary": "#667085",
    "--schedule-text-muted": "#8a94a6",
    "--schedule-border": "#dde4ee",
    "--schedule-cell-bg": "rgba(255, 255, 255, 0.36)",
    "--schedule-cell-bg-strong": "rgba(255, 255, 255, 0.56)",
    "--schedule-cell-border": "rgba(218, 227, 239, 0.82)",
    "--schedule-panel-shadow": "0 10px 24px rgba(24, 34, 51, 0.08)",
  };
}
