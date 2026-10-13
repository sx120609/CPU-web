import type { WorkshopStatus } from "@/api/workshop";

export const statusLabels: Record<WorkshopStatus, string> = {
  DRAFT: "草稿",
  PENDING: "待审核",
  APPROVED: "审核通过",
  REJECTED: "审核未通过",
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
export function workshopDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN");
}

export function permissionText(permissions?: readonly string[]) {
  const names: Record<string, string> = {
    storage: "独立存档",
    "site.public": "公开站点信息与作品目录",
    "ui.toast": "带作品来源的提示",
    "ui.confirm": "带作品来源的确认",
    navigation: "确认后站内跳转",
    fullscreen: "点击后全屏",
    "motion.shake": "授权后摇一摇",
  };
  return permissions?.map((p) => names[p] || p).join("、") || "无";
}
