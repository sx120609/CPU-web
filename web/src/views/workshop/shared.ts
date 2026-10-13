import type {
  WorkshopPermission,
  WorkshopStatus,
  WorkshopType,
  WorkshopVersion,
  WorkshopWork,
} from "@/api/workshop";

export const statusLabels: Record<WorkshopStatus, string> = {
  DRAFT: "草稿",
  PENDING: "审核中",
  APPROVED: "已通过",
  REJECTED: "已退回",
};
/** 状态标签的颜色：对应 workshop.css 里的 .wk-chip.is-* */
export const statusTone: Record<WorkshopStatus, "muted" | "info" | "ok" | "danger"> = {
  DRAFT: "muted",
  PENDING: "info",
  APPROVED: "ok",
  REJECTED: "danger",
};
export const typeLabels: Record<WorkshopType, string> = {
  game: "游戏",
  tool: "工具",
  extension: "扩展",
};
/** 打开作品的按钮文字 */
export const openLabels: Record<WorkshopType, string> = {
  game: "开始游戏",
  tool: "打开工具",
  extension: "打开扩展",
};

export function workshopError(
  error: unknown,
  fallback = "操作失败，请稍后重试",
) {
  const message = (
    error as { response?: { data?: { message?: unknown } } } | null
  )?.response?.data?.message;
  if (typeof message === "string" && message) return message;
  return error instanceof Error && error.message ? error.message : fallback;
}
export function workshopDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN");
}
/** “3 天前”这样的相对时间，超过一个月给日期 */
export function workshopAgo(value: string | null | undefined, now = Date.now()) {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "—";
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return workshopDate(value);
}

const permissionNames: Record<WorkshopPermission, string> = {
  storage: "保存进度和设置",
  "site.public": "读取站点名称和工坊目录",
  "ui.toast": "显示提示消息",
  "ui.confirm": "弹出确认框",
  navigation: "经你确认后跳转站内页面",
  fullscreen: "经你确认后全屏",
  "motion.shake": "经你授权后感应摇一摇",
};
export function permissionList(permissions?: readonly string[]) {
  return (permissions ?? []).map(
    (item) => permissionNames[item as WorkshopPermission] || item,
  );
}
export function permissionText(permissions?: readonly string[]) {
  return permissionList(permissions).join("、") || "无";
}
export function controlsText(version: WorkshopVersion | null | undefined) {
  const names = { pointer: "鼠标", keyboard: "键盘", touch: "触屏" };
  return version?.manifest.game?.controls.map((item) => names[item]).join("、") || "";
}
export function orientationText(version: WorkshopVersion | null | undefined) {
  const orientation = version?.manifest.game?.orientation;
  return orientation
    ? { portrait: "竖屏", landscape: "横屏", any: "横竖屏均可" }[orientation]
    : "";
}
export function slotLabel(slot: string) {
  return ({ splash: "开屏", dialog: "小工具" } as Record<string, string>)[slot] || slot;
}

const HUES = ["blue", "orange", "green", "violet", "amber", "brand"] as const;
export type WorkshopHue = (typeof HUES)[number];
/** 作品没有自带图标：按作品标识固定取一个板块色，同一件作品在各处颜色一致。 */
export function workHue(slug: string): WorkshopHue {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return HUES[hash % HUES.length];
}
/** 图标上的字：名称里第一个汉字、字母或数字 */
export function workGlyph(name: string) {
  const match = /[\p{Script=Han}\p{L}\p{N}]/u.exec(name.trim());
  return match ? match[0].toUpperCase() : "✦";
}
export function workName(work: Pick<WorkshopWork, "slug" | "version">) {
  return work.version?.name || work.slug;
}
/** 作品的公开状态，“我的作品”和审核页共用 */
export function workState(work: Pick<WorkshopWork, "disabled" | "publishedVersionId">) {
  if (work.disabled) return { label: "已停用", tone: "danger" as const };
  if (work.publishedVersionId) return { label: "已公开", tone: "ok" as const };
  return { label: "未公开", tone: "muted" as const };
}
/** 运行页的地址。放在这个前缀下，已发布的安卓和 iOS 壳才会收起自己的顶栏和底栏。 */
export function playerPath(workId: string, versionId?: string) {
  const path = `/services/tools/yaoda-can-fly/workshop/${encodeURIComponent(workId)}`;
  return versionId ? `${path}?versionId=${encodeURIComponent(versionId)}` : path;
}
